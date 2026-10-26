# Physical-device QA results — October 4, 2026

**Overall: NOT RUN. G1–G3 and physical H2 are incomplete.**

Current inventory command: `xcrun devicectl list devices`, October 4.
One registered iPhone 16 Pro Max (`iPhone17,2`) is **unavailable**; its current
installed iOS/build cannot be read. No second iPhone is connected. An unavailable
Apple Watch does not satisfy a phone requirement. No install, signing, outdoor,
two-phone or physical crash action was performed. No physical defect can be
claimed fixed without such a run.

Device A model: unavailable iPhone 16 Pro Max; iOS/build: unobserved.
Device B model/iOS/build: no device available.
Test build commit: not installed. An unsigned ARM64 iPhone-target build of `16c1bad` passed with matching binary/dSYM UUIDs; it was not signed, uploaded or installed. Local Simulator evidence is separate in
SPRINT-PROGRESS-2026-10-03.md and docs/evidence.

## Setup and scope gates

| Gate | Result | Reason |
| --- | --- | --- |
| G1: free Personal Team install on two phones | UNTESTED | No two connected/unlocked iPhones; signing/team result not observed |
| G1: populated local backend over Wi-Fi on both phones | UNTESTED | Local populated backend exists; no phone connection/read-back |
| G2: every legacy and new device check below | UNTESTED | Hardware unavailable |
| H2: symbol upload and readable physical test crash | UNTESTED | No physical build/crash/dashboard receipt; local dSYM match is not a substitute |
| Remote push/APNs delivery | UNTESTED | Paid membership excluded by sprint |
| Real App Store purchase/Apple production verification | UNTESTED | Paid membership/production prerequisites excluded; local StoreKit QA still required |
| Universal links | UNTESTED | Paid membership excluded; use verdure:// |
| Cellular-only connection to local emulator | UNTESTED | Local LAN emulator is unreachable with Wi-Fi off; no deployment allowed |

## Item-by-item result

Expectations and procedure are in the root DEVICE-QA.md. The revised script
keeps every legacy item, assigns the second historical 4.30 row the unique ID
4.31, and updates obsolete offline attendance expectations to C4's prohibition.
No old optimistic check-in expectation is counted as a pass.

