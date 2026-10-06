# Status

| Phase | State | Notes |
|---|---|---|
| 0 Foundations | **Done**, merged | All three acceptance criteria pass |
| 1 Core data | **Done**, merged (PR #2) | Both acceptance criteria pass |
| 2 Scheduling engine | **Done**, merged (PR #3) | All three acceptance criteria pass |
| 3 Attendance, makeups, trials, forms | **Done**, merged (PR #4) | Both acceptance criteria pass |
| 4 Billing and collections | **Done**, merged (PR #5) | All four acceptance criteria pass (see below) |
| 5 Communications hub | **Done**, merged (PR #6) | All three acceptance criteria pass |
| 6 Staff ops and payroll | **Done**, merged (PR #7) | Both acceptance criteria pass (see below) |
| 7 Parent portal | **Done**, merged (PR #8) | The acceptance criterion passes (see below) |
| 8 Transport, courses & camps, institutions | **Done**, merged (PR #9) | The acceptance criterion passes (see below) |
| 9 Reports, venue migration, copilot | **Done**, merged (PR #10) | The acceptance criterion passes (see below) |
| 10 | Not started | |

## Phase 9 acceptance criteria

| Criterion | Proof | Result |
|---|---|---|
| Migrating all groups from a closing venue to another produces a preview, personalized messages, and is reversible within 24h | `apps/web/e2e/migration.spec.ts`: the owner opens the wizard for the demo Gush Etzion pool, moves every group to the Jerusalem country club (one with no lead instructor for now), reads the per-child rule checks, the price line and one personal message per child, executes (every group is in Jerusalem, the worker's automation queues the families' messages), then reverts inside `migration.revert_hours` (24): the groups are back in Gush Etzion and the same number of "the change was cancelled" messages is queued. Service level: `packages/seed/test/migration.test.ts` (relocate and merge, a target without room is flagged, a new instructor through a shift change, the revert refused after the window, instructors kept away) | Pass |

Also: reports (revenue, venue profitability with rent and instructor cost, occupancy heatmap, churn by a now
required reason, trial funnel by source and branch, instructor KPIs) with CSV export
(`packages/seed/test/reports.test.ts`, `apps/web/e2e/reports.spec.ts`); the weekly digest built every Sunday at 07:00
by the worker; the owner copilot (Claude or the rules-based stand-in) that only proposes and runs confirmed actions
through the ordinary services, with undo for moves (`packages/seed/test/copilot.test.ts`,
`apps/web/e2e/copilot.spec.ts`); and the policies screen showing every section.

Totals on 2026-10-06: 637 unit/integration tests + 39 browser tests, all green. `lint`, `typecheck`, `format:check` clean.

## Phase 8 acceptance criteria

| Criterion | Proof | Result |
|---|---|---|
| Parents receive "arrived at the pool" automatically when the escort taps check-in | `apps/web/e2e/transport.spec.ts` on a Pixel 7 viewport: the owner opens today's run of the demo route if today is not its day, the escort persona marks יואב on board and taps "יצאנו מבית הספר" and "הגענו לבריכה", the worker's automation step queues exactly one message (template `transport_arrived_pool`) to his mother, the office sees it in the message log and the parent's child card shows the stage. Service level: `packages/domain/comms/test/transport.test.ts` (only children on board are messaged, a stale tap messages nobody, the database refuses backdating and another escort's or another day's run, a family sees only its own child) | Pass |

Also: in-water time per run against the lesson and a monthly report; intensive courses and camp weeks as cohorts
with their own regulations, capacity, closing date and a camp staff ratio, billed once per cohort, with a printable
roster; institutions with contracts, monthly invoices from the roster (per child, per lesson held or fixed),
printed tax invoices and receipts (fake provider), partial payments and overdue tracking, an attendance report, and
families not billed for institution-paid groups (`packages/domain/billing/test/institutions.test.ts`,
`apps/web/e2e/courses.spec.ts`).

Totals on 2026-10-06: 575 unit/integration tests + 34 browser tests, all green. `lint`, `typecheck`, `format:check` clean.

## Phase 7 acceptance criteria

| Criterion | Proof | Result |
|---|---|---|
| A parent completes absence → makeup booking → receipt download on a phone in under 60 seconds total | `apps/web/e2e/portal.spec.ts` AC on a Pixel 7 viewport: the parent persona opens **לו״ז**, taps "לא נגיע" on a lesson two or more days out, the worker's step decides the notice by the regulations and issues the credit, the parent opens it from the family home, books the first offered makeup, opens **תשלומים**, opens a receipt and downloads it. The whole flow, sign-in included, is measured: 2.5 s locally, asserted under 60 s | Pass |

Also: a child card (progress by level with the skills achieved, next lessons, freeze and leave requests with their
outcome), the companion pass with a QR code checked by a public page (valid today, expired, forged), freeze and
leave requests decided by the worker with the office's rules (`packages/domain/billing/test/portal.test.ts`: the
database stamps who and when and refuses forged outcomes, another family sees nothing), and fake-provider receipts
for September's payments in the seed.

Totals on 2026-10-04: 536 unit/integration tests + 32 browser tests, all green. `lint`, `typecheck`, `format:check`
clean.

## Phase 6 acceptance criteria

| Criterion | Proof | Result |
|---|---|---|
| Payroll for a hybrid instructor produces a payslip part (groups) and a transfer part (privates) matching hand-calculated fixtures | `packages/domain/payroll/test/policies.test.ts`: the hand-worked month (per-hour groups at two venues, per-session privates, travel once per day and venue, a bonus) gives exactly 440.00 ₪ on the payslip and 360.00 ₪ by transfer, every line with its rule's explanation; rule specificity, per-head pay, pension streaks with retro and sick-leave accrual cover every branch (100% on `policies.ts`). `services.test.ts` AC1 drafts the same month from real sessions and private slots and gets the same agorot, then a dispute blocks approval, the owner's correction lands on the payslip, approval locks the month (database trigger) and accrues sick leave, the instructor sees only their own approved statement, and the XLSX totals match. `apps/web/e2e/staffops.spec.ts` AC1: the owner sees אסף's two parts on **שכר**, approval is refused while דני's dispute is open, closes it on **שעות**, approves, and the accountant downloads the spreadsheet | Pass |
| Substitute offers go out in waves and lock on the first accept | `packages/domain/scheduling/test/substitutes.test.ts`: five qualified instructors are offered 2, 2 and 1 per wave as each wave times out, then the request is unfilled; two instructors accepting at the same moment on separate connections leave exactly one assignment (row lock plus a partial unique index), the others' offers are withdrawn, and the worker's apply puts the substitute on the lesson and emits `scheduling.staff_changed` once. `staffops.spec.ts` AC2: the instructor persona takes the seeded offer in the app and the office sees "מלמד/ת: נועה" | Pass |

Also: instructors confirm or dispute their month in the app, statements show only approved months (adjustments
stay hidden until then), next month's staffing gaps merged by venue, day and hours, and a recruiting pipeline with
a scorecard, a talent pool and a ready job post.

Totals on 2026-10-04: 527 unit/integration tests + 29 browser tests, all green. `lint`, `typecheck`, `format:check`
clean. Coverage stays 100% on the pure policy modules, now including `domain-payroll`.

## Phase 5 acceptance criteria

| Criterion | Proof | Result |
|---|---|---|
| "דניאל לא יגיע היום" from a known guardian becomes a pre-filled absence action in under 5 seconds | `apps/web/e2e/messaging.spec.ts`: a signed GHL InboundMessage webhook from a fake guardian's phone ("‹name› לא יגיע ב-‹date›") is answered with the draft action already created, measured under 5 s; the owner sees it in **הודעות › תיבה נכנסת** with the child, group, date and time filled in, taps approve once, and the absence is recorded on the WhatsApp channel. Service level: `packages/domain/comms/test/services.test.ts` AC1 (intake to draft time, approval through the attendance rules, the confirmation automation, duplicate webhooks dropped), plus every triage route (two children, no lesson, complaint, unknown sender, staff) | Pass |
| Nothing is sent on Shabbat | `packages/domain/comms/test/policies.test.ts`: a fast-check property over random instants in 2026–2027 shows `sendDecision` never sends inside a rest window (candle lighting − 30 min to havdalah + 30 min, Yom Tov included), and unit cases for quiet hours, a window running into quiet hours, and Rosh Hashana into Shabbat. `services.test.ts` AC2: a message queued Friday 9.10.2026 at 17:30 is held with the reason and sent only at the window's end; the dispatcher re-checks at send time | Pass |
| Every outbound message is logged | `services.test.ts` AC3: opted out, no phone, a missing variable and a switched-off template are each a blocked row with the reason; a provider failure retries three times then is marked failed; every provider call has a row with the provider's id; the database refuses to change a sent or blocked row's text, phone or status | Pass |

Also: automations for the Phase 2–4 events (trial booked, makeup booked, instructor change, closure, payment link,
dunning, freeze approved, cancellation), the holiday notice before Pesach's Chol HaMoed, broadcasts by venue, group,
program or families who owe, editable templates, and RLS (a parent reads only their household's messages; an
instructor reads none).

## Phase 4 acceptance criteria

| Criterion | Proof | Result |
|---|---|---|
| Property-based tests on the billing rules | `packages/domain/billing/test/policies.test.ts`: nine fast-check properties: the cancellation cut-off is decided by the Israel date; proration never exceeds the price and more lessons never cost less; a seat never costs more than the month's price or less than nothing; the sibling discount is never negative or above the charge, and the most expensive child pays in full; a statement totals its rounded lines; dunning never exceeds its retries and every open case escalates on time; the balance is the same in any order and equals unpaid minus paid ahead; a reversal restores the balance; receipts always add up to the payment. Unit cases cover every other branch. 100% statements and branches on `policies.ts` | Pass |
| The pre-run review flags a charge without an enrollment, an enrollment without a charge, and a duplicate mandate | `apps/web/e2e/billing.spec.ts` AC2 (UI only): the owner opens the October draft and sees "חיוב בלי רישום · הוראת קבע פעילה בלי אף מקום בקבוצה", "רישום בלי חיוב · אין מחיר במחירון לתוכנית הזו" and "הוראת קבע כפולה · 2 הוראות קבע פעילות למשפחה אחת", each family's lines with their reasons next to last month's total. Service level: `services.test.ts` AC2 drafts September over fixtures with each case (plus proration by a freeze, the sibling discount, last month's therapy, a missing standing order), redrafts, posts and locks | Pass |
| A failed charge triggers the dunning sequence | `services.test.ts` AC3: collection charges each standing order once (a family without one gets a payment link), the Grow webhook settles one charge and declines another, the declined family's case opens with the update-card step, retries on the policy's days, escalates to the owner after ten days and closes when paid. `billing.spec.ts` AC3: the seeded declined card sits on the debts dashboard with "תיק גבייה: פתוח" | Pass |
| A reimbursement receipt contains the wording, ID, dates and payment method | `services.test.ts` AC4: the paid link's invoice-receipt sent to the fake Green Invoice carries the Ministry of Defense wording, "ת.ז. 000000018", each lesson date and "כרטיס אשראי", one document per month; the ID is stored encrypted (only the last four digits readable, parents can't select it). A profile that needs an ID with none on file stores a failed document saying why | Pass |

Also through the UI: the office records a cash payment on a family card and the balance drops, and a parent sees
their balance, standing order and history on **תשלומים**.

Totals on 2026-10-02: 415 unit/integration tests + 24 browser tests, all green. `lint`, `typecheck`, `format:check`
clean. Coverage stays 100% on the pure policy modules, now including `domain-billing` policies and the Grow and fake
provider adapters.

## Phase 3 acceptance criteria

| Criterion | Proof | Result |
|---|---|---|
| A 13h-before absence yields a credit expiring at the end of the month; an 11h one doesn't | `apps/web/e2e/attendance.spec.ts` AC1 (UI only): the owner records two WhatsApp notices for a lesson of בנים דולפין, received 13h and 11h before it. The form answers "ההודעה התקבלה 13 שעות ו-0 דקות לפני השיעור (נדרשות לפחות 12 שעות) · נפתחה השלמה" and "…רק 11 שעות… · הודעה מאוחרת לא מזכה בהשלמה"; the makeups screen shows the first credit valid until the last day of the lesson's month and no credit for the second. Service level: `packages/domain/attendance/test/services.test.ts` (policy version recorded, parents' notices wait for the worker), and the boundaries (12h00 is timely, the monthly cap, the 24h private rule, makeups off) in `policies.test.ts` | Pass |
| A 3-day venue closure issues credits to every affected active student, opens makeup windows and produces an uptake report | `attendance.spec.ts` AC2: the owner closes Gush Etzion Tuesday to Thursday, the preview lists every lesson and child (frozen children and trials get none, with the reason), opening it cancels the lessons, issues one credit per lost lesson usable from the day after the closure to the deadline, and the uptake report counts them per group. Service level: the same workflow plus booking, the last seat, closing with `expire` and `convert_to_credit`, and nightly expiry | Pass |

Also through the UI: the instructor marks attendance in one tap, a mark made offline is queued and synced when the
phone is back online, and a parent reports an absence and accepts a form in the portal.

Totals on 2026-10-02: 339 unit/integration tests + 20 browser tests, all green. `lint`, `typecheck`, `format:check`
clean. Coverage stays 100% on the pure policy modules, now including `domain-attendance` and `domain-enrollment`.

## Phase 2 acceptance criteria

| Criterion | Proof | Result |
|---|---|---|
| Generating a term skips Chol HaMoed | `apps/web/e2e/scheduling.spec.ts` AC1 (UI only): a 20.9–10.10.2026 course term is generated and the report lists 28.9 and 30.9 as חול המועד (and 21.9 as יום כיפור). Service level: `packages/domain/scheduling/test/services.test.ts`, plus the run report, re-run idempotency, venue closures and calendar overrides | Pass |
| Dragging a girl into a boys-only window is blocked with a clear Hebrew reason | `scheduling.spec.ts` AC2 on desktop (real drag and drop) and on a phone ("move to"): the sheet says "‹name› בת, והבריכה בשעה הזו פתוחה רק לגברים ובנים" and offers no confirm; nothing moves. Service level: the same refusal from `placeStudent`, and the pure rule in `policies.test.ts` | Pass |
| Instructor shift changes require acceptance | `scheduling.spec.ts` AC3: the owner asks to move a group to Noa, the group keeps its instructor, Noa accepts in the instructor app, the owner sees it accepted. Service level: only the respondent can answer (RLS + trigger, forged updates refused), the worker applies an accepted change, `scheduling.staff_changed` is emitted only then, unanswered changes escalate | Pass |

Totals on 2026-10-02: 282 unit/integration tests + 16 browser tests, all green. `lint`, `typecheck`, `format:check`
clean. Coverage stays 100% on the pure policy modules, now including `domain-scheduling` policies and `calendar`.

## Phase 1 acceptance criteria

| Criterion | Proof | Result |
|---|---|---|
| The owner configures Har Homa with gender windows and two price lists effective on different dates | `apps/web/e2e/core-setup.spec.ts` (Pixel 7, UI only): venue, pool with 4 lanes, women/girls Monday and men/boys Wednesday windows, an overlapping window refused, a 1 Sep list at ₪330 published and locked, a 1 Jan version at ₪350, price check answers ₪330 on 15.10.2026 and ₪350 on 15.1.2027. Same path at service level in `packages/domain/settings/test/services.test.ts` | Pass |
| GHL contacts are imported and linked without duplicates | `packages/domain/crm/test/import.test.ts`: a fake 14-contact fixture imported twice (second run changes nothing), duplicates inside GHL reported, phone formats normalised, OS edits pushed once, GHL webhook updates applied without echo. `webhook.test.ts`: webhook stored once per id, routed by location | Pass |

Totals on 2026-10-02: 230 unit/integration tests + 12 browser tests, all green. `lint`, `typecheck`, `format:check`
clean. Coverage stays 100% on the pure policy modules (`contracts`, `domain-settings`, `domain-venues`,
`domain-staff`, `domain-crm` policies, `integrations`).

## Phase 0 acceptance criteria (for reference)

| Criterion | Proof | Result |
|---|---|---|
| Three role-based shells render RTL on mobile | `apps/web/e2e/shells.spec.ts` (Pixel 7 Chromium): `dir="rtl"`, `lang="he"`, no sideways overflow, bottom nav starts on the right, 44px targets, screenshot baselines | 11 / 11 pass |
| RLS proves tenant & role isolation | `packages/db/test/rls/isolation.test.ts`: two orgs × 7 roles over every tenant table, forged org claim, suspended member, worker scope, sensitive columns, audit, access-token hook | 38 / 38 pass |
| Outbox delivers a test event exactly once | `packages/domain/core/test/outbox.test.ts`: crash after send then redelivery → one effect; idempotent emit; rollback emits nothing; dead-letter after max attempts | 9 / 9 pass |

Totals on 2026-10-01: 107 unit/integration tests + 11 browser tests, all green. `lint`, `typecheck`, `format:check` and `build` clean.
Coverage is 100% (statements and branches) on `money`, `contracts`, `calendar` and `domain-core`.

## Not verified yet
- Against a real LeadYourWay (GHL) location: the HTTP client follows the public API v2 description and is tested
  with a fake. Connecting needs a private integration token (`GHL_API_TOKEN`) and the location id from Pit, and the
  webhook needs `GHL_WEBHOOK_PUBLIC_KEY`.
- Against a real Supabase project: the access-token hook, SMS OTP and password sign-in are tested at the SQL and unit level, and the shells via the local demo login, but no hosted Supabase project exists yet.
- The Inngest worker has not run against Inngest Cloud or the Inngest dev server; relay and consumer logic is tested directly.

- Against real Grow and Green Invoice accounts: payments, links, refunds, webhooks and receipts run against fakes
  (`RSWIM_GROW_FAKE=1`, `RSWIM_INVOICING_FAKE=1`). Connecting them needs Pit's account details; the webhook needs
  `GROW_WEBHOOK_SECRET`. Without a provider the worker leaves billing events unconsumed and logs it.

- The parent's absence notice is classified by the worker (`attendance-process-absence`); without the worker running
  it stays "ההודעה התקבלה" until the nightly safety net or the next worker start.

## Next
Phase 5: messaging (WhatsApp and SMS through the outbox: absence answers, makeup offers, payment links, the
update-card step of dunning, schedule changes).
