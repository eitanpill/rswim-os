# Decisions log

Architecture decisions live in `docs/adr/`. This file holds product defaults and assumptions.

## Open questions from the brief (default in use)

| # | Question | Default in use | Status |
|---|---|---|---|
| 1 | Invoicing provider: Green Invoice (Morning) vs iCount | **Green Invoice**, behind `InvoicingProvider` | To validate |
| 2 | Messaging: WhatsApp via GHL vs direct Cloud API | **GHL now**, `MessagingProvider` adapter ready for Cloud API with a dedicated business number | To validate |
| 3 | Makeup enforcement strict vs soft | **Strict, with logged owner override** | To validate |
| 4 | Do venue/authority closures generate credits? | **Configurable per event; default "makeups offered, no refund"** | To validate |
| 5 | Proration for mid-month start/stop | **Per remaining sessions in the month** | To validate |
| 6 | Pension eligibility threshold | **Configurable, 3 months with retro** | To validate with accountant |
| 7 | Parents self-book makeups without approval? | **Yes, within policy and capacity** | To validate |
| 8 | Trial fee offset | **Offset if enrolling within 14 days, printed on the link** | To validate |

## Assumptions to validate with the owner

| # | Assumption | Why it matters |
|---|---|---|
| A1 | Sibling discount applies to the **2nd and later** children, on the **cheaper** enrollment(s) | Changes monthly totals for families with 3–4 kids |
| A2 | Cancellation cut-off "25th" means end of the 25th, Israel time, in the month **before** the first uncharged month | Billing correctness |
| A3 | Absence notice threshold is `≥ 12h` (exactly 12h counts as timely) | Edge case in makeup credit |
| A4 | Makeup credits from closures **do not** count against the 1-per-month cap and expire at the event's deadline, not month end | Closure campaigns after the war gave multiple makeups |
| A5 | Consumer prices are **VAT-inclusive** | Receipt lines and price lists |
| A6 | Household = billing unit; divorced parents can be two guardians on one household, or two households splitting a student's enrollment (Phase 4 decides split billing) | Custody cases in the data |
| A7 | A student can hold more than one active enrollment (e.g., group + private) | Pricing and makeups per enrollment |
| A8 | Yom HaZikaron evening and Tisha B'Av are no-lesson days by default; Yom HaAtzmaut is a normal day unless overridden | Session generation |
| A9 | Parents log in by **SMS OTP** in Phase 0; WhatsApp OTP added once a WhatsApp sender is set up | Supabase phone auth providers |
| A10 | Staff log in by email + password; instructors without email can use phone OTP with the instructor role | Some instructors are students |
| A11 | One business Grow account per tenant (separate business bank details, not personal numbers) | Ends the Reut/Asaf account split |
| A12 | Sick-leave accrual uses Israeli statutory 1.5 days/month | Accountant to confirm |

## Technical decisions (non-ADR)

