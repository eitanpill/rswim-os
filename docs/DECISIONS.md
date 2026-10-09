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
| 2026-10-04 | Phase 7: a family's freeze or leave request is only a request row (`portal_requests`). The database stamps who asked and when; the worker decides it within seconds with the office's own `requestFreeze` / `requestCancellation`, so the same regulations apply and the leave cut-off is decided by the moment the family asked. Parents never write billing tables, and the web app never uses the worker's role |
| 2026-10-04 | A parent's freeze follows the policy's `freeze_requires_approval` exactly like the office's: it waits for the owner when the policy says so. A request the rules refuse (overlapping dates, already leaving) is stored with the reason for the family to read |
| 2026-10-04 | The companion pass is a signed token (HMAC with a key derived from the master key), valid only on the lesson's date in Israel, checked by a public page with no login and no database. It shows only the child's first name, group, venue, time and companions |
| 2026-10-04 | Receipts download the provider's PDF. Under the fake invoicing provider (stored as provider `fake`) the portal renders an HTML copy of the stored document instead, marked as a copy; the signed document is the one Green Invoice emails |
| 2026-10-05 | Phase 8: a run's stages and marks are append-only events. The database stamps the escort's taps with `auth.uid()` and `now()` (no backdating); only the office may remove a mistaken tap. An escort writes only today's runs of their own routes |
| 2026-10-05 | Transport messages go to the children on board (marked "on board"); when the escort marked nobody, to every rider not marked missing. A tap older than `transport.stale_after_min` (30 min) is recorded but messages nobody |
| 2026-10-05 | Runs open at 06:00 by the worker (routes whose weekday matches and whose group has a scheduled lesson), and again lazily when the escort opens the app; the office can open one by hand for any day |
| 2026-10-05 | Escort pay is not computed from runs yet: the office adds it as a payroll adjustment for the month until Reut's pay sheet defines a per-run rate. Drivers are an outside service (name and phone on the route), not staff |
| 2026-10-05 | Phase 8: a course or camp week is a cohort of existing groups (`class_templates.cohort_id`), so lessons, attendance and the instructor app work unchanged. Registration creates the places; a cancellation before the start removes them (nothing billed), after the start ends them today and the regulations decide any refund |
| 2026-10-05 | A camp's staff ratio counts the groups' lead instructors plus the cohort's extra staff, each person once. Registration beyond the ratio is refused with the numbers, until staff is added |
| 2026-10-05 | Roster "PDFs" and the institution attendance report are print-ready pages: the browser prints them or saves them as PDF. A generated PDF file joins with document storage |
| 2026-10-05 | Parents do not register for courses or camps in the portal yet: the office registers (a parent self-registration flow with payment joins in a later phase) |
| 2026-10-05 | Institutions: a group is paid by at most one contract at a time; for any month a contract touches, the families are not billed for that group. Invoices are per contract and month, priced per child on the roster, per lesson held (cancelled lessons are not charged) or a fixed sum, with the Hebrew wording in `INSTITUTION_FISCAL_TEXT_HE` |
| 2026-10-05 | An institution invoice is a tax invoice issued when the office approves it, due after the contract's payment terms; payments against it get receipts. Partial payments are allowed, more than the balance is refused, and payments are append-only (a mistake is reversed by the office in the provider and recorded as a note until credit notes for institutions exist) |
| 2026-10-06 | The Group Board shows the regular weekly groups only. Course and camp groups (those in a cohort) are left off it and run from their cohort page, where registration and the ratio live |
| 2026-10-06 | Phase 9: a migration maps each group one of two ways. Relocate keeps the group (children, freezes, history) and moves it; merge ends the children's places on the date, starts new ones in the target and cancels the source group's lessons from the date (reason `venue_migration`, no makeup) |
| 2026-10-06 | A relocated group's lead instructor is kept by default; the owner may pick another or leave it with no lead for now (the lesson shows as uncovered). The price shown is the monthly price list of the new venue for the migration month; when no list covers a side it shows as unknown, not zero |
| 2026-10-06 | A migration's revert is allowed inside `migration.revert_hours` (24) and is refused once billing charged any place it created; the families get a "the change was cancelled" message |
| 2026-10-06 | Reports and the copilot's read tools are a read model: SQL over the tables, run as the signed-in owner under RLS, never written to. This bends "modules talk via services" for reads only, the same way the dashboard does |
| 2026-10-06 | Venue revenue is attributed by where each lesson was held in the month, so a migration mid-month splits the month between venues. A revenue-share rent contract is shown as unknown rather than guessed |
| 2026-10-06 | Churn: required structured reason on every cancellation (office and portal; a portal request without one stores `other`). Transfers between groups, completed places and courses/camps are not counted |
| 2026-10-06 | The funnel's source is LeadYourWay when the guardian has a GHL contact id, otherwise office; branch is the venue of the first trial, else of the first place |
| 2026-10-06 | Copilot: owner only, off by default. Claude (`claude-opus-5-5`, adaptive thinking) runs a manual tool loop inside the owner's own transaction; it only proposes, and confirmed actions run the ordinary services. A rules-based stand-in (`RSWIM_COPILOT_FAKE=1`) understands fixed Hebrew phrasings for demos and tests. Undo exists for moves only (a move back); a message cannot be unsent |
| 2026-10-06 | The demo tenant has the copilot turned on in its org rules so the fake can be shown; real tenants start with it off |
| 2026-10-06 | Phase 10 SaaS: a school without a subscription has no limits and every feature, so existing tenants and tests keep working; the demo school is on `pro`, the isolation tenant on `growth` |
| 2026-10-06 | Plan limits are checked by a trigger at insert time and count every student record, active staff and venues that are not closed. Two concurrent inserts may pass the limit by one; we accept that rather than lock the school's rows |
| 2026-10-06 | Platform billing is monthly in advance at the full plan price with no proration. The idempotency key carries the attempt (`platform:<org>:<month>:<attempt>`) so a declined invoice can be retried without the provider treating it as a duplicate |
| 2026-10-06 | Suspension locks only the school's office (to its plan page); parents, instructors and escorts keep working, so children are not hurt by a billing problem |
| 2026-10-06 | Plan changes and payment mandates are set by a platform admin from `/platform` until the platform has its own Grow account and card capture; there is no self-serve upgrade yet |
| 2026-10-06 | Custom domains are verified by a DNS TXT record `_rswim.<host>` = `rswim-verify=<token>`. The demo/E2E fake (`RSWIM_DNS_FAKE=1`) verifies any `*.localhost` host by itself. Hosting the domain (TLS, routing) is a deployment step outside the app |
| 2026-10-06 | Branding is a display name plus one hue from a fixed palette (sea, turquoise, green, orange, coral, pink, purple) mapped to the same lightness and chroma as the default theme, so contrast holds; no logo upload or free CSS yet |
| 2026-10-06 | A new school's encryption key is created by the worker (as platform plumbing) on `platform.school_created`, since the master key never reaches the web app's request path. Its message templates are added as the new owner right after sign-up |
| 2026-10-06 | Templates: installing regulations creates a policy version from today, or the next day without one; a catalog adds missing programs and levels by code and a draft price list the owner reviews and publishes; messages replace matching wording. Schools share their own setup as a submitted template that a platform admin reviews before anyone else sees it |
| 2026-10-06 | One user may own up to 3 schools; a signed-in user with no school lands on `/onboarding`, which also tells a parent without a family to ask their school for an invite |
| 2026-10-08 | Owner insights are advisory only (Pit: "help manage, decide and keep order", no actions). Rules decide what is an insight; Claude only writes the explanation and next step, in one call per school from the worker, outside any transaction. A note is kept only while the insight's facts are unchanged; without Claude the feed shows built-in wording |
| 2026-10-08 | Insights are stored one row per key (`owner_insights`, office only) and reconciled daily: new ones open, ones that no longer hold are resolved, a dismissed one stays hidden for `insights.snooze_days` and returns if still true. The weekly digest adds the insight kinds it did not already cover (churn risk, leaving, emptying groups, trial follow-up, uncovered lessons, instructor load) |
| 2026-10-08 | The command center now shows real numbers: today's lessons and expected children, this month's charged and collected, children in groups against 30 days ago, and trials this month |
| 2026-10-08 | Parents' bot: off by default (`comms.bot_enabled`), on in the demo school. It answers only known families, from their own data, the policy in force and the office's approved questions and answers; it never changes data. Complaints, leaving, health, refunds, safety and unhappiness go to a person without the model seeing them |
| 2026-10-08 | The bot learns by suggestion, not by itself: the office's answer to a handed-off question becomes a suggested entry the office edits and approves, because a reply to one family often carries that family's details. No model fine-tuning |
| 2026-10-08 | The bot's answers go out through the normal send window, so a question on Shabbat is answered after Shabbat. The "we passed it on" note goes at most once every 2 hours per family. Answers are not signed as automatic; the school can say so in its own words if it wants |
| 2026-10-08 | The bot reuses the copilot's model loop (Claude `claude-opus-5-5`, at most 6 turns) and lives in `@rswim/domain-copilot`; its log and knowledge are comms tables visible to the owner and admins only |
| 2026-10-08 | Live demo (for selling to other schools): one container with Postgres, the Inngest dev server, the worker and the web app on the fake seed, hosted on Railway (or Render, or any Docker host). No Supabase, Vercel or Inngest account. `RSWIM_DEMO_MODE=1` turns on persona sign-in even in production builds, a demo banner and a role-picker front door; `start.sh` forces every fake provider and drops real keys. Real Claude only with `RSWIM_DEMO_REAL_CLAUDE=1` |
| 2026-10-08 | The live demo wears a neutral name ("שחייה בכיף (דמו)", owner "יעל") set after seeding, so nothing of R-SWIM or Reut shows; the seed itself and its tests keep their names. The data is rebuilt at boot, nightly at 03:00 and on `/dev/reset?key=…` |
| 2026-10-08 | Inngest refuses a whole app when one function has more than 10 triggers. The family-messaging automation listened to every resolver event in one function, so the worker could never register; it is now split into functions of at most 10 events sharing one consumer name, and a test keeps every function at 10 or fewer |
| 2026-10-08 | Route handlers redirect with a relative Location: behind a host's proxy `request.url` names the server's own address (`localhost:3000`), not the one the browser used |
| 2026-10-08 | Live demo profiles (`RSWIM_DEMO_PROFILE`): `swim` (default) and `freediving`. A profile renames the seed after seeding (venues, programs, levels and skills, groups, cohorts, forms, and every copy of those names in charges, receipts and messages), ages the young children by ten years and drops baby swimming, and swaps swimming words in the UI messages. The seed and its tests are unchanged; the rename runs with triggers off because published price lists and the ledger refuse edits |
| 2026-10-09 | Freediving is a vertical, not a dressing. `organizations.vertical` (`swim` / `freediving`) routes a club's people to `/dive`, and the club has its own module (`packages/domain/dive`, 16 `dive_*` tables with RLS) for what a freediving club actually runs: dive sites and sea conditions, sessions with lines and buddies, agency courses with skills, passes, gear rental, a dive log with personal bests, a safety log, leads. Auth, tenancy, plans, the outbox and the platform console are shared. The freediving demo profile no longer renames the swim school; the club is its own tenant beside it |
| 2026-10-09 | One certification ladder across agencies (0 none … 5 instructor) so a Molchanovs Wave 2 and an AIDA 3 diver are equal for eligibility and depth ceilings; the agency and course name are kept as text |
| 2026-10-09 | The sea call (go / caution / no-go) is computed from the rules version in force (wind, waves, visibility, current), never typed in; a diver's allowed depth is the shallowest of level ceiling, personal best plus one progression step, an instructor's limit and the site's depth, and the screen says which one decided |
| 2026-10-09 | Club roles map onto the existing ones: owner; manager = admin with `settings.write`; office = admin without it; instructor; customer = `parent` (a diver is their own guardian). No new role in `memberships` |
| 2026-10-09 | A dive that ends in LMC, blackout or squeeze opens a safety-log incident in the same transaction; sales are append-only like the ledger |
