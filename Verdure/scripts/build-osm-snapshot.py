#!/usr/bin/env python3
"""Build Verdure/Verdure/Resources/osm-snapshot-san-jose.json, the dated OpenStreetMap
starting cache for the San José demo area (used only when no Overpass mirror answers).

Two sources, same output shape (PlacesAPIService's OSMDataSet):
  overpass <response.json> <fetchedAt ISO-8601>
      A live Overpass answer to the app's feature query (preferred).
  geojsonseq <export.geojsonseq> <data timestamp ISO-8601>
      `osmium export -f geojsonseq --add-unique-id=type_id` of a Geofabrik extract,
      reduced here to exactly the features and area the app's Overpass query asks for.

Data © OpenStreetMap contributors, available under the Open Database License (ODbL).
"""
import json
import math
import sys

CENTER = (37.3382, -121.8863)   # LaunchArea san-jose-ca
RADIUS_M = 9000                 # covers a 5 km search anywhere within 4 km of the centre
OUT = "Verdure/Verdure/Resources/osm-snapshot-san-jose.json"


def matches(kind, tags):
    """The app's Overpass query (PlacesAPIService.overpassQuery), feature by feature."""
    named = bool(tags.get("name"))
    leisure, natural = tags.get("leisure"), tags.get("natural")
    if leisure == "park" or leisure == "garden":
        return True
    if tags.get("highway") == "path" and named:
        return True
    if natural == "water" and named:
        return True
    if kind == "node" and (leisure in ("playground", "sports_centre", "pitch") or tags.get("tourism") == "viewpoint"
                           or tags.get("amenity") == "community_centre" or natural == "beach"):
        return True
    if kind == "way" and leisure == "nature_reserve":
        return True
    return False


def distance_m(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def element(kind, osm_id, tags, lat, lon):
    e = {"type": kind, "id": osm_id, "tags": tags}
    if kind == "node":
        e["lat"], e["lon"] = round(lat, 7), round(lon, 7)
    else:
        e["center"] = {"lat": round(lat, 7), "lon": round(lon, 7)}
    return e


def from_overpass(path):
    data = json.load(open(path))
    for e in data["elements"]:
        lat = e.get("lat", (e.get("center") or {}).get("lat"))
        lon = e.get("lon", (e.get("center") or {}).get("lon"))
        if lat is None or lon is None:
            continue
        yield element(e["type"], e["id"], e.get("tags", {}), lat, lon)


def coords(geometry):
    t, c = geometry["type"], geometry["coordinates"]
    if t == "Point":
        return [c]
    if t == "LineString":
        return c
    if t == "Polygon":
        return [p for ring in c for p in ring]
    if t == "MultiPolygon":
        return [p for poly in c for ring in poly for p in ring]
    if t == "MultiLineString":
        return [p for line in c for p in line]
    return []


def from_geojsonseq(path):
    for line in open(path):
        line = line.strip().lstrip("\x1e")
        if not line:
            continue
        f = json.loads(line)
        uid = f.get("id", "")
        kind = {"n": "node", "w": "way", "a": "way"}.get(uid[:1])
        if kind is None:
            continue
        osm_id = int(uid[1:])
        if uid[:1] == "a":                  # osmium area id: 2*way_id (closed way) or 2*rel_id+1
            if osm_id % 2:
                continue                    # relations are not in the app's query
            osm_id //= 2
        pts = coords(f["geometry"])
        if not pts:
            continue
        # Overpass `out center` reports a way's bounding-box centre.
        lons, lats = [p[0] for p in pts], [p[1] for p in pts]
        lat, lon = (min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2
        if kind == "node":
            lon, lat = pts[0]
        yield element(kind, osm_id, f.get("properties") or {}, lat, lon)


def main():
    mode, path, fetched_at = sys.argv[1], sys.argv[2], sys.argv[3]
    source = {"overpass": from_overpass, "geojsonseq": from_geojsonseq}[mode](path)
    seen, out = set(), []
    for e in source:
        tags = {k: v for k, v in e["tags"].items() if not k.startswith("@")}
        e["tags"] = tags
        key = (e["type"], e["id"])
        if key in seen or not matches(e["type"], tags):
            continue
        p = (e.get("lat") or e["center"]["lat"], e.get("lon") or e["center"]["lon"])
        if distance_m(CENTER, p) > RADIUS_M:
            continue
        seen.add(key)
        out.append(e)
    out.sort(key=lambda e: (e["type"], e["id"]))
    doc = {
        "fetchedAt": fetched_at,
        "center": {"lat": CENTER[0], "lon": CENTER[1]},
        "radiusMeters": RADIUS_M,
        "source": "Overpass API (live)" if mode == "overpass" else "Geofabrik OpenStreetMap extract (norcal)",
        "attribution": "© OpenStreetMap contributors",
        "license": "ODbL 1.0 — https://www.openstreetmap.org/copyright",
        "elements": out,
    }
    with open(OUT, "w") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(out)} elements, data as of {fetched_at} -> {OUT}")


if __name__ == "__main__":
    main()
