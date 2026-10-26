# Verdure safety and moderation handoff — 2026-09-27

**Owners:** Advaith is accountable for the 24-hour safety-report response.
Adithya is the proposed queue operator. They are two different people.

## Current access status

**Adithya does not yet have access to a live moderation queue.** The queue and
callable functions exist in local code, but Cloud Functions are not deployed.
There is no staff dashboard in the iOS app or website and no Adithya Firebase
account UID on record. Do not claim that a person is monitoring reports until
access, notifications and an actual review rota are established.

The backend's `listModerationQueue` callable returns up to 100 open items,
ordered by 24-hour deadline. `moderateContent` accepts `remove`, `dismiss`,
`restore` and `suspend`. Both currently require the broad admin gate: a Firebase
Auth `admin` custom claim or `/admins/{uid}` document. Client Firestore rules
deny direct reads of `/moderationQueue` and `/reports`. Rishit must approve the
staff identity and access scope before an admin grant; a narrower moderator
role and usable staff interface should be prepared before production handoff.

## Review procedure for Adithya

1. Open the queue at the start of each assigned shift and sort by the earliest
   `slaDeadlineMs`. Check more often than daily; the deadline is measured from
   the **first** report, and the automated sweep runs hourly only after deploy.
2. Read `targetType`, report reasons, report count and content snapshot. Open
   the underlying post/event/profile when available. Do not treat a high
   report count as proof that the report is true.
3. **Remove** confirmed violating content. **Dismiss** an unfounded report.
   **Suspend** an account only after a human review of serious or repeated
   abuse; record the reason and notify Advaith. **Restore** only after a
   mistaken removal is reviewed. Preserve the queue ID and outcome in the
   incident log without copying private report details into public channels.
4. Escalate threats, harassment involving minors, and ambiguous user reports
   to Advaith immediately. Advaith owns the response deadline and coverage
   when Adithya is unavailable.

The hourly `moderationSweep` removes unresolved **content** once its deadline
passes. It deliberately does **not** suspend a reported user automatically.
That timer is a fallback, not a substitute for an accountable human review.

## Before live access can be granted

- Rishit supplies Adithya's Firebase account UID and approves the role.
- Engineering provides a least-privilege moderator role, queue interface or
  operator tool, and deploys and tests it under a separately approved release.
- Advaith and Adithya agree on an on-call schedule, escalation channel and
  incident log; confirm the queue can be reviewed within 24 hours.
- Run a report-to-queue-to-decision drill with separate reporter and staff
  accounts, including a user report that stays human-reviewed.

No deployment or account grant is authorized by this document.
