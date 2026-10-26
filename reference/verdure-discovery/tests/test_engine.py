"""End-to-end and unit tests. Run with:  python -m pytest -q"""

from __future__ import annotations

import json
import sys
from datetime import timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from verdure.dedupe import deduplicate
from verdure.models import Event, utcnow
from verdure.pipeline import refresh
from verdure.sources.ical import parse_ics
from verdure.sources.ticketmaster import parse_ticketmaster
from verdure.validate import is_publishable, validate

REGION = {"name": "test", "center": {"lat": 37.3382, "lon": -121.8863}, "max_radius_miles": 30}
SCHEDULE = {"drop_past_after_hours": 2, "horizon_days": 21}


def _ev(**kw) -> Event:
    base = dict(
        source_id="t", source_event_id="1", title="Nature Walk at Alum Rock",
        start=utcnow() + timedelta(days=2), end=utcnow() + timedelta(days=2, hours=2),
        description="A guided naturalist walk looking at oak woodland birds and wildflowers.",
        venue_name="Alum Rock Park", lat=37.3965, lon=-121.8000, categories=["outdoors"],
        is_free=True, price_min=0.0, organizer="Parks", url="https://example.org/walk",
    )
    base.update(kw)
    return Event(**base)


def _ics_stamp(dt):
    return dt.strftime("%Y%m%dT%H%M%SZ")


def test_complete_event_scores_high():
    ev = validate(_ev(), REGION, SCHEDULE)
    assert is_publishable(ev)
    assert ev.quality_score >= 0.95


def test_blocking_rules():
    assert "end_before_start" in validate(_ev(end=utcnow() + timedelta(days=1)), REGION, SCHEDULE).issues
    assert "already_ended" in validate(_ev(start=utcnow() - timedelta(days=3), end=utcnow() - timedelta(days=3)),
                                       REGION, SCHEDULE).issues
    assert "outside_region" in validate(_ev(lat=34.05, lon=-118.24), REGION, SCHEDULE).issues
    far = validate(_ev(venue_name="", lat=None, lon=None), REGION, SCHEDULE)
    assert not is_publishable(far)


def test_dedupe_merges_cross_source():
    a = validate(_ev(source_id="a", url=""), REGION, SCHEDULE)
    b = validate(_ev(source_id="b", source_event_id="x", title="Nature walk - Alum Rock",
                     start=a.start + timedelta(minutes=10)), REGION, SCHEDULE)
    unique, removed = deduplicate([a, b])
    assert removed == 1 and len(unique) == 1
    assert unique[0].url  # missing URL filled from the duplicate


def test_ical_parse():
    start = utcnow() + timedelta(days=3)
    ics = f"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:abc123
SUMMARY:Robotics Club Open House
DTSTART:{_ics_stamp(start)}
DTEND:{_ics_stamp(start + timedelta(hours=1))}
LOCATION:Engineering Building, San Jose, CA
GEO:37.3375;-121.8810
URL:https://events.example.edu/robotics
CATEGORIES:Clubs,Technology
DESCRIPTION:Meet the team and see this season's robots.
END:VEVENT
END:VCALENDAR"""
    events = parse_ics(ics, "sjsu", "campus")
    assert len(events) == 1
    ev = events[0]
    assert ev.title == "Robotics Club Open House"
    assert "tech" in ev.categories
    assert ev.lat == pytest.approx(37.3375)


def test_recurring_ical_expands_upcoming_occurrences():
    start = (utcnow() - timedelta(weeks=8)).replace(hour=17, minute=30, second=0, microsecond=0)
    ics = f"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:story1
SUMMARY:Weekly Storytime
DTSTART:{_ics_stamp(start)}
DTEND:{_ics_stamp(start + timedelta(hours=1))}
RRULE:FREQ=WEEKLY
LOCATION:Willow Glen Library
END:VEVENT
END:VCALENDAR"""
    events = parse_ics(ics, "lib")
    assert len(events) >= 8  # ~60 days ahead, weekly
    assert all(e.start > utcnow() - timedelta(days=3) for e in events)
    assert len({e.uid for e in events}) == len(events)


