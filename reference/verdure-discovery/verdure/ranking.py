"""Transparent ranking.

Step 1 - hard filters: the user's own constraints (area, dates, price, format,
         child age, indoor). An event that fails any of these is never shown.
Step 2 - score: a weighted sum of simple components, each in [0, 1].
Step 3 - diversity re-rank: repeated categories and organizers are penalized.
Every ranked event carries its component scores and plain-language reasons so
the team can see exactly why it ranked where it did.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from .geo import haversine_miles, resolve_point
from .models import Event, utcnow
from .users import UserProfile, UserState

LOCAL_TZ = ZoneInfo("America/Los_Angeles")
PRETTY = {"kids": "kids' activities", "outdoors": "the outdoors", "arts": "arts"}


@dataclass
class Ranked:
    event: Event
    score: float
    components: dict[str, float]
    reasons: list[str]
    distance_miles: Optional[float] = None
    diversity_penalty: float = 0.0
    engaged: bool = False
    notify: bool = False
    flags: list[str] = field(default_factory=list)
    more_dates: list[str] = field(default_factory=list)

    @property
    def final(self) -> float:
        return round(max(self.score - self.diversity_penalty, 0.0), 4)


def _primary(ev: Event) -> str:
    return ev.categories[0] if ev.categories else "other"


def passes_filters(ev: Event, user: UserProfile, point, horizon_days: int) -> tuple[bool, Optional[float]]:
    now = utcnow()
    window_end = now + timedelta(days=min(user.date_range_days, horizon_days))
    end = ev.end or ev.start
    if end < now or ev.start > window_end:
        return False, None

    if ev.format not in user.formats:
        if not (ev.format == "hybrid" and ("online" in user.formats or "in_person" in user.formats)):
            return False, None

    distance = None
    if ev.format != "online":
        if point and ev.lat is not None and ev.lon is not None:
            distance = haversine_miles(point[0], point[1], ev.lat, ev.lon)
            if distance > user.max_distance_miles:
                return False, distance
        elif point:
            # In-person event with no coordinates: can't confirm it's nearby.
            return False, None

    if user.max_price is not None and ev.price_min is not None and ev.price_min > user.max_price:
        return False, distance

    if user.child_ages:
        lo = ev.age_min if ev.age_min is not None else 0
        hi = ev.age_max if ev.age_max is not None else 200
        if not any(lo <= age <= hi for age in user.child_ages):
            return False, distance

    if user.indoor_only and ev.indoor is False:
        return False, distance

    return True, distance


def score_event(ev: Event, user: UserProfile, distance: Optional[float], affinity: dict[str, float],
                state: UserState, weights: dict[str, float], horizon_days: int) -> Ranked:
    reasons: list[str] = []
    comps: dict[str, float] = {}

    # Interest match
    matched = [c for c in ev.categories if c in user.interests]
    if not user.interests:
        comps["interest_match"] = 0.5
    else:
        comps["interest_match"] = 1.0 if matched else 0.0
        if matched:
            reasons.append(f"Matches your interest in {PRETTY.get(matched[0], matched[0])}")

    # Distance
    if ev.format == "online":
        comps["distance"] = 0.7
        reasons.append("Online — join from anywhere")
    elif distance is not None:
        comps["distance"] = max(0.0, 1 - distance / max(user.max_distance_miles, 0.1))
        if distance <= 2:
            reasons.append(f"Close by ({distance:.1f} mi)")
        elif distance <= user.max_distance_miles / 2:
            reasons.append(f"Near your selected area ({distance:.1f} mi)")
    else:
        comps["distance"] = 0.5

    # Soonness
    days_out = max((ev.start - utcnow()).total_seconds() / 86400, 0)
    window = max(min(user.date_range_days, horizon_days), 1)
    comps["soonness"] = max(0.0, 1 - days_out / window)
    if days_out < 1:
        reasons.append("Happening today")
    elif ev.start.astimezone(LOCAL_TZ).weekday() >= 5 and days_out <= 7:
        reasons.append("This weekend")

    # Listing quality
    comps["quality"] = ev.quality_score
    if ev.is_free:
        reasons.append("Free")

    # Novelty: brand-new to this user scores highest, fades over a week of being shown
    seen = state.days_since_first_shown(ev.uid)
    comps["novelty"] = 1.0 if seen is None else max(0.3, 1 - seen / 7)
    if seen is None:
        reasons.append("New for you")

    # Learned affinity from feedback, mapped from [-1, 1] to [0, 1]
    vals = [affinity[c] for c in ev.categories if c in affinity]
    aff = sum(vals) / len(vals) if vals else 0.0
    comps["learned_affinity"] = (aff + 1) / 2
    if aff >= 0.25:
        reasons.append("Similar to events you've saved")

    if user.child_ages and (ev.age_min is not None or ev.age_max is not None):
        reasons.append("Fits your child's age")

    total_w = sum(weights.values()) or 1.0
    score = sum(weights.get(k, 0) * v for k, v in comps.items()) / total_w
    return Ranked(event=ev, score=round(score, 4), components={k: round(v, 3) for k, v in comps.items()},
                  reasons=reasons, distance_miles=round(distance, 2) if distance is not None else None)


def diversify(items: list[Ranked], cat_pen: float, org_pen: float, limit: int) -> list[Ranked]:
    """Greedy re-rank: each pick penalizes later events from the same category/organizer."""
    pool = sorted(items, key=lambda r: -r.score)
    picked: list[Ranked] = []
    cat_counts: dict[str, int] = {}
    org_counts: dict[str, int] = {}
    while pool and len(picked) < limit:
        for r in pool:
            r.diversity_penalty = (cat_pen * cat_counts.get(_primary(r.event), 0)
                                   + org_pen * org_counts.get(r.event.organizer.lower(), 0))
        best = max(pool, key=lambda r: r.final)
        pool.remove(best)
        picked.append(best)
        cat_counts[_primary(best.event)] = cat_counts.get(_primary(best.event), 0) + 1
        if best.event.organizer:
            org_counts[best.event.organizer.lower()] = org_counts.get(best.event.organizer.lower(), 0) + 1
    return picked


def _series_key(ev: Event) -> tuple:
    """Occurrences of one recurring series share a source, title and venue."""
    return (ev.source_id, ev.title.strip().lower(), ev.venue_name.strip().lower(), ev.format)


def collapse_series(candidates: list[Ranked]) -> list[Ranked]:
    """Keep only the next occurrence of each recurring series; list later dates on it."""
    groups: dict[tuple, list[Ranked]] = {}
    for r in candidates:
        groups.setdefault(_series_key(r.event), []).append(r)
    out = []
    for items in groups.values():
        items.sort(key=lambda r: r.event.start)
        # A saved occurrence wins over the soonest one, so the user still sees what they saved.
        keep = next((r for r in items if r.engaged), items[0])
        keep.more_dates = [r.event.start.isoformat() for r in items if r is not keep][:5]
        if keep.more_dates:
            keep.reasons.append(f"Repeats — {len(items) - 1} more date{'s' if len(items) > 2 else ''}")
        out.append(keep)
    return out


def rank_for_user(events: list[Event], user: UserProfile, state: UserState, affinity: dict[str, float],
                  excluded: set[str], engaged: set[str], cfg: dict) -> list[Ranked]:
    rcfg = cfg["ranking"]
    horizon = cfg["schedule"].get("horizon_days", 21)
    point = resolve_point(user.area, user.lat, user.lon)

    candidates: list[Ranked] = []
    for ev in events:
        if ev.uid in excluded:
            continue
        ok, dist = passes_filters(ev, user, point, horizon)
        if not ok:
            continue
        r = score_event(ev, user, dist, affinity, state, rcfg["weights"], horizon)
        r.engaged = ev.uid in engaged
        if r.engaged:
            r.reasons.insert(0, "You saved this")
        candidates.append(r)

    candidates = collapse_series(candidates)
    div = rcfg.get("diversity", {})
    ranked = diversify(candidates, div.get("same_category_penalty", 0.12),
                       div.get("same_organizer_penalty", 0.15), rcfg.get("max_results_per_user", 50))

    ncfg = cfg.get("notifications", {})
    soon = utcnow() + timedelta(days=ncfg.get("notify_within_days", 4))
    # Daily cap: count notifications already sent in the last 24h, then fill the remaining
    # slots with the highest-ranked eligible events (ranked is already best-first).
    budget = ncfg.get("max_per_user_per_day", 2) - state.notified_since(hours=24)
    for r in ranked:
        eligible = (r.final >= ncfg.get("notify_threshold", 0.7)
                    and r.event.start <= soon
                    and not r.engaged
                    and r.event.uid not in state.notified)
        r.notify = eligible and budget > 0
        if r.notify:
            budget -= 1
    return ranked
