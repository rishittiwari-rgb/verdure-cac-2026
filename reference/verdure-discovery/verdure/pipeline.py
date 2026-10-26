"""One full refresh: ingest -> validate -> dedupe -> store -> rank -> write outputs."""

from __future__ import annotations

import logging
import time
from collections import Counter
from pathlib import Path

from .dedupe import deduplicate
from .geo import AREAS, fill_coordinates, haversine_miles, load_venues
from .models import Event, utcnow
from .ranking import Ranked, rank_for_user
from .sources import build_sources
from .store import EventStore, atomic_write_json, read_json
from .users import UserState, interaction_sets, learned_affinity, load_users
from .validate import is_publishable, validate

log = logging.getLogger("verdure.pipeline")


def _nearest_area(ev: Event) -> str:
    """Bucket by nearest named area when coordinates exist; fall back to the listed city."""
    if ev.format == "online":
        return "online"
    if ev.lat is None or ev.lon is None:
        return ev.city.lower() if ev.city else "unknown (no coordinates)"
    name, (lat, lon) = min(AREAS.items(), key=lambda kv: haversine_miles(ev.lat, ev.lon, *kv[1]))
    return name if haversine_miles(ev.lat, ev.lon, lat, lon) <= 4 else "other"


def ingest(cfg: dict, base_dir: str, store: EventStore) -> tuple[list[Event], dict]:
    """Fetch every enabled source. A failed source keeps its last good events."""
    events: list[Event] = []
    source_stats: dict[str, dict] = {}
    for src in build_sources(cfg["sources"], base_dir):
        t0 = time.monotonic()
        try:
            fetched = src.fetch()
            events.extend(fetched)
            source_stats[src.id] = {"status": "ok", "fetched": len(fetched),
                                    "seconds": round(time.monotonic() - t0, 2)}
            log.info("%-14s fetched %d events", src.id, len(fetched))
        except Exception as exc:  # one bad feed must never stop the refresh
            kept = [e for e in store.all() if e.source_id == src.id]
            events.extend(kept)
            source_stats[src.id] = {"status": "error", "error": str(exc)[:300], "kept_previous": len(kept)}
            log.error("%-14s FAILED (%s); keeping %d previous events", src.id, exc, len(kept))
    return events, source_stats


def build_index(raw: list[Event], cfg: dict, venues: dict | None = None) -> tuple[list[Event], list[Event], int]:
    """Validate and dedupe. Returns (publishable, rejected, duplicates_removed)."""
    if venues:
        fill_coordinates(raw, venues)
    for ev in raw:
        try:
            validate(ev, cfg["region"], cfg["schedule"])
        except Exception as exc:  # one malformed listing must never stop the refresh
            log.warning("Rejecting malformed listing %s/%s: %s", ev.source_id, ev.source_event_id, exc)
            ev.issues = ["invalid_data"]
    good = [e for e in raw if is_publishable(e)]
    rejected = [e for e in raw if not is_publishable(e)]
    unique, removed = deduplicate(good)
    for ev in unique:  # merged listings may have gained fields
        validate(ev, cfg["region"], cfg["schedule"])
    return unique, rejected, removed


def _feed_entry(rank: int, r: Ranked) -> dict:
    ev = r.event
    return {
        "rank": rank,
        "uid": ev.uid,
        "title": ev.title,
        "start": ev.start.isoformat(),
        "end": ev.end.isoformat() if ev.end else None,
        "venue": ev.venue_name,
        "address": ev.address,
        "distance_miles": r.distance_miles,
        "categories": ev.categories,
        "is_free": ev.is_free,
        "price_min": ev.price_min,
        "organizer": ev.organizer,
        "url": ev.url,
        "image_url": ev.image_url,
        "format": ev.format,
        "status": ev.status,
        "score": r.final,
        "components": r.components,
        "diversity_penalty": round(r.diversity_penalty, 3),
        "reasons": r.reasons,
        "saved": r.engaged,
        "notify": r.notify,
        "more_dates": r.more_dates,
    }


def rank_all(events: list[Event], cfg: dict, base_dir: str, only: set[str] | None = None) -> dict:
    """Rank every user, or only the users whose profile file stems are in `only`."""
    paths = cfg["paths"]
    out_dir = Path(base_dir) / paths["output_dir"]
    users = load_users(str(Path(base_dir) / paths["users_dir"]))
    all_ids = {u.user_id for u in users}
    by_uid = {e.uid: e for e in events}
    live = set(by_uid)
    profile_files = {p.stem for p in Path(base_dir, paths["users_dir"]).glob("*.json")}
    _remove_deleted_users(out_dir, all_ids | profile_files)
    if only is not None:
        users = [u for u in users if u.profile_file in only or u.user_id in only]
    summary = {"users": len(users), "notifications": 0, "empty_feeds": 0, "failed": 0}

    for user in users:
        try:
            summary["notifications"] += _rank_one(user, events, by_uid, live, cfg, out_dir, summary)
        except Exception:  # one bad profile must never block everyone else's feed
            log.exception("Ranking failed for user %s; other users unaffected", user.user_id)
            summary["failed"] += 1
    return summary