| Date | Decision |
|---|---|
| 2026-10-01 | Docs drafted in shared project files (`rswim-os/`) until a GitHub repo is attached; they move into the repo root unchanged |
| 2026-10-01 | Node 22 LTS, pnpm 9, TypeScript 5.x strict |
| 2026-10-01 | i18n: `next-intl`, `he` default, `en` secondary |
| 2026-10-01 | IDs: `gen_random_uuid()` defaults for now; switch to UUID v7 when a table needs time-ordered keys |
| 2026-10-01 | No GitHub repo yet: Phase 0 is built as a local git repo (`rswim-os/`), pushed once a repo exists |
| 2026-10-01 | Next.js pinned to 15.5.x (brief says 15; 16 is out). TypeScript pinned to 5.9 (7.0 is too new for typescript-eslint). Tailwind 4 |
| 2026-10-01 | tRPC deferred to Phase 1: Phase 0 has no client-side data fetching, so Server Actions cover it |
| 2026-10-01 | Surfaces are real path segments (`/admin`, `/instructor`, `/parent`, …) rather than `(group)` folders, so the middleware can guard by prefix |
| 2026-10-01 | One membership per user per org (unique). Someone who is both admin and instructor (Asaf) is an `admin` linked to a staff record; admins can open the instructor surface |
| 2026-10-01 | Local demo login (`RSWIM_DEV_AUTH=1`) so shells and E2E run without a Supabase project. Refused when `VERCEL_ENV=production` |
| 2026-10-01 | Fake phone numbers in seeds use the `050-000xxxx` range |
| 2026-10-01 | Staff invite flow moved to Phase 1 (with staff profiles); Phase 0 ships the membership model, hook and guards it will use |
| 2026-10-02 | Phase 1 keeps every table in `packages/db` (one schema, one migration history) instead of `packages/domain/<module>/schema.ts`; modules still read other modules only through services |
| 2026-10-02 | The web app reads and writes through Drizzle as the signed-in user (`asUser`) on every admin screen, so RLS decides what each role sees. Supabase is used for auth only |
| 2026-10-02 | A policy set or published price list may be **inserted** with a start date in the past (e.g. entering the current season's prices). Once in effect it is history: only its end date (not before today) or archiving may change. History goes only when its organization is deleted (offboarding, demo re-seed) |
| 2026-10-02 | Gender windows gained `female` (women and girls) and `male` (men and boys) besides the narrower women/men/girls/boys, matching how the venues publish their hours |
| 2026-10-02 | GHL tag → field mapping is tenant configuration (`org_settings.integrations.ghl.tagMap`); R-SWIM's vocabulary is the default for the first tenant |
| 2026-10-02 | GHL dedupe order: GHL id, then phone (normalised to +972), then email. Contacts that collide inside GHL are reported for review, never merged automatically. On link, the guardian's own data wins and is pushed to GHL once |
| 2026-10-02 | Two-way sync without echo: a hash of the synced fields is stored on the guardian; a push is skipped when nothing changed since the last exchange, and an applied webhook sets the hash so it is not pushed back |
| 2026-10-02 | GHL is built and tested against a fake client and recorded fake contacts only. The API token stays in the worker's environment (`GHL_API_TOKEN`), never in the database; connecting the real account waits for Pit |
| 2026-10-02 | Policy editor shows money in shekels and percentages in percent; rules store agorot and basis points |
| 2026-10-02 | Staff invite links are one-time: only a SHA-256 of the token is stored, the link is shown once, and acceptance checks the invited email or phone against the signed-in user |
| 2026-10-02 | Student relations (siblings, friends) are stored once per pair with the lower id first |
| 2026-10-02 | Phase 2: the first lead instructor of a new group is a shift change too, so the instructor accepts it like any other (`staffing.shift_change.requires_acceptance` can turn acceptance off) |
| 2026-10-02 | Changing the weekday, time, length or venue of a group that has an instructor and sessions ahead is refused: end the group on a date and open a new one, so no instructor's shift moves without asking |
| 2026-10-02 | An accepted shift change is applied by the worker (`scheduling-apply-shift-change`), and only an applied change emits `scheduling.staff_changed` (what Phase 5 turns into parent messages). The owner can apply without acceptance; that is logged in the audit trail |
| 2026-10-02 | Unanswered changes escalate to the owner after `staffing.shift_change.escalate_after_hours` (hourly worker cron) |
| 2026-10-02 | Instructors in gender-separated windows must match the window (`scheduling.window_instructor_gender = match_window`), the common rule at religious venues |
| 2026-10-02 | Placement scores are tuning constants in code, not policy rows: they only order suggestions and never block |
| 2026-10-02 | A move on the board ends the old enrollment on the move date and starts the new one the same day, linked through `previous_enrollment_id`, so billing (Phase 4) sees one continuous seat |
| 2026-10-02 | Session generation is idempotent per (group, date) and every run stores its report (created, existing, each skipped date with reasons and the policy version used) |
| 2026-10-02 | Booking forms list up to 500 students in a select for now; a type-ahead search replaces it when a tenant outgrows that |
| 2026-10-02 | Composite FKs from groups and slots to programs cascade like the other program FKs; the app never deletes programs (it deactivates them), so only deleting an organization reaches it |
| 2026-10-02 | Phase 3: a family's absence notice is stored as received now and classified by the worker (`attendance.absence_reported`); only the office's notices are decided in the same request. A parent never runs the code that decides their own credit, and the database forces the parent's channel, time and status |
| 2026-10-02 | Policy sets, programs and levels are readable by every member (parents included): the portal explains decisions with the regulations, and none of them hold personal data |
| 2026-10-02 | Makeup fit (age, level, gender, female instructor) is checked in the domain policy; the booking trigger re-checks ownership, the credit, expiry and the free seat under a row lock, so the last seat cannot be sold twice |
| 2026-10-02 | The makeup marketplace reads seats through `app.makeup_session_facts`, which tells a family how many seats are free and what a group admits, never who is in it |
| 2026-10-02 | Hosted Supabase: turn off the Data API (PostgREST) for the project; every read and write goes through the app as the signed-in user |
| 2026-10-02 | Private-lesson absences and credits move to Phase 4 with private billing; Phase 3 credits come from group lessons, closures and goodwill |
| 2026-10-02 | "Active subscription" for makeups (`makeup.requires_active_subscription`) means an active enrollment until billing exists in Phase 4 |
| 2026-10-02 | Holiday closures count as the school's own cancellation (guaranteed makeup); venue, authority, technical and water-quality closures are external (best effort) |
| 2026-10-02 | Money effects of Phase 3 only emit events: `enrollment.trial_converted` carries the trial-fee offset and `attendance.closure_credits_converted` the converted credits, for the Phase 4 ledger |
| 2026-10-02 | Public form links for families without a portal login move to Phase 5 (messaging); until then the office records paper and phone acceptances |
| 2026-10-02 | New policy key `health.declaration_valid_months` (default 12): a health declaration is due again after that many months |
| 2026-10-02 | Frozen seats still count as held when computing free seats: a frozen child may come back, so their seat is not sold as a makeup |
| 2026-10-02 | Office makeup bookings that break a soft rule (age band, level distance, no active enrollment) need a note, kept with the booking (`makeup.enforcement = strict_with_override`); hard rules (gender, own group, no seat, expiry) cannot be overridden |
| 2026-10-02 | Instructor attendance syncs from a localStorage queue; each tap has a device id and time, the server keeps each child's latest tap by device time, and a replay changes nothing |
| 2026-10-02 | `optionalText` and the other blank-to-null helpers treat `null` as blank, so a parsed value validates again unchanged (actions validate for field errors, services validate again) |
| 2026-10-02 | Attendance stores present / late / absent with the row's kind (member, makeup, trial) instead of the plan's seven statuses; whether an absence was notified comes from `absence_notices`, so one fact is never stored twice |
| 2026-10-02 | Phase 4: group seats are charged in advance for the month; private lessons, therapy slots and trial fees are charged in arrears, in the next month's run, so a late cancellation is known before it is charged |
| 2026-10-02 | Billing runs are draft → posted, or discarded. Drafting again replaces the draft, so the owner fixes what the review flagged and drafts again; a posted month cannot be drafted again (corrections are ledger entries) |
| 2026-10-02 | The review's "charge without an enrollment" is a standing order with no seat behind it (or a seat line whose seat is gone); "enrollment without a charge" is a seat with no price or no line. A family that owes and has no standing order is flagged too, and collection sends it a payment link |
| 2026-10-02 | A run collects no more than the family owes after credits (min of the run's total and the balance), so credits and earlier payments are never charged again |
| 2026-10-02 | Payments settle charges first in, first out; a sibling discount settles with its child's seat. Receipts list what the payment settled |
| 2026-10-02 | Hebrew fiscal wording (payment methods, "ת.ז.", "חודש", the prepayment note) lives in `FISCAL_TEXT_HE` in contracts: it goes to the tax document, not the UI, so it is not an i18n string |
| 2026-10-02 | Grow webhooks are taken in our own normalized format (`charge.succeeded`, `charge.failed`, `link.paid`) signed with HMAC-SHA256 in `x-grow-signature` (`GROW_WEBHOOK_SECRET`). The real adapter maps Grow's callbacks onto it once the account exists |
| 2026-10-02 | A freeze does not change the enrollment's status: billing reads approved freezes by date, so a freeze that ends needs no second update |
| 2026-10-02 | The payer's ID number is stored encrypted with the org key (only the last four digits readable); a reimbursement profile that needs it and has none stores a failed document with the reason instead of issuing a receipt without it |
| 2026-10-02 | Freeze attachments (a medical certificate) are optional for now: file uploads arrive with document storage |
| 2026-10-02 | Importing existing standing orders from Grow waits for the account; until then the office enters the mandate id by hand on the family card |
| 2026-10-02 | Without a payment or invoicing provider set up (`RSWIM_GROW_FAKE=1` / `RSWIM_INVOICING_FAKE=1` for demos), the worker leaves the event unconsumed and logs it, so nothing is marked done that never happened |
| 2026-10-02 | The demo price list leaves the adults program without a price on purpose, so the October run's review shows an enrollment without a charge |
| 2026-10-04 | Phase 5: the deterministic Hebrew rules classifier decides every inbound message in the webhook request, so the draft action exists before GHL gets its answer. Claude (`claude-opus-5-5`, low effort, strict JSON output) only re-classifies afterwards in the worker when `comms.ai_triage` is on, and may replace a pending draft but never an approved one |
| 2026-10-04 | The AI classifier runs without server-side model fallbacks: if the call fails, is refused or returns something off-schema, the rules classifier's verdict stands and the message is not lost |
| 2026-10-04 | An absence draft needs a lesson of that child on the date the message names; without one (no lesson that day, two children named, no date) the message goes to the office as needs-human instead of guessing |
| 2026-10-04 | The send window is decided twice, when a message is queued and again when the dispatcher picks it up, so a message delayed into Shabbat or quiet hours is held, never sent. Held messages go out when the window ends, oldest first, within the rate limit |
| 2026-10-04 | Messages are one per child and guardian for child events (two children, two messages), and one per guardian for household events (payment link, dunning), so a template's variables are always filled |
| 2026-10-04 | `closure_closed`, `receipt_ready` and lesson reminders are not automated yet: closures message on opening, receipts are emailed by Green Invoice, and reminders wait for the parents' own preference setting |
| 2026-10-04 | Broadcasts are free text (no per-family variables) to every guardian of the segment's households; a scheduled broadcast is expanded by the worker at its time, and opted-out guardians are logged as blocked |
| 2026-10-04 | The outbound log is append-only in practice: a sent or blocked message keeps its status, text and phone (database trigger), and rows are deleted only with their organization |
| 2026-10-04 | Phase 6: hours come from the lessons taught (group sessions held, private and therapy slots with a booking), never from free-text reports. Each instructor confirms the month or disputes it with a note; an open dispute blocks approving payroll until the owner closes it, with a correction when needed |
| 2026-10-04 | A group lesson's per-head pay counts the children holding a seat that day (active, frozen, cancel requested, trial booked); attendance does not change pay |
| 2026-10-04 | Travel is paid once per working day and venue: the largest allowance among that day's rules there, routed with that rule (payslip first on a tie) |
| 2026-10-04 | Payroll runs are draft → approved. Drafting again replaces the draft; an approved month is locked by the database, and a later correction is an adjustment in the next month |
| 2026-10-04 | An instructor sees their hours at any time but money only for approved months; bonuses and corrections stay hidden until approval |
| 2026-10-04 | The instructor's statement is a breakdown of what the school pays, not a legal payslip: the accountant issues the payslip from the XLSX export (payslip sheet with pension status and sick-leave balance, transfers sheet) |
| 2026-10-04 | Substitute offers reach instructors in the app (החלפות), not by WhatsApp: staff messaging joins when the instructors' WhatsApp opt-in is collected. The first accept wins under a database lock; the worker then changes the lesson's lead and parents hear who is teaching |
| 2026-10-04 | Only instructors with a valid swim-instructor certificate are offered substitutions |
| 2026-10-04 | Applicants are a pipeline only: hiring one does not create a staff member (the owner adds them on צוות, with their certificates and pay rules) |
