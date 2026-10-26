# Verdure — Congressional App Challenge 2026 (CA-10) submission review

Written 2026-10-25 18:00 PT against the **official 2026 CAC Rules** (congressionalappchallenge.us,
`2026-CAC-Rules.pdf`), the **official Judging Guidelines & Rubric** (`CAC_Rubric_2018.pdf`, the
only rubric the program publishes; the 2026 rules restate its three criteria), and Rep. Mark
DeSaulnier's **CA-10 2026 announcement**. Every finding below was checked against the repository
as merged on this branch (the Mac-verified handoff, `rishittiwari-rgb/CAC-handoff` at `d894689`).

Team: **Lalith, Rishit, John, Vishvak** (four — the maximum).

> **The deadline is 12:00 pm EDT / 9:00 am PT, Monday October 26, 2026.** That is about
> **15 hours** from the time of writing. After the submission period closes the entry cannot be
> modified in any way (Rules §4). Everything in §A below has to be done tonight.

---

## 0. Verdict in one paragraph

The app itself is well beyond what the rubric asks for, and nothing in it violates the content,
platform or language rules. What is **missing is the submission**: there is no demonstration video,
no written answers, no registration evidence, and no document that discloses the AI assistance the
rules require to be "fully disclosed in the submission materials". Two items could cost the entry
outright if left as they are: (1) every commit in the submitted history is co-authored by an AI
assistant and the README understates that; (2) 92 of the 130 commits in the original repository
were authored by an account (`vaiybhav`) that is not one of the four team names given, and the
rules require the app to be "solely created by the contestant". Both are fixable tonight with
honest documentation — not by hiding anything. Fix those, record the video, answer the six
questions, register everyone, and the entry can score 5/5/5.

---

## A. Blocking — must be done before 9:00 am PT Monday

| # | Rule | What the repo / submission has now | What to do |
|---|---|---|---|
| A1 | **Demonstration video, 1–3 min, public on YouTube or Vimeo** (Rules §4). Must contain: each participant's name, the app's name, the purpose in one clear sentence, the target audience, the tools and coding languages, and a showcase of the functionality. "The most critical component." | **None exists.** The only video in the repo is `Verdure-website--main/public/verdure-demo.mp4`: an 84-second **muted** website loop with no names, no narration, no languages. It does not satisfy any of the six required elements. | Record from the script in `docs/CAC-2026-SUBMISSION-PACK.md` §1 (2:40 target, hard stop 3:00). Screen-record the simulator with the emulator stack loaded (`./run-all.command`), narrate over it, show each teammate's face or name card. Upload as **Public** (not Unlisted). Put the URL in the submission form and in the README "For judges" section. |
| A2 | **Six written questions** (Rules §4): title; purpose; inspiration; technical difficulty and how it was addressed; what you learned / biggest takeaway; what a 2.0 would change. | **Nothing drafted.** | Drafts grounded in the repo are in `docs/CAC-2026-SUBMISSION-PACK.md` §2. Replace every `[TEAM: …]` with your own words — Q3 and Q5 must be your actual experience. |
| A3 | **AI usage must be fully disclosed** (Rules §3, AI USAGE): "AI may only be used to support specific aspects of the project and must not constitute the entirety of the technical development. Participants are expected to demonstrate significant individual contributions and technical understanding." | Every one of the 30 commits in the submitted history, and 88 of 130 in the original history, carries a `Co-Authored-By: Claude …` trailer. `CLAUDE.md` (46 KB) is the assistant's instruction file; `FINAL-REPORT.md`, the sprint reports and the Mac verification doc were written in AI sessions. The README says only "Parts of the code, the tests and the documentation were written with an AI coding assistant". That sentence is **less than the history shows**, and judges "have the right to request access to the App and source code" (§7.3). | Fill in `AI-AND-THIRD-PARTY-DISCLOSURE.md` (root; the verifiable facts are already written, the per-person parts are marked `TODO(team)`). State it in the video in one sentence and in Q4/Q5. Each teammate must be able to explain, on camera and if asked, one part of the system they own: the ranking, the ingest pipeline, the Firestore rules, the SwiftUI design system, the planner engine. **Do not** soften the disclosure; the trailers are in the public history and an undisclosed-AI finding is a disqualification risk, a disclosed one is not. |
| A4 | **Originality**: "solely created by the contestant … No other party should have any rights or interest in the app" (Rules §3). | The original repository (`lalubalu/appc`, public) starts 2026-03-22 with 92 commits by `vaiybhav <vaiybhavc@gmail.com>` ("Connectify"), through 2026-08. `docs/NEW-REPO-PUSH.md` refers to a "former owner" who issued API keys. The team named for this entry is Lalith, Rishit, John, Vishvak. | **If `vaiybhav` is Vishvak**, say so in the disclosure (GitHub handle → team member) and the problem disappears. **If `vaiybhav` is someone else**, the rules are not met as written: either add that person to the team (max four — someone would have to step off) or document precisely which code they wrote and that they have assigned all rights to the team — and be ready for the judges to ask. Decide this tonight; do not submit with it unresolved. |
| A5 | **Registration** (Rules §2): each member needs a **personal** (non-school) email, home and school addresses with **9-digit ZIP**, district and Member, a parent/guardian name and email; one teammate creates the team profile and invites up to three; everyone completes the personal profile and **eligibility quiz**. | Not verifiable from the repo. | Do it first — the invites and quiz emails take time and the form cannot be completed until all four are in. Use **congressionalappchallenge.us/students/student-registration**. CA-10 office help line: (925) 933-2660. |
| A6 | **Eligibility** (Rules §1): enrolled in middle/high school on Oct 26 2026; at least **half the team lives or attends school in CA-10**; compete in one district only; one app per person per year; app created after Oct 30 2025. | First commit 2026-03-22 → created after the cutoff ✓. Team of four ✓. Residency: not verifiable here. | Confirm two of the four are CA-10 (home **or** school address, by 9-digit ZIP — use the House "Find Your Representative" lookup). Confirm nobody is on a second team. |
| A7 | **Judges may request the app and source code** (Rules §7.3) — refusal is immediate disqualification. | The app is not on the App Store or TestFlight; Cloud Functions, Storage and indexes are **not deployed** (Spark plan). Without the local emulator stack the installed app shows honest empty states. The public `lalubalu/appc` history fails `check:secrets --history` (old NPS, Recreation.gov, a SerpApi-style and a Firebase browser key in past commits). The private `CAC-handoff` history is clean. | Submit a repo link whose history is clean: branch `cac-submission` on `lalubalu/appc` (one orphan commit of this tree, pushed tonight) or make `CAC-handoff` public. **Rotate the old keys** regardless (NPS and Recreation.gov keys are self-service; the Firebase browser key is restricted by bundle id but rotate it too). Put the exact run instructions for a judge in the README (added: "For Congressional App Challenge judges"). |