def _remove_deleted_users(out_dir: Path, current: set[str]) -> None:
    """Delete feeds, state and queued notifications for users whose profile file is gone."""
    for sub in ("feeds", "state", "notifications"):
        folder = out_dir / sub
        if not folder.exists():
            continue
        for path in folder.glob("*.json"):
            if path.stem not in current:
                path.unlink(missing_ok=True)
                log.info("Removed %s/%s (user profile deleted)", sub, path.name)


def _rank_one(user, events, by_uid, live, cfg, out_dir: Path, summary: dict) -> int:
    rcfg = cfg["ranking"]
    state = UserState(str(out_dir), user.user_id)
    state.prune(live)
    affinity = learned_affinity(user, by_uid, rcfg.get("learning_rate", 0.08),
                                rcfg.get("learned_affinity_cap", 1.0))
    excluded, engaged = interaction_sets(user)
    ranked = rank_for_user(events, user, state, affinity, excluded, engaged, cfg)

    new_notes = []
    for r in ranked:
        if r.notify:
            state.mark_notified(r.event.uid)
            new_notes.append({
                "uid": r.event.uid, "title": r.event.title, "start": r.event.start.isoformat(),
                "message": f"{r.event.title} — {', '.join(r.reasons[:2])}".rstrip(" —, "),
                "created_at": utcnow().isoformat(),
            })
    state.mark_shown([r.event.uid for r in ranked])
    state.save()

    atomic_write_json(out_dir / "feeds" / f"{user.user_id}.json", {
        "user_id": user.user_id,
        "generated_at": utcnow().isoformat(),
        "count": len(ranked),
        "learned_affinity": {k: round(v, 3) for k, v in sorted(affinity.items())},
        "events": [_feed_entry(i + 1, r) for i, r in enumerate(ranked)],
    })

    if new_notes:
        # Pending queue: whatever sends push notifications reads and clears this file.
        q_path = out_dir / "notifications" / f"{user.user_id}.json"
        queue = read_json(q_path, [])
        atomic_write_json(q_path, queue + new_notes)
    if not ranked:
        summary["empty_feeds"] += 1
    return len(new_notes)


def write_report(cfg: dict, base_dir: str, publishable: list[Event], rejected: list[Event],
                 duplicates: int, source_stats: dict, rank_summary: dict, store_changes: dict) -> dict:
    out_dir = Path(base_dir) / cfg["paths"]["output_dir"]
    n = len(publishable)
    complete = sum(1 for e in publishable if e.quality_score >= 0.85)
    issue_counts = Counter(i for e in publishable for i in e.issues)
    reject_counts = Counter(i for e in rejected for i in e.issues)
    report = {
        "generated_at": utcnow().isoformat(),
        "region": cfg["region"]["name"],
        "sources": source_stats,
        "listings": {
            "publishable": n,
            "rejected": len(rejected),
            "duplicates_removed": duplicates,
            "added_this_run": store_changes.get("added", 0),
            "removed_this_run": store_changes.get("removed", 0),
            "complete_pct": round(100 * complete / n, 1) if n else 0.0,
            "avg_quality": round(sum(e.quality_score for e in publishable) / n, 3) if n else 0.0,
        },
        "common_issues": dict(issue_counts.most_common(10)),
        "rejection_reasons": dict(reject_counts.most_common()),
        "coverage_by_area": dict(Counter(_nearest_area(e) for e in publishable).most_common()),
        "coverage_by_category": dict(Counter(c for e in publishable for c in e.categories).most_common()),
        "users": rank_summary,
    }
    atomic_write_json(out_dir / "report.json", report)
    atomic_write_json(out_dir / "rejected.json", [
        {"uid": e.uid, "source": e.source_id, "title": e.title,
         "start": e.start.isoformat() if e.start else None, "issues": e.issues, "url": e.url}
        for e in rejected if "already_ended" not in e.issues
    ])
    return report


def refresh(cfg: dict, base_dir: str) -> dict:
    """Full refresh cycle. Safe to call repeatedly."""
    store = EventStore(str(Path(base_dir) / cfg["paths"]["store"]))
    raw, source_stats = ingest(cfg, base_dir, store)
    venues = load_venues(str(Path(base_dir) / cfg["paths"].get("venues_file", "data/venues.json")))
    publishable, rejected, dupes = build_index(raw, cfg, venues)
    changes = store.upsert_many(publishable)
    changes["removed"] = store.prune({e.uid for e in publishable})
    store.save()
    rank_summary = rank_all(publishable, cfg, base_dir)
    report = write_report(cfg, base_dir, publishable, rejected, dupes, source_stats, rank_summary, changes)
    log.info("Refresh done: %d live events (+%d / -%d), %d rejected, %d dupes, %d users, %d notifications",
             len(publishable), changes["added"], changes["removed"], len(rejected), dupes,
             rank_summary["users"], rank_summary["notifications"])
    return report


def rerank_only(cfg: dict, base_dir: str, only: set[str] | None = None) -> dict:
    """Rebuild feeds from the stored index without re-fetching sources.

    `only` limits the work to specific users (profile file stems); None re-ranks everyone.
    """
    store = EventStore(str(Path(base_dir) / cfg["paths"]["store"]))
    events = [validate(e, cfg["region"], cfg["schedule"]) for e in store.all()]
    events = [e for e in events if is_publishable(e)]
    summary = rank_all(events, cfg, base_dir, only=only)
    log.info("Re-ranked %d user(s) after profile changes (%d notifications)",
             summary["users"], summary["notifications"])
    return summary
