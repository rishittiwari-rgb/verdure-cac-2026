# Discovery cycle — 2026-10-21

Mode: replay of recorded fixtures (no network). Fixture label `live-2026-10-21`, recorded 2026-10-21T01:11:25.122Z, clock 2026-10-21T01:11:25.122Z. 2289 recorded responses from 141 hosts. Script: `functions/scripts/discovery-e2e.mjs` (52 passed, 5 failed).

## Before / after

| Measure | Before | After |
| --- | ---: | ---: |
| Active sources | 14 | 19 |
| Active events | 8091 | 8252 |

Origins: corpus-link 11, osm 1117, organizer 0, model-url 1; queued {"added":1123,"known":2,"skipped":4}; inspected 110 (budget 110/300); OSM 1518 organisations (fetched).

### Sources after the cycle

| Source | Type | Origin | Status | Active events | Terms basis |
| --- | --- | --- | --- | ---: | --- |
| san-jose-ca_bibliocommons_aclibrary | bibliocommons | config | active | 749 |  |
| san-jose-ca_bibliocommons_paloalto | bibliocommons | config | active | 263 |  |
| san-jose-ca_bibliocommons_sccl | bibliocommons | config | active | 1200 |  |
| san-jose-ca_bibliocommons_sjpl | bibliocommons | config | active | 4060 |  |
| san-jose-ca_bibliocommons_smcl | bibliocommons | config | active | 1263 |  |
| san-jose-ca_ics_abilitypath.org | ics | osm | active (NEW) | 0 | no-terms-page |
| san-jose-ca_legistar_sanjose | legistar | config | active | 12 |  |
| san-jose-ca_libcal_mountainview-8800 | libcal | config | active | 51 |  |
| san-jose-ca_livewhale_events.scu.edu | livewhale | config | active | 327 |  |
| san-jose-ca_localist_events.sjsu.edu | localist | config | active | 85 |  |
| san-jose-ca_localist_events.stanford.edu | localist | config | active | 27 |  |
| san-jose-ca_midpen | midpen | config | active | 54 |  |
| san-jose-ca_nps | nps | config | active | 0 |  |
| san-jose-ca_rss-ics_careercenter.sjsu.edu | rss-ics | model-url | active (NEW) | 24 | public-institution |
| san-jose-ca_serpapi | serpapi | config | active | 0 |  |
| san-jose-ca_ticketmaster | ticketmaster | config | active | 0 |  |
| san-jose-ca_wordpress-tec_allcove.org | wordpress-tec | osm | active (NEW) | 133 | no-restrictive-clause |
| san-jose-ca_wordpress-tec_bayvp.org | wordpress-tec | osm | active (NEW) | 0 | no-terms-page |
| san-jose-ca_wordpress-tec_bpapaloalto.org | wordpress-tec | osm | active (NEW) | 2 | no-terms-page |

### Activated with no human action

- `san-jose-ca_ics_abilitypath.org`
- `san-jose-ca_rss-ics_careercenter.sjsu.edu`
- `san-jose-ca_wordpress-tec_allcove.org`
- `san-jose-ca_wordpress-tec_bayvp.org`
- `san-jose-ca_wordpress-tec_bpapaloalto.org`

## Every rejected candidate and why

