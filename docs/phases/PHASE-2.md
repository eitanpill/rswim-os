# Phase 2 — Scheduling Engine

## Goal
The owner turns venues, programs and staff into a timetable: recurring groups (class templates) at a venue, lane,
weekday and time; a term's sessions generated from the Hebrew calendar; children placed in groups with every hard rule
checked and soft preferences scored; private and trial slots booked; a waitlist that suggests new groups. Any change
to an instructor's shift waits for the instructor to accept it before anything reaches parents.

## Acceptance criteria (from the brief)
1. **Generating a term skips Chol HaMoed.**
   Proof: an integration test generates the autumn 2026 term (1 Sep 2026 → 31 Jan 2027) for weekly groups on every
   weekday. No session falls on Chol HaMoed Sukkot (28 Sep → 2 Oct 2026), Yom Tov, Erev Chag or Shabbat, and the run
   report lists each skipped date with its reason. A group whose program sets `calendar.chol_hamoed = run` does get
   its Chol HaMoed sessions. A venue closure removes its dates; running the generator twice adds nothing.
   The E2E test does the same through the UI and reads the skipped Chol HaMoed dates in the report.
2. **Dragging a girl into a boys-only window is blocked with a clear Hebrew reason.**
   Proof: a Playwright test opens the Group Board as the owner, drags a girl's card onto a group in a boys window and
   sees "הקבוצה בחלון בנים בלבד, ו-<name> רשומה כבת" (or similar), with the girl still in her own group. Unit tests
   cover every hard rule in the validator.
3. **Instructor shift changes require acceptance.**
   Proof: an integration test moves a group to another instructor. The change is pending, the sessions keep their
   instructor and no `scheduling.staff_changed` event exists (that event is what Phase 5 turns into parent messages).
   The instructor accepts in the instructor app; the worker applies the change and only then emits the event.
   A declined change applies nothing; a change left unanswered escalates to the owner after
   `staffing.shift_change_escalate_after_hours`. The E2E test covers owner → instructor accept → owner sees it.

## Scope

### 2.1 Database (migration `0004_scheduling` + `0005_scheduling_security`)
- `terms` (school year, summer, course windows), `hebrew_calendar_overrides` (an extra closed or open day, org-wide
  or per venue).
- `class_templates` (= a recurring group: venue, pool, lanes via `class_template_lanes`, weekday, start, duration,
  program, level range, age band, admitted gender, capacity, required instructor gender and skills, lead instructor,
  effective dates) and the `policy_sets.class_template_id` FK promised in Phase 1.
- `sessions` (generated occurrences, unique per template and date; status scheduled | cancelled_by_school |
  cancelled_external | completed; the policy versions that decided them) and `session_staff` (lead | assistant |
  substitute). `session_generation_runs` keeps each run's report (created, skipped dates with reasons).
- `enrollments`, minimal for the board: student × class template, status (the full list from the brief, Phase 3 adds
  the flow), start/end dates. A move ends one enrollment and starts the next on the same date.
- `private_slots` + `slot_bookings` (private, pair, trio, therapy, trial, makeup slots with a capacity).
- `waitlist_entries` (student, program, optional venue or group, preferred weekdays and time range, status).
- `shift_changes` (pending change: reassign a group from a date, reassign one session, or move one session's time;
  respondent instructor; pending | accepted | declined | escalated | applied | cancelled; escalate_at).
- RLS: owner/admin manage everything. Instructors read the schedule (templates, sessions, staff on sessions), their
  own slots and their own shift changes, and may only answer (accept/decline) their own pending changes. Parents read
  their children's enrollments, groups and sessions. `app.instructor_student_ids()` gets its real body (children in
  groups the instructor teaches, today −7 → +14 days). Isolation suite rows for every new table.

### 2.2 Domain `@rswim/domain-scheduling` (pure, 100% branch coverage)
- `planSessions()` — dates of a template inside a term, minus calendar blockers (per resolved policy), overrides,
  venue closures and the template's own dates; every skipped date carries its reasons.
- `checkPlacement()` — hard rules for a child joining a group: capacity, age band, admitted gender, the pool window's
  gender restriction, level range, the program's age range, not already in a group at the same time.
- `checkTemplate()` — hard rules for a group: inside one of our operating windows on its lanes and dates, admitted
  gender compatible with the window, no lane double-booking, instructor available (rules and exceptions), skilled,
  of the required gender (and the window's, per `scheduling.window_instructor_gender`), not double-booked, with
  `scheduling.travel_buffer_min` between venues.
- `scorePlacement()` — soft score with reasons: level homogeneity, siblings sequential or parallel, friends together,
  preferred instructor, waitlist time preference, fill balance.
- `shiftChangeDecision()` — whether a change needs acceptance, who answers it, and when it escalates.
- `waitlistClusters()` — "8 kids aged 3–4 waiting for Sunday 16:00 at Har Homa → open a group?".
- Calendar gains `yom_hazikaron` and `yom_haatzmaut` blockers (they are already policy options).

### 2.3 Services, events, worker
- Services: templates, terms, overrides, generate sessions, place / move / remove a child, slots and bookings,
  waitlist, shift changes (create, answer, apply, cancel).
- Events: `scheduling.sessions_generated`, `scheduling.enrollment_changed`, `scheduling.shift_change_requested`,
  `scheduling.shift_change_answered`, `scheduling.staff_changed` (after apply only), `scheduling.slot_booked`.
- Worker: `scheduling-apply-shift-change` (on accepted) and `scheduling-escalate-shift-changes` (cron, hourly).

### 2.4 UI
- Admin bottom-bar "לוח קבוצות" becomes the Group Board: venue and day filters, days as columns (stacked on a phone),
  groups ordered by time and lane, fill bars, gender and level badges, instructor and pending-change markers. Drag a
  child onto another group (and a "move to…" menu for touch and keyboard) → instant rule check → Hebrew reason or a
  confirm panel with the soft score and who will be notified.
- Groups: create/edit a group (template) with live validation, its sessions, policy link, waitlist for it.
- Terms: create a term, generate sessions, see the run report (created, skipped dates with reasons).
- Private slots: open slots for an instructor (single or weekly for N weeks), book a child, cancel.
- Waitlist: add, rank, place into a group (validator), open-a-group suggestions.
- Shift changes: owner proposes from the group page; instructor app home lists pending changes with accept/decline.

### 2.5 Seed and docs
- Seed: an autumn 2026 term, groups at both demo venues (girls and boys windows, a mixed group, a baby class),
  enrollments including siblings and a child who requires a female instructor, slots, waitlist entries, one pending
  shift change. Demo script `docs/demos/PHASE-2.md`, STATUS, DECISIONS.

## Out of scope
Lead → trial → enrollment flow, attendance, makeups and the instructor lineup (Phase 3); prices on enrollments and
billing (Phase 4); actual parent and instructor messages (Phase 5, which consumes `scheduling.staff_changed` and
`scheduling.enrollment_changed`); substitute marketplace and payroll (Phase 6); level-up messages and the venue
migration wizard (Phases 3 and 9).

## Risks
- Drag and drop on phones: HTML5 drag events don't fire on touch, so the board also offers a "move to…" picker; both
  call the same check.
- Generating on the fly for long terms: templates × weeks is small (hundreds of rows), done in one transaction.
