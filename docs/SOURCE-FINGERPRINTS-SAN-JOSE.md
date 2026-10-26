# San José source fingerprints

Read-only probes on 2026-09-26. Reproduce from `functions/` with
`node scripts/fingerprint.mjs <hostname> ...`. An HTTP status describes only
that endpoint: a blocked home page does not prove the platform's public feed
is blocked. These results do not grant permission to parse HTML.

## sjpl.bibliocommons.com
Platform: BiblioCommons (host)
Home: 200; meta generator: not found
robots.txt: 200; terms: manual review required before HTML scraping
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 404 | text/html;charset=utf-8 | sjpl.bibliocommons.com |
| LiveWhale iCal | 404 | text/html;charset=utf-8 | sjpl.bibliocommons.com |
| Localist API | 404 | text/html;charset=utf-8 | sjpl.bibliocommons.com |
| CivicPlus RSS index | 404 | text/html;charset=utf-8 | sjpl.bibliocommons.com |
| BiblioCommons gateway | 200 | application/json; charset=utf-8 | gateway.bibliocommons.com |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.

## sccl.bibliocommons.com
Platform: BiblioCommons (host)
Home: 200; meta generator: not found
robots.txt: 200; terms: manual review required before HTML scraping
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 404 | text/html;charset=utf-8 | sccl.bibliocommons.com |
| LiveWhale iCal | 404 | text/html;charset=utf-8 | sccl.bibliocommons.com |
| Localist API | 404 | text/html;charset=utf-8 | sccl.bibliocommons.com |
| CivicPlus RSS index | 404 | text/html;charset=utf-8 | sccl.bibliocommons.com |
| BiblioCommons gateway | 200 | application/json; charset=utf-8 | gateway.bibliocommons.com |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.

## paloalto.bibliocommons.com
Platform: BiblioCommons (host)
Home: 200; meta generator: not found
robots.txt: 200; terms: manual review required before HTML scraping
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 404 | text/html;charset=utf-8 | paloalto.bibliocommons.com |
| LiveWhale iCal | 404 | text/html;charset=utf-8 | paloalto.bibliocommons.com |
| Localist API | 404 | text/html;charset=utf-8 | paloalto.bibliocommons.com |
| CivicPlus RSS index | 404 | text/html;charset=utf-8 | paloalto.bibliocommons.com |
| BiblioCommons gateway | 200 | application/json; charset=utf-8 | gateway.bibliocommons.com |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.

## aclibrary.bibliocommons.com
Platform: BiblioCommons (host)
Home: 200; meta generator: not found
robots.txt: 200; terms: manual review required before HTML scraping
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 404 | text/html;charset=utf-8 | aclibrary.bibliocommons.com |
| LiveWhale iCal | 404 | text/html;charset=utf-8 | aclibrary.bibliocommons.com |
| Localist API | 404 | text/html;charset=utf-8 | aclibrary.bibliocommons.com |
| CivicPlus RSS index | 404 | text/html;charset=utf-8 | aclibrary.bibliocommons.com |
| BiblioCommons gateway | 200 | application/json; charset=utf-8 | gateway.bibliocommons.com |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.

## smcl.bibliocommons.com
Platform: BiblioCommons (host)
Home: 200; meta generator: not found
robots.txt: 200; terms: manual review required before HTML scraping
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 404 | text/html;charset=utf-8 | smcl.bibliocommons.com |
| LiveWhale iCal | 404 | text/html;charset=utf-8 | smcl.bibliocommons.com |
| Localist API | 404 | text/html;charset=utf-8 | smcl.bibliocommons.com |
| CivicPlus RSS index | 404 | text/html;charset=utf-8 | smcl.bibliocommons.com |
| BiblioCommons gateway | 200 | application/json; charset=utf-8 | gateway.bibliocommons.com |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.

