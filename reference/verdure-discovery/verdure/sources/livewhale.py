"""LiveWhale JSON adapter (Santa Clara University and other LiveWhale campuses).

LiveWhale field names vary slightly between installs, so each value is read
from a list of candidate keys. Verify against the live feed before enabling.
"""

from __future__ import annotations

from dateutil import parser as dtparser

from ..models import Event, clean_text, infer_categories, to_utc
from .base import Source


def _first(d: dict, *keys, default=None):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", []):
            return v
    return default


def _float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_livewhale(payload, source_id: str, default_category: str | None = None,
                    organizer_fallback: str = "") -> list[Event]:
    items = payload.get("data", payload) if isinstance(payload, dict) else payload
    events: list[Event] = []
    for item in items or []:
        start_raw = _first(item, "date_iso", "date_utc", "date")
        if not start_raw:
            continue
        try:
            start = to_utc(dtparser.parse(start_raw))
        except (ValueError, TypeError):
            continue
        end_raw = _first(item, "date2_iso", "date2_utc", "date2")
        end = None
        if end_raw:
            try:
                end = to_utc(dtparser.parse(end_raw))
            except (ValueError, TypeError):
                end = None

        title = clean_text(_first(item, "title", default=""))
        desc = clean_text(_first(item, "summary", "description", default=""))
        tags = _first(item, "tags", "categories", default=[]) or []
        if isinstance(tags, str):
            tags = [tags]
        cost = clean_text(_first(item, "cost", default=""))
        is_free = True if cost.lower() in ("free", "0", "$0") else (None if not cost else False)

        events.append(Event(
            source_id=source_id,
            source_event_id=str(_first(item, "id", default=f"{title}-{start_raw}")),
            title=title,
            start=start,
            end=end,
            description=desc,
            venue_name=clean_text(_first(item, "location_title", "location", default="")),
            address=clean_text(_first(item, "location_address", default="")),
            lat=_float(_first(item, "location_latitude", "latitude")),
            lon=_float(_first(item, "location_longitude", "longitude")),
            categories=infer_categories(f"{title} {' '.join(map(str, tags))}", desc, default_category),
            is_free=is_free,
            price_min=0.0 if is_free else None,
            organizer=clean_text(_first(item, "group_title", default=organizer_fallback)),
            url=_first(item, "url", "link", default=""),
            format="online" if _first(item, "is_online") else "in_person",
            status="cancelled" if _first(item, "is_canceled", "is_cancelled") else "scheduled",
            image_url=_first(item, "thumbnail", "image", default="") or "",
        ))
    return events


class LiveWhaleSource(Source):
    def fetch(self) -> list[Event]:
        resp = self.http_get(self.cfg["url"])
        return parse_livewhale(
            resp.json(),
            source_id=self.id,
            default_category=self.cfg.get("default_category"),
            organizer_fallback=self.name,
        )