| Item | Check | Result | Reason |
| --- | --- | --- | --- |
| 1.1 | ~1 km away | UNTESTED | No connected physical phones |
| 1.2 | ~250 m away | UNTESTED | No connected physical phones |
| 1.3 | Standing at the venue | UNTESTED | No connected physical phones |
| 1.4 | At venue, under heavy tree cover | UNTESTED | No connected physical phones |
| 1.5 | At venue, Precise Location OFF | UNTESTED | No connected physical phones |
| 1.6 | Two-phone outdoor proximity rejection | UNTESTED | No connected physical phones |
| 2.1 | Wi-Fi OFF, LTE/5G only. Check in with photo | UNTESTED | Cellular-only local-emulator path excluded; hardware also unavailable |
| 2.2 | Repeat on 1 bar / edge of coverage | UNTESTED | Cellular-only local-emulator path excluded; hardware also unavailable |
| 2.3 | Kill the app mid-upload, reopen | UNTESTED | No connected physical phones |
| 2.4 | Airplane mode on immediately after shutter | UNTESTED | No connected physical phones |
| 2.5 | Check `proofs/{uid}/` in Storage console | UNTESTED | No connected physical phones |
| 2.6 | Cross-account proof-object ownership | UNTESTED | No connected physical phones |
| 3.0 | Legacy before-state balance/history capture | UNTESTED | No connected physical phones |
| 3.1 | Airplane mode, attempt 3 event check-ins + collect 3 places | UNTESTED | No connected physical phones |
| 3.2 | Force-quit, reopen, still offline | UNTESTED | No connected physical phones |
| 3.3 | Restore local Wi-Fi network | UNTESTED | No connected physical phones |
| 3.4 | Compare against Firestore console | UNTESTED | No connected physical phones |
| 3.5 | Replay the same ops (toggle airplane mode mid-flush) | UNTESTED | No connected physical phones |
| 3.6 | Sign out and back in | UNTESTED | No connected physical phones |
| 3.7 | Daily-cap reconciliation and legacy attendance cancellation | UNTESTED | No connected physical phones |
| 4.1 | Battery: 30 min of Map + Explore | UNTESTED | No connected physical phones |
| 4.2 | Low Power Mode on | UNTESTED | No connected physical phones |
| 4.3 | Incoming call mid-check-in | UNTESTED | No connected physical phones |
| 4.4 | Dynamic Type at accessibility XL, outdoors in sun | UNTESTED | No connected physical phones |
| 4.5 | VoiceOver through check-in start → finish | UNTESTED | No connected physical phones |
| 4.6 | Rotate / return from background repeatedly | UNTESTED | No connected physical phones |
| 4.7 | Browse Explore after the expanded civic/library corpus is loaded | UNTESTED | No connected physical phones |
| 4.8 | Open an SCU or library event whose feed has no coordinates | UNTESTED | No connected physical phones |
| 4.9 | Open a Mountain View Library programme and a San José public meeting | UNTESTED | No connected physical phones |
| 4.10 | Browse after two feeds publish the same event | UNTESTED | No connected physical phones |
| 4.11 | Open a library teen workshop, a volunteer trail day, and a concert | UNTESTED | No connected physical phones |
| 4.12 | Browse Discover with zero events, then a populated feed | UNTESTED | No connected physical phones |
| 4.13 | Increase Dynamic Type through accessibility sizes on every tab | UNTESTED | No connected physical phones |
| 4.14 | Turn on Reduce Motion, then browse every tab | UNTESTED | No connected physical phones |
| 4.15 | Discover → For You, then Everything, with a populated corpus | UNTESTED | No connected physical phones |
| 4.16 | Open an event and tap More like this / Less like this | UNTESTED | No connected physical phones |
| 4.17 | Two accounts: request, decline, request again, accept, then block | UNTESTED | No connected physical phones |
| 4.18 | Sign up as a 16-year-old, then search from an adult account | UNTESTED | No connected physical phones |
| 4.19 | Open a private `verdure://` friend invitation on the other phone | UNTESTED | No second phone for verdure:// flow; universal links excluded |
| 4.20 | Discover and Plan with large Dynamic Type and VoiceOver | UNTESTED | No connected physical phones |
| 4.21 | Organizer posts an accessible outdoor event with age/size details | UNTESTED | No connected physical phones |
| 4.22 | Create a student account and browse Opportunities | UNTESTED | No connected physical phones |
| 4.23 | Create and switch two Verdure+ interest profiles in Discover and Plan | UNTESTED | No connected physical phones |
| 4.24 | Save two child ages, accessibility needs, usual transport and typical distance in Profile; relaunch; open a late, adult-only or accessibility-unconfirmed event | UNTESTED | No connected physical phones |
| 4.25 | Build a Plan from real events, swap, make it shorter/longer, then reopen | UNTESTED | No connected physical phones |
| 4.26 | Two accepted friends share a group plan | UNTESTED | No connected physical phones |
| 4.27 | Scroll For You, tap, save, RSVP and dismiss a card | UNTESTED | No connected physical phones |
| 4.28 | Filter by setting, age audience, group size, accessibility and public venue, then relaunch | UNTESTED | No connected physical phones |
| 4.29 | Build a Plan with one event image and one missing image while an accepted friend is going | UNTESTED | No connected physical phones |
| 4.30 | With two adult accounts that RSVP'd before an event ended, open Add Friends after it ends; repeat while it is upcoming and with a minor account | UNTESTED | No connected physical phones |
| 4.31 | Deny location, then open Places and Map | UNTESTED | No connected physical phones |
| 5.1 | Location permission prompt, deny, re-enable in Settings | UNTESTED | No connected physical phones |
| 5.2 | Agreed fictional QA offer at an actual known venue | UNTESTED | No connected physical phones |
| 5.3 | Walk near that venue at an appropriate time | UNTESTED | No connected physical phones |
| 5.4 | Rewards Nearby with/without location | UNTESTED | No connected physical phones |
| 5.5 | San José park guides with real official records | UNTESTED | No connected physical phones |
| 5.6 | Download one park, a park set and an area on Wi-Fi | UNTESTED | No connected physical phones |
| 5.7 | Airplane mode with downloaded pack | UNTESTED | No connected physical phones |
| 5.8 | Outdoors on a downloaded real park/preserve trail in airplane mode | UNTESTED | No connected physical phones |
| 5.9 | Pack storage, age, Wi-Fi refresh, expiry and delete | UNTESTED | No connected physical phones |
| 5.10 | Every tab/screen: VoiceOver, largest Dynamic Type, dark mode | UNTESTED | No connected physical phones |
| 5.11 | Network Link Conditioner + Low Power Mode | UNTESTED | No connected physical phones |
| 5.12 | Scroll Everything through the full current corpus | UNTESTED | No connected physical phones |
| 5.13 | Two phones: request/accept, scheme invite, group shortlist and independent RSVPs | UNTESTED | No connected physical phones |
| 5.14 | Two phones: block and minor search exclusion | UNTESTED | No connected physical phones |
| 5.15 | Paywall through Xcode StoreKit configuration | UNTESTED | No connected physical phones |
| 5.16 | Under-13 signup; minor/adult Program eligibility and expired deadline | UNTESTED | No connected physical phones |
| 5.17 | Approved owner writes a story; second phone reports; staff removes/restores | UNTESTED | No connected physical phones |
| 5.18 | Adult A6 toggle consent/cancel/deny/re-enable/off; minor profile | UNTESTED | No connected physical phones |
| 5.19 | A6 enter eligible region, background/OS location wake, significant movement | UNTESTED | No connected physical phones |
| 5.20 | Optional Explore beta: camera denial/allow, compass/GPS motion, background/return | UNTESTED | No connected physical phones |
| 5.21 | Physical Crashlytics QA with explicit symbol upload/diagnostic flags | UNTESTED | No connected physical phones |
| 5.22 | Device Terms/support/interest forms against local website | UNTESTED | No connected physical phones |

## Next physical run

Use the exact Debug emulator host/ports and free-team setup in DEVICE-QA.md,
with populated public feeds and real official park data. Choose an actual
outdoor venue and park; any partner QA offer must be explicitly fictional with
recorded local-only agreement. Preserve the real corpus. Record each result,
device/iOS/SHA and receipt independently, then fix and regress real defects.
The available-device gate must change before this report can become a pass.