## www.openspace.org
Platform: Drupal (meta generator)
Home: 200; meta generator: Drupal 10 (https://www.drupal.org)
robots.txt: 200; terms: manual review required before HTML scraping
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 404 | text/html; charset=UTF-8 | www.openspace.org |
| LiveWhale iCal | 404 | text/html; charset=UTF-8 | www.openspace.org |
| Localist API | 404 | text/html; charset=UTF-8 | www.openspace.org |
| CivicPlus RSS index | 404 | text/html; charset=UTF-8 | www.openspace.org |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.

## events.sjsu.edu
Platform: Localist (API response)
Home: 200; meta generator: not found
robots.txt: 200; terms: manual review required before HTML scraping
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 404 | text/html; charset=UTF-8 | events.sjsu.edu |
| LiveWhale iCal | 404 | text/html; charset=UTF-8 | events.sjsu.edu |
| Localist API | 200 | application/json; charset=utf-8 | events.sjsu.edu |
| CivicPlus RSS index | 404 | text/html; charset=UTF-8 | events.sjsu.edu |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.

## events.stanford.edu
Platform: Localist (API response)
Home: 200; meta generator: not found
robots.txt: 200; terms: manual review required before HTML scraping
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 404 | text/html; charset=UTF-8 | events.stanford.edu |
| LiveWhale iCal | 404 | text/html; charset=UTF-8 | events.stanford.edu |
| Localist API | 200 | application/json; charset=utf-8 | events.stanford.edu |
| CivicPlus RSS index | 404 | text/html; charset=UTF-8 | events.stanford.edu |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.

## events.scu.edu
Platform: LiveWhale (JSON v2 feed)
Home: 403; meta generator: not found
robots.txt: 403; terms: manual review required before HTML scraping
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 200 | application/json; charset=UTF-8 | events.scu.edu |
| LiveWhale iCal | 200 | text/calendar;charset=UTF-8 | events.scu.edu |
| Localist API | 403 | text/html | events.scu.edu |
| CivicPlus RSS index | 403 | text/html | events.scu.edu |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.

## www.sanjoseca.gov
Platform: unknown (no positive platform signal)
Home: 403; meta generator: not found
robots.txt: 403; terms: manual review required before HTML scraping
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 403 | text/html | www.sanjoseca.gov |
| LiveWhale iCal | 403 | text/html | www.sanjoseca.gov |
| Localist API | 403 | text/html | www.sanjoseca.gov |
| CivicPlus RSS index | 403 | text/html | www.sanjoseca.gov |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.

## parks.santaclaracounty.gov
Platform: unknown (no positive platform signal)
Home: 403; meta generator: not found
robots.txt: 403; terms: manual review required before HTML scraping
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 403 | text/html; charset=UTF-8 | parks.santaclaracounty.gov |
| LiveWhale iCal | 403 | text/html; charset=UTF-8 | parks.santaclaracounty.gov |
| Localist API | 403 | text/html; charset=UTF-8 | parks.santaclaracounty.gov |
| CivicPlus RSS index | 403 | text/html; charset=UTF-8 | parks.santaclaracounty.gov |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.

## mountainview.libcal.com
Platform: LibCal (calendar host)
Home: 200; meta generator: not found
robots.txt: 200; terms: manual review required before HTML scraping
Calendar page: 200
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 404 | text/html; charset=utf-8 | mountainview.libcal.com |
| LiveWhale iCal | 404 | text/html; charset=utf-8 | mountainview.libcal.com |
| Localist API | 404 | text/html; charset=UTF-8 | mountainview.libcal.com |
| CivicPlus RSS index | 404 | text/html; charset=utf-8 | mountainview.libcal.com |
| LibCal RSS | 200 | application/rss+xml; charset=utf-8 | mountainview.libcal.com |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.

## sanjose.legistar.com
Platform: Legistar (public Web API)
Home: 200; meta generator: not found
robots.txt: 404; terms: manual review required before HTML scraping
| Endpoint | HTTP | Type | Final host |
| --- | ---: | --- | --- |
| LiveWhale JSON v2 | 404 | text/html | sanjose.legistar.com |
| LiveWhale iCal | 404 | text/html | sanjose.legistar.com |
| Localist API | 404 | text/html | sanjose.legistar.com |
| CivicPlus RSS index | 404 | text/html | sanjose.legistar.com |
| Legistar Events API | 200 | application/json; charset=utf-8 | webapi.legistar.com |
A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.
