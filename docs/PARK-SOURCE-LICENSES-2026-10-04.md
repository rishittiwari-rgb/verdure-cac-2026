# Park source terms, checked before feature ingestion

C1 is in progress. This permission review was committed before any feature
ingestion. The separate backend pipeline has since been implemented and checked
locally; see `PARK-PIPELINE-2026-10-04.md`. Native guides/offline packs and device
results are still pending. Source metadata is captured in
`evidence/park-source-metadata-2026-10-04.json` with exact endpoint URLs and time.

## City of San José

The official CKAN metadata for both required datasets declares `license_id:
cc-by` and Creative Commons Attribution. Preserve the supplied licence link;
the metadata does not name a specific CC version. Credit the City on every park
page and downloaded pack and link the dataset/licence. Indicate geometry and
attribute normalization rather than implying the City endorses Verdure.

- [Park publisher metadata](https://data.sanjoseca.gov/api/3/action/package_show?id=park): the official resource identifies OpenData MapServer layer 188, with a GeoJSON download. It includes open, closed, future, seasonal and construction status; the publisher states Monday weekly publication.
- [Park Amenities and Sports Fields metadata](https://data.sanjoseca.gov/api/3/action/package_show?id=park-amenities-and-sports-fields): the resource identifies the same MapServer's layer 554 and a GeoJSON download, including age-specific playground types. It also states weekly Monday publication.

The HTML dataset pages returned 403 through the web reader, but the published
CKAN metadata API responded normally. No headers or access restrictions were
bypassed. This API evidence establishes the license and canonical resource,
not source-data completeness or park-field mapping.

## Santa Clara County Parks

The [County's Maps and GIS page](https://parks.santaclaracounty.gov/plan-your-visit/maps-and-gis)
links the [Parks GIS Hub](https://gisdata-sccparks.hub.arcgis.com/) for downloadable
trail, park-boundary and point-of-interest data. The rendered Hub links its
Terms of Use to the [County policies](https://www.santaclaracounty.gov/terms-of-use).
The [Acceptable Use policy](https://www.santaclaracounty.gov/county-santa-clara-acceptable-use-policy)
treats County-created information as public-domain material unless otherwise
indicated, while reserving third-party copyright. Use only the County-produced
GIS items identified below, exclude photographs/third-party material, and
preserve County attribution. No CC BY license is inferred for these items.

The [Disclaimers policy](https://www.santaclaracounty.gov/county-santa-clara-disclaimers-policy)
provides the material without accuracy, completeness or timeliness guarantees.
Every trail view must keep the sprint's safety notice, official closure link and
absence of navigation. The item's empty `licenseInfo` is recorded explicitly,
along with the actual Hub-linked County permission basis.

| County-owned item | ArcGIS ID | Publisher owner |
| --- | --- | --- |
| Santa Clara County Parks Trails | `442bf544f0ca40248ec1e43ee5bdf963` | `sccprk` |
| Santa Clara County Parks Boundaries | `96102dcf9b9448578801737170b451da` | `sccprk` |
| Santa Clara County Parks Points of Interest | `733bce6fc1c644f1adb9dd2a8b6efd97` | `sccprk` |

Each public item names Santa Clara County Parks and Recreation as its credit
and points back to its Parks GIS Hub download page. Exact item metadata and
FeatureServer URLs are in the evidence JSON. The new pipeline must re-check
metadata/terms changes and fail visibly if permission or source access changes.

## Next implementation gates

Actual fields/coded values were inspected before mapping. The weekly backend
pipeline retains source IDs/licenses, uses geometry rather than names, leaves
unknown values unknown and exposes failures in the staff console. Native
place/event consumption of those geometry joins remains pending with C2.
Server pack entitlement, size/expiry and offline-action restrictions, app park
filters/guides/trail overlays, matching copy and physical offline GPS testing
remain outstanding requirements.
