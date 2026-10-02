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