## B. Should fix tonight — affects the score, not eligibility

| # | Criterion | Finding | Action |
|---|---|---|---|
| B1 | **Video content → all three rubric lines.** Judges score from the video and the answers (Rules §7.1). | The script must say the **languages** out loud: Swift, TypeScript, Python. The 2018 rubric gives **Skill = 5 only for "multiple text-based programming languages"**; a judge who does not hear them cannot award it. | Script §1 names them at 0:22 and shows a code screen at 1:50. |
| B2 | **Concept (1–5): "Does the app address a specific problem? How creative is the solution?"** | The README leads with features, not the problem. | Open the video and Q2/Q3 with the problem in one sentence (people, especially teens, do not go outside or meet neighbours; event sites list, they do not get you there), then the three things no listing app does: proof-of-attendance rewards, an honest never-fabricated feed from civic sources, and a planner that works with no AI key. |
| B3 | **Design (1–5): "Did the student consider the user experience and interface? How intuitive is the UI?"** | Strong material exists but is scattered: claymorphism system, light/dark, Dynamic Type, 15/15 Apple accessibility audits, honest empty states, "Why you're seeing this" reasons, OpenStreetMap/Open-Meteo credits in-app. | Show the onboarding → For You → event detail → check-in path in one continuous take; cut to dark mode and large text for 5 s each; say "15 of 15 accessibility audits pass". |
| B4 | **Skill (1–5)**: judges reward understanding, not line counts. | Backend numbers (E2E 363/363, red team 96 blocked, 161 iOS unit tests) are credible, but a judge will ask "what was hard". | Q4 draft gives one concrete bug with cause and fix (the interest term that was 0 for every user, or the server-authoritative points with idempotent replay). Whoever presents it must be able to explain it without notes. |
| B5 | **Open-source documentation** (Rules §3): "they must clearly document any such usage". | README "Built with" table lists frameworks but not licences, and the Python reference engine's requirements are not mentioned. | `AI-AND-THIRD-PARTY-DISCLOSURE.md` §3 lists every dependency with its licence; link it from the submission's "additional information" field. |
| B6 | **Honesty of claims in the submission.** | README and verification doc are accurate (one UI test is reported as intermittent, 6 of 8). Keep it that way. | Do not say "all tests pass" anywhere; say "every suite green except one intermittent UI test, reported as such". Do not call the planner "AI-powered" (the repo already removed those claims in item 1.3). |
| B7 | **Repository first impression.** | The root has `Visual-Revamp-Handoff.md`, `Verdure Subscription Model - Google Docs.pdf`, and `CLAUDE.md` as the largest doc — a judge opening the repo sees AI-process files before the app. | The README now opens with a judges' section (video link, how to run, disclosure, team). Leave the process files in place — removing them would contradict the disclosure. |