| Host | Failed rules | Evidence |
| --- | --- | --- |
| acgov.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| acecharter.org | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| adjoin.org | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| albaschoolhouse.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| aikidomv.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| alisal.pleasantonusd.net | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| achievekids.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| adultschool.mhusd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| ab.mpesd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| adelanteselby.rcsdk8.net | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| aaci.org | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| abodeservices.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| adulteducation.esuhsd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| a3c.stanford.edu | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| actiondayschools.com | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| alhilaal.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| alcf.net | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| adventgm.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| sanjose.legistar.com | realEvents | realEvents: 15 upcoming but none inside the radius (0 with coordinates) |
| allen.sjusd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| almaden.sjusd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| altavista.unionsd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| art.stanford.edu | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| apostles-lutheran.net | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| alumrock.cc | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| anderson.stanford.edu | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| aofund.org | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| anderson.ogsd.net | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| amador.pleasantonusd.net | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| alpinehills.us | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| almadencountrydayschool.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| aptosjr.pvusd.net | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| ardenwoodforge.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| anderson.moreland.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| apps.dmv.ca.gov | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| appleseedalmaden.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| artgallerymenlopark.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| arkbaptistchurch.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| animalassistedhappiness.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| aptoshistory.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| arthub.academy | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| artobjectgallery.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| almadenhillsumc.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| apple.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| americanswimacademy.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| alphapublicschools.org | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| alumrockcc.org | realEvents | realEvents: no upcoming event in 0 sampled; re-inspected monthly |
| artschoolsfbay.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bayareacs.org | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| bayclubs.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| avcounseling.org | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| barrett.mhusd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| balajitemple.net | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bbcenglish.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bayareacollege.edu | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| barronparkdonkeys.org | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| arts4all.org | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| baldwin.ogsd.net | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| asrc.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| avhs.mvla.net | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bcca.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| awakeningchurch.com | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| baptistesv.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| ashtalakshmikrupa.org | realEvents | realEvents: no upcoming event in 0 sampled; re-inspected monthly |
| bayaerials.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| aviationmaintenance.edu | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| bamboogiant.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| atriaseniorliving.com | machineReadable, termsAllow, realEvents | machineReadable: no feed, API or schema.org Event data found<br>termsAllow: restrictive clause on https://www.atriaseniorliving.com/terms-of-use: "You may not, however, distribute, modify, transmit, reuse, report, or develop derivative works from the Materials, or otherwise use the Materials for<br>realEvents: no adapter, so no events could be sampled |
| ayso108.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| arusd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bayarea.northeastern.edu | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| axe-men.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| baymonte.org | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| arttimestudios.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bachrodt.sjusd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| athenaacademy.org | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| axeventures-axethrowing.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bcp.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| blancovenue.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bikesiliconvalley.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| blackford.campbellusd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| berthataylorschool.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| belmontvillage.com | machineReadable, termsAllow, realEvents | machineReadable: no feed, API or schema.org Event data found<br>termsAllow: restrictive clause on https://www.belmontvillage.com/terms-of-use/: "These Terms of Use permit you to use the Website for your personal, non-commercial use only." (non-commercial use only / commercial)<br>realEvents: no adapter, so no events could be sampled |
| bigfootdiscoveryproject.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bhuarchers.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bhsd.sccgov.org | robotsAllow, machineReadable, realEvents | robotsAllow: robots.txt returned 403; a 403 is not a licence to try harder<br>machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| belmont.gov | robotsAllow, machineReadable, realEvents | robotsAllow: robots.txt returned 403; a 403 is not a licence to try harder<br>machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| blackmountainbowmen.net | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| bluehills.cusdk8.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bh.lgusd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| birthrightsanjose.org | machineReadable, realEvents | machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| bgcofmarion.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bethemek.org | robotsAllow, machineReadable, realEvents | robotsAllow: Disallow: / (group: *)<br>machineReadable: rss detected (RSS /feed) but it publishes no feed this sprint can read<br>realEvents: no adapter, so no events could be sampled |
| bms-scusd-ca.schoolloop.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| beyondpotentiallearning.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bgclub.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bernal.ogsd.net | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| blachschool.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bowmanschool.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bracher.schoolloop.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| booksin.sjusd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| boynton.cuhsd.org | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bowers-scusd-ca.schoolloop.com | machineReadable, realEvents | machineReadable: no feed, API or schema.org Event data found<br>realEvents: no adapter, so no events could be sampled |
| bjwrr.org | realEvents | realEvents: no upcoming event in 0 sampled; re-inspected monthly |
| biblewaycc.org | realEvents | realEvents: no upcoming event in 0 sampled; re-inspected monthly |

Skipped (already a source or removed): smcl.bibliocommons.com: already a source (san-jose-ca_bibliocommons_smcl, active); aclibrary.bibliocommons.com: already a source (san-jose-ca_bibliocommons_aclibrary, active); sjpl.bibliocommons.com: already a source (san-jose-ca_bibliocommons_sjpl, active); events.stanford.edu: already a source (san-jose-ca_localist_events.stanford.edu, active); mountainview.libcal.com: already a source (san-jose-ca_libcal_mountainview-8800, active); openspace.org: already a source (san-jose-ca_midpen, active); sccl.bibliocommons.com: already a source (san-jose-ca_bibliocommons_sccl, active); events.scu.edu: already a source (san-jose-ca_livewhale_events.scu.edu, active); events.sjsu.edu: already a source (san-jose-ca_localist_events.sjsu.edu, active); paloalto.bibliocommons.com: already a source (san-jose-ca_bibliocommons_paloalto, active)

## Audit: active sources failing any rule

none (the audit query returned an empty set)

## Named evidence hosts

| Host | Platform / adapter | Verdict | Failed | Robots | Terms |
| --- | --- | --- | --- | --- | --- |
| www.cdm.org | unknown / none | rejected | machineReadable, realEvents | no matching rule | no terms page found by link text or common paths; a site that publishes a feed and has no terms page passes |
| developer.active.com | unknown / none | rejected | notDenied, machineReadable, termsAllow, realEvents | no matching rule | restrictive clause on https://developer.active.com/API_Terms_of_Use: "You represent and warrant to Active that, excluding Active Property, you have the right to use, reproduce, transmit, copy, publicly display, publicly  |
| events.sjsu.edu | localist / localist | active | — | Allow: / (group: *) | public institution (events.sjsu.edu): its calendar is public information; the platform clause is recorded, not applied: "Users may not access the Service through automated methods." |
| sjpl.bibliocommons.com | bibliocommons / bibliocommons | active | — | Allow: /* (group: *) | no restrictive clause on https://sjpl.bibliocommons.com/info/terms |
| careercenter.sjsu.edu | rss / rss-ics | active | — | no matching rule | public institution (careercenter.sjsu.edu): its calendar is public information; the platform clause is recorded, not applied: "These providers process your data solely to provide the Service and are prohibited from using |
| www.openspace.org | unknown / none | rejected | machineReadable, realEvents | no matching rule | no restrictive clause on https://www.openspace.org/terms-use-privacy |
| www.sccgov.org | unknown / none | rejected | machineReadable, realEvents | robots.txt unavailable (network error) | terms page could not be fetched; re-inspect later |

Weekly re-check: 19 checked, paused [], errors [].

