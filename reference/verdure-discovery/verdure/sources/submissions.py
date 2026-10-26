"""Organizer submissions adapter.

Organizers' events land as JSON files in data/submissions/ (one event per file,
or a list of events). Whatever form or backend collects them just needs to drop
files here. Editing or deleting a file updates or removes the listing on the
next refresh, which gives organizers a correction and cancellation path.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from dateutil import parser as dtparser

from ..models import Event, clean_text, infer_categories, to_bool, to_float, to_int, to_utc
from .base import Source

log = logging.getLogger("verdure.sources.submissions")


def parse_submission(d: dict, source_id: str, file_stem: str) -> Event:
    # Submissions come from outside, so every numeric field is coerced; bad values become None
    # (and lower the quality score) instead of crashing the refresh.
    title = clean_text(d.get("title"))
    desc = clean_text(d.get("description"))
    raw_cats = d.get("categories") or []
    if isinstance(raw_cats, str):
        raw_cats = [raw_cats]
    cats = [str(c).lower().strip() for c in raw_cats if c]
    price = to_float(d.get("price"))
    is_free = to_bool(d.get("is_free"))
    if is_free is None and price is not None:
        is_free = price == 0
    fmt = d.get("format", "in_person")

    return Event(
        source_id=source_id,
        source_event_id=str(d.get("id") or file_stem),
        title=title,
        start=to_utc(dtparser.parse(d["start"])),
        end=to_utc(dtparser.parse(d["end"])) if d.get("end") else None,
        description=desc,
        venue_name=clean_text(d.get("venue_name")),
        address=clean_text(d.get("address")),
        city=clean_text(d.get("city")),
        lat=to_float(d.get("lat")),
        lon=to_float(d.get("lon")),
        categories=cats or infer_categories(title, desc),
        price_min=price if price is not None else (0.0 if is_free else None),
        price_max=to_float(d.get("price_max")),
        is_free=is_free,
        organizer=clean_text(d.get("organizer")),
        organizer_contact=clean_text(d.get("organizer_contact")),
        url=str(d.get("url") or "").strip(),
        format=fmt if isinstance(fmt, str) else "in_person",
        age_min=to_int(d.get("age_min")),
        age_max=to_int(d.get("age_max")),
        indoor=to_bool(d.get("indoor")),
        accessibility=clean_text(d.get("accessibility")),
        capacity=to_int(d.get("capacity")),
        status=str(d.get("status") or "scheduled").lower(),
        image_url=str(d.get("image_url") or ""),
    )


class SubmissionsSource(Source):
    def fetch(self) -> list[Event]:
        folder = Path(self.base_dir) / self.cfg.get("folder", "data/submissions")
        events: list[Event] = []
        for path in sorted(folder.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                items = data if isinstance(data, list) else [data]
                for i, item in enumerate(items):
                    stem = path.stem if len(items) == 1 else f"{path.stem}-{i}"
                    events.append(parse_submission(item, self.id, stem))
            except (json.JSONDecodeError, KeyError, ValueError, TypeError) as exc:
                log.warning("Skipping bad submission %s: %s", path.name, exc)
        return events