## C. Already compliant — nothing to change

| Rule / criterion | Evidence |
|---|---|
| Topic, platform, language free (§3) | iOS app in Swift; backend in TypeScript; reference engine in Python. |
| Functionality (§3) | Fresh-install walkthrough UI test 6/6 with screenshots (`demo-screens/01`–`20`); backend E2E 363/363 on the emulator; `run-all.command` brings up the whole stack. |
| Content suitability (§3) | Every stored event carries `adultOnly`; Firestore rules deny minors and signed-out clients any adult-only listing; no scraped source whose terms prohibit it; Google/Meetup/Facebook/Eventbrite/ACTIVE refused in code; attributions for OpenStreetMap (ODbL), Open-Meteo, NPS, Recreation.gov shown in-app. |
| Privacy rights of third parties (§3) | Privacy policy in-app (and at verdure-app.com/privacy); proof photos stored under the user's own path with ownership rules; birth-year age safeguard at sign-up; no fabricated ratings, counts or hours. |
| Created after 2025-10-30 (§1) | First commit 2026-03-22. |
| Team ≤ 4 (§1) | Four. |
| Judges' three criteria (§7.2) | Idea, implementation/UX, coding skill — all evidenced; see B1–B4 for how to present them. |

## D. Rubric self-score (official 1–5 scale) and what moves it

| Criterion | Today, as a judge would see it from the repo alone | After §A/§B | Why |
|---|---|---|---|
| Concept | 4 | **5** | The problem statement and the three differentiators are not said anywhere a judge reads first. |
| Design | 4 | **5** | The design system, accessibility audits and honest empty states exist; the video has to show them. |
| Skill | 3–4 | **5** | Three text-based languages and a real server; but with undisclosed AI co-authorship on every commit a judge may discount it to the floor. Full disclosure plus a teammate explaining a hard bug restores it. |

## E. Timeline for tonight (Pacific)

| When | Who | What |
|---|---|---|
| 18:00–19:00 | all four | Register, personal profile, eligibility quiz; team profile + three invites (A5, A6). Decide A4. |
| 19:00–21:00 | two members on a Mac | `./run-all.command`, sign in as the demo judge, record the walkthrough from the script; one take per section is fine. |
| 21:00–22:00 | one member | Cut to ≤ 3:00, export, upload **Public** to YouTube, confirm it plays signed-out. |
| 21:00–22:30 | the other two | Fill `[TEAM: …]` in the answers; fill `TODO(team)` in the disclosure; `git commit`, push, confirm the README judges' section shows the real video link. |
| 22:30–23:30 | the team-profile owner | Paste answers, video URL, repo URL into the form; every teammate confirms in the portal; **submit**. Screenshot the confirmation. |
| 08:00 Mon | one member | Re-open the portal and verify the status reads submitted before 09:00 PT. |
| after the deadline | all four | Each completes the Exit Questionnaire individually (Rules §6). |

## F. Sources

- 2026 CAC Rules — https://www.congressionalappchallenge.us/wp-content/uploads/2026/05/2026-CAC-Rules.pdf
- Judging Guidelines & Rubric — https://www.congressionalappchallenge.us/wp-content/uploads/2018/10/CAC_Rubric_2018.pdf
- Rep. DeSaulnier, 2026 CA-10 announcement (9:00 am PT Oct 26 deadline, local judge panel, (925) 933-2660) — https://desaulnier.house.gov/media-center/press-releases/congressman-desaulnier-announces-2026-congressional-app-challenge
- 2025 CA-10 winner, for calibration (Synapse Match, team of four, phone-based Parkinson's screening) — https://www.congressionalappchallenge.us/25-ca10/
- Registration — https://www.congressionalappchallenge.us/students/student-registration