def test_dedupe_across_utc_midnight():
    from datetime import datetime, timezone
    a = _ev(source_id="a", start=datetime(2026, 10, 20, 23, 55, tzinfo=timezone.utc), end=None)
    b = _ev(source_id="b", source_event_id="2", start=datetime(2026, 10, 21, 0, 5, tzinfo=timezone.utc), end=None)
    assert deduplicate([a, b])[1] == 1


def test_venue_table_fills_missing_coordinates():
    from verdure.geo import fill_coordinates
    ev = _ev(lat=None, lon=None, venue_name="Willow Glen Branch Library")
    assert fill_coordinates([ev], {"willow glen branch library": (37.3046, -121.8982)}) == 1
    assert ev.lat == pytest.approx(37.3046)


def test_ticketmaster_parse():
    start = (utcnow() + timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {"_embedded": {"events": [{
        "id": "tm1", "name": "Sharks vs Kings", "url": "https://tm.example/1",
        "dates": {"start": {"dateTime": start}, "status": {"code": "onsale"}},
        "classifications": [{"segment": {"name": "Sports"}}],
        "priceRanges": [{"min": 35, "max": 200}],
        "_embedded": {"venues": [{"name": "SAP Center", "city": {"name": "San Jose"},
                                  "location": {"latitude": "37.3328", "longitude": "-121.9011"}}]},
    }]}}
    ev = parse_ticketmaster(payload, "ticketmaster")[0]
    assert ev.categories == ["sports"] and ev.price_min == 35 and ev.venue_name == "SAP Center"


def test_full_pipeline(tmp_path: Path):
    soon = utcnow() + timedelta(days=2)
    (tmp_path / "data" / "users").mkdir(parents=True)
    (tmp_path / "data" / "submissions").mkdir(parents=True)

    def sub(name, **kw):
        d = {"title": "Toddler Storytime", "start": soon.isoformat(), "end": (soon + timedelta(hours=1)).isoformat(),
             "description": "Songs and picture books for toddlers and their grown-ups at the branch.",
             "venue_name": "Willow Glen Library", "lat": 37.3046, "lon": -121.8982, "categories": ["kids"],
             "is_free": True, "organizer": "SJPL", "url": "https://example.org/story", "age_min": 1, "age_max": 5}
        d.update(kw)
        (tmp_path / "data" / "submissions" / f"{name}.json").write_text(json.dumps(d))

    sub("storytime")
    sub("teen", title="Teen Coding Night", categories=["tech"], age_min=13, age_max=18,
        url="https://example.org/teen")
    sub("far", title="Beach Cleanup", lat=36.97, lon=-122.03, categories=["volunteer"],
        url="https://example.org/far")
    sub("broken", title="Mystery Event", end=(soon - timedelta(hours=3)).isoformat(),
        url="https://example.org/broken")

    (tmp_path / "data" / "users" / "fam.json").write_text(json.dumps({
        "user_id": "fam", "area": "willow glen", "max_distance_miles": 8,
        "interests": ["kids"], "child_ages": [4],
    }))

    cfg = {
        "region": REGION,
        "schedule": {"refresh_minutes": 60, "drop_past_after_hours": 2, "horizon_days": 21},
        "paths": {"store": "data/events.json", "users_dir": "data/users",
                  "submissions_dir": "data/submissions", "output_dir": "output", "log_file": "output/e.log"},
        "sources": [{"id": "organizers", "type": "submissions", "enabled": True}],
        "ranking": {"weights": {"interest_match": .35, "distance": .2, "soonness": .15, "quality": .15,
                                "novelty": .1, "learned_affinity": .05},
                    "diversity": {"same_category_penalty": .12, "same_organizer_penalty": .15},
                    "max_results_per_user": 50, "learning_rate": .08, "learned_affinity_cap": 1.0},
        "notifications": {"notify_threshold": 0.7, "notify_within_days": 4},
    }
    report = refresh(cfg, str(tmp_path))
    assert report["listings"]["rejected"] == 1  # end before start

    feed = json.loads((tmp_path / "output" / "feeds" / "fam.json").read_text())
    titles = [e["title"] for e in feed["events"]]
    assert titles == ["Toddler Storytime"]  # teen event fails age filter, beach is too far
    top = feed["events"][0]
    assert top["notify"] is True
    assert any("interest" in r for r in top["reasons"])

    # Second run must not re-notify the same event
    refresh(cfg, str(tmp_path))
    feed2 = json.loads((tmp_path / "output" / "feeds" / "fam.json").read_text())
    assert feed2["events"][0]["notify"] is False
    queue = json.loads((tmp_path / "output" / "notifications" / "fam.json").read_text())
    assert len(queue) == 1


def _mini_cfg():
    return {
        "region": REGION,
        "schedule": {"refresh_minutes": 60, "drop_past_after_hours": 2, "horizon_days": 21},
        "paths": {"store": "data/events.json", "users_dir": "data/users",
                  "output_dir": "output", "log_file": "output/e.log"},
        "sources": [{"id": "organizers", "type": "submissions", "enabled": True}],
        "ranking": {"weights": {"interest_match": .35, "distance": .2, "soonness": .15, "quality": .15,
                                "novelty": .1, "learned_affinity": .05},
                    "diversity": {"same_category_penalty": .12, "same_organizer_penalty": .15},
                    "max_results_per_user": 50, "learning_rate": .08, "learned_affinity_cap": 1.0},
        "notifications": {"notify_threshold": 0.7, "notify_within_days": 4},
    }


def test_malformed_app_input_never_crashes_refresh(tmp_path: Path):
    """Strings where numbers belong, bad user_ids, and junk profiles are absorbed, not fatal."""
    soon = utcnow() + timedelta(days=2)
    (tmp_path / "data" / "users").mkdir(parents=True)
    (tmp_path / "data" / "submissions").mkdir(parents=True)
    (tmp_path / "data" / "submissions" / "a.json").write_text(json.dumps({
        "title": "Nature Walk", "start": soon.isoformat(),
        "description": "A long enough description of a guided nature walk.",
        "venue_name": "Alum Rock", "lat": "37.39", "lon": "-121.80", "categories": "outdoors",
        "is_free": "yes", "organizer": "Parks", "url": "https://x.org/a", "age_min": "2", "age_max": "60",
    }))
    users = tmp_path / "data" / "users"
    users.joinpath("good.json").write_text(json.dumps(
        {"user_id": "good", "area": "willow glen", "interests": ["outdoors"], "max_distance_miles": "12",
         "child_ages": ["4"]}))
    users.joinpath("evil.json").write_text(json.dumps({"user_id": "../../evil"}))
    users.joinpath("junk.json").write_text(json.dumps({"user_id": "junk", "interests": None}))

    report = refresh(_mini_cfg(), str(tmp_path))
    assert report["listings"]["publishable"] == 1
    feed = json.loads((tmp_path / "output" / "feeds" / "good.json").read_text())
    assert feed["events"][0]["title"] == "Nature Walk"
    assert not any("evil" in p.name for p in tmp_path.rglob("*") if "users" not in p.parts)


def test_deleted_user_outputs_are_removed(tmp_path: Path):
    (tmp_path / "data" / "users").mkdir(parents=True)
    (tmp_path / "data" / "submissions").mkdir(parents=True)
    profile = tmp_path / "data" / "users" / "gone.json"
    profile.write_text(json.dumps({"user_id": "gone", "area": "willow glen"}))
    refresh(_mini_cfg(), str(tmp_path))
    assert (tmp_path / "output" / "feeds" / "gone.json").exists()
    profile.unlink()
    refresh(_mini_cfg(), str(tmp_path))
    assert not (tmp_path / "output" / "feeds" / "gone.json").exists()
    assert not (tmp_path / "output" / "state" / "gone.json").exists()


def test_category_inference_uses_whole_words():
    from verdure.models import infer_categories
    assert infer_categories("Teen Coding Club", "Build small games with Python.") == ["tech"]
    assert "arts" not in infer_categories("Start-up Party", "Smart people welcome")
    assert "tech" not in infer_categories("Thai Food Night", "")
    assert "sports" in infer_categories("Basketball Games", "")


def test_recurring_series_collapses_to_next_date(tmp_path: Path):
    (tmp_path / "data" / "users").mkdir(parents=True)
    (tmp_path / "data" / "submissions").mkdir(parents=True)
    for week in range(3):
        start = utcnow() + timedelta(days=1 + 7 * week)
        (tmp_path / "data" / "submissions" / f"story{week}.json").write_text(json.dumps({
            "id": f"story-{week}", "title": "Family Storytime", "start": start.isoformat(),
            "end": (start + timedelta(hours=1)).isoformat(),
            "description": "Stories, songs and rhymes for young children and their grown-ups.",
            "venue_name": "Willow Glen Branch Library", "lat": 37.3046, "lon": -121.8982,
            "categories": ["kids"], "is_free": True, "organizer": "SJPL", "url": "https://example.org/s"}))
    (tmp_path / "data" / "users" / "u.json").write_text(json.dumps(
        {"user_id": "u", "area": "willow glen", "interests": ["kids"], "date_range_days": 21}))
    refresh(_mini_cfg(), str(tmp_path))
    feed = json.loads((tmp_path / "output" / "feeds" / "u.json").read_text())
    assert [e["title"] for e in feed["events"]] == ["Family Storytime"]
    assert len(feed["events"][0]["more_dates"]) == 2


def test_notifications_capped_per_day(tmp_path: Path):
    (tmp_path / "data" / "users").mkdir(parents=True)
    (tmp_path / "data" / "submissions").mkdir(parents=True)
    for i, cat in enumerate(["kids", "music", "food", "arts", "outdoors"]):
        start = utcnow() + timedelta(days=1, hours=i)
        (tmp_path / "data" / "submissions" / f"e{i}.json").write_text(json.dumps({
            "title": f"Great {cat} event", "start": start.isoformat(), "end": (start + timedelta(hours=1)).isoformat(),
            "description": "A complete and well described local event for testing notifications.",
            "venue_name": f"Venue {i}", "lat": 37.3046, "lon": -121.8982 + i * 0.01, "categories": [cat],
            "is_free": True, "organizer": f"Org {i}", "url": f"https://example.org/{i}"}))
    (tmp_path / "data" / "users" / "u.json").write_text(json.dumps(
        {"user_id": "u", "area": "willow glen", "interests": ["kids", "music", "food", "arts", "outdoors"]}))
    cfg = _mini_cfg()
    cfg["notifications"]["max_per_user_per_day"] = 2
    refresh(cfg, str(tmp_path))
    refresh(cfg, str(tmp_path))  # a second refresh the same day must not exceed the cap
    queue = json.loads((tmp_path / "output" / "notifications" / "u.json").read_text())
    assert len(queue) == 2


def test_rerank_only_touches_changed_profiles(tmp_path: Path):
    from verdure.pipeline import rerank_only
    (tmp_path / "data" / "users").mkdir(parents=True)
    (tmp_path / "data" / "submissions").mkdir(parents=True)
    for uid in ("a", "b"):
        (tmp_path / "data" / "users" / f"{uid}.json").write_text(json.dumps({"user_id": uid, "area": "willow glen"}))
    refresh(_mini_cfg(), str(tmp_path))
    summary = rerank_only(_mini_cfg(), str(tmp_path), only={"a"})
    assert summary["users"] == 1
