# Phase 3 — Enrollment, Attendance & Makeups

## Goal
A child goes from a trial to a seat in a group with the health declaration and regulations accepted digitally. The
instructor runs every lesson from the PWA: the lineup with each child's flags, one-tap attendance that works offline,
progress ticks and the trial verdict. Absences are classified by the regulations, makeup credits are a ledger with
expiry, and families book makeups into compatible free seats. When a venue closes, one workflow cancels the affected
lessons, issues credits, opens the makeup window and reports the uptake.

## Acceptance criteria (from the brief)
1. **A 13h-before absence yields a credit expiring at the end of the month; an 11h one doesn't.**
   Proof: integration tests report absences 13h and 11h before a group session (policy `absence.notice_min_hours =
   12`, `makeup.expiry = end_of_source_month`). The first stores a `timely` notice and an open credit expiring on the
   last day of the session's month (Israel time), with the policy version that decided it; the second stores a
   `late_notice` notice and no credit, with the reason. Unit tests cover the exact boundary (12h00 is timely), the
   monthly cap, private lessons' 24h rule and summer courses with makeups off. The E2E test records both through the
   owner's screen and reads the result.
2. **A venue closure for 3 days issues credits to every affected active student, opens makeup windows, and produces an
   uptake report.** Proof: an integration test adds a 3-day closure at a venue with generated sessions and runs the
   closure workflow. Every scheduled session in the range is cancelled (`cancelled_external` or `cancelled_by_school`
   by the closure source), every child holding a seat in those sessions on that date gets one credit per lost lesson
   (frozen and ended enrollments get none; trials get none), the event's makeup window opens with its deadline, the
   marketplace offers compatible free seats, and the uptake report counts issued / booked / used / expired /
   outstanding per group. Booking a makeup moves the counts. The E2E test runs the workflow through the UI.

## Scope

### 3.1 Database (migrations `0006_attendance` + `0007_attendance_security`)
- `trials` (student, group, session date, fee snapshot, status booked | attended | no_show | cancelled, outcome fit |
  not_fit, recommended level and group, converted enrollment, offer valid until).
- `form_templates` (kind: registration | health_declaration | regulations | photo_consent, versioned text,
  effective_from, published) and `form_submissions` (household, student, guardian, template version, answers, text
  hash, accepted at, channel, who recorded it). Submissions are append-only.
- `attendance` (session × student: present | late | absent_notified | absent_late_notice | no_show | makeup | trial;
  minutes late; recorded by; client mark id for offline sync).
- `absence_notices` (student, session, channel, received_at, hours before, classification, policy version, credit).
- `makeup_credits` (student, reason notified_absence | school_cancellation | external_closure | goodwill, source
  session, expires_on, status open | booked | used | expired | converted, closure event, policy version) and
  `makeup_bookings` (credit → session, status booked | attended | missed | cancelled).
- `progress_marks` (student × level skill, achieved on, by whom, in which session).
- `closure_events` (the brief's mass cancellation events: venue, dates, source, reason, makeup window, deadline,
  end rule, status draft | open | closed) linked from cancelled sessions and from credits.
- `app.session_free_seats(session)`: capacity − seats held that day − makeups − trials + children with an absence
  notice. A makeup booking trigger locks the session and checks it, so two families cannot take the last seat.
- RLS: owner/admin everything. Instructors read and write attendance and progress for sessions they teach and read
  those sessions' notices, credits and bookings. Parents read their children's rows, add absence notices (received
  time and classification are set by the server, never by the parent) and book makeups with their children's open
  credits. Isolation rows for every table.

### 3.2 Domain
- `@rswim/domain-attendance` policies (pure, 100% branch coverage): `classifyAbsenceNotice`, `canEarnMakeup`,
  `makeupExpiry`, `attendanceStatusForArrival`, `closureTreatment`, `freeSeats`, `makeupCandidates` (program, age,
  gender window and admitted gender, level tolerance, date inside the credit's life), `canBookMakeup`,
  `uptakeReport`, `closureEndActions`.
- Services: lineup, record attendance (batch, idempotent per client mark), report and process absences, credits
  ledger, marketplace and booking, closure workflow (preview → open → close with the end rule), progress marks.
- `@rswim/domain-enrollment`: trial booking (a `trial_booked` seat on one date), outcome, conversion to an active
  enrollment with the offer and trial-fee offset (`trialOffset`), forms and regulations versions and acceptance.
- Worker: process parent absence notices, expire credits daily, close closure events at their deadline.

### 3.3 Web
- Instructor PWA: "My day" with lineups (age, level, water fear, female-instructor, photo opt-out, medical flag,
  trial and makeup badges), one-tap attendance that queues offline and syncs, progress ticks, trial verdict.
- Owner: session attendance view, absence recording (phone/WhatsApp) with the decision shown, makeup credits per
  family, trials (book, outcome, convert), forms and regulations versions, closure workflow with the uptake report.
- Parent: report an absence for an upcoming lesson, see credits, book a makeup seat, accept pending forms.

## Out of scope (later phases)
Money for trials, offsets and converted closure credits (Phase 4 ledger; Phase 3 records them and emits events).
WhatsApp sending, inbound triage and public form links (Phase 5). Monthly progress cards to parents (Phase 5).
Freezes and cancellation requests with billing effect (Phase 4).

## Risks
- Time math around DST and midnight: notices are compared as instants, expiry as Israel local dates; tests pin both.
- Offline attendance conflicts: last write per (session, student) wins by the device's mark time, and every write is
  audited.
