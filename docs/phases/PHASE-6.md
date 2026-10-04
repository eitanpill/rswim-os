# Phase 6 — Staff Ops & Payroll

## Goal
Reut stops collecting free-text hours reports and calculating pay by hand. Hours come from the lessons each
instructor actually taught; the instructor confirms or disputes them at month end; one monthly payroll run applies
each instructor's pay rules and splits a hybrid instructor's pay into the payslip part (groups, to the accountant) and
the transfer part (privates, paid against an invoice). When an instructor cancels, the system finds qualified,
available, gender-appropriate substitutes and offers the lesson in waves; the first to accept gets it and the parents
hear who is teaching. The owner sees the coming month's staffing gaps and runs a light applicant pipeline.

## Acceptance criteria (from the brief)
1. **Payroll for a hybrid instructor produces a payslip part (groups) and a transfer part (privates) matching
   hand-calculated fixtures.** Pure `computeStaffPay` over fixture lessons and pay rules, and an integration test
   over real sessions and private slots, give exactly the hand-calculated agorot per part, with travel and an
   adjustment, and every line explains the rule it used.
2. **Substitute offers go out in waves and lock on first accept.** A cancelled lesson's request offers the first
   `staffing.substitute_wave_size` ranked candidates; the next wave opens after `staffing.substitute_wave_minutes`
   with no taker; two instructors accepting at once leave exactly one assignment (database lock + partial unique
   index), the others' offers are withdrawn, the session's lead changes and `scheduling.staff_changed` reaches parents.

## Scope

### 6.1 Database (migrations `0012_staff_ops` + `0013_staff_ops_security`)
- `timesheets`: one per staff member and month: status (open, confirmed, disputed, resolved), dispute note, who
  resolved it and how.
- `payroll_runs` (period, draft → approved, policy version, totals) and `payroll_lines` (staff, routing, kind: work,
  travel, adjustment; quantity, unit, amount, rule, source lesson, explanation). An approved run is locked.
- `payroll_adjustments`: bonuses and corrections per staff and month, with routing.
- `sick_leave_entries`: append-only accruals (by the approved run) and days taken, in half days.
- `substitute_requests` (session, instructor who cancelled, reason, status open → filled | unfilled | cancelled,
  current wave, next wave time) and `substitute_offers` (candidate, wave, rank, reasons, status queued → offered →
  accepted | declined | withdrawn).
- `applicants`: name, phone, source, stage, certifications, rate expectation, availability note, scorecard, notes.
- RLS: owner and admin manage; the worker writes; an instructor reads their own timesheet, lines (once approved),
  sick-leave balance and offers, confirms or disputes their own timesheet and answers their own offers (triggers limit
  what they may touch); the accountant reads payroll.

### 6.2 Pure policies (`packages/domain/payroll/src/policies.ts`, 100% coverage)
- `ruleFor(item, rules)`: the most specific effective rule (program + venue > program > venue > any).
- `payForItem`: per hour (minutes, rounded half up to the agora), per session, per head.
- `computeStaffPay(items, rules, adjustments)`: lines per routing, travel once per working day and venue, totals.
- `pensionStatus(monthsWorked, period, threshold)`: continuous months, eligible, newly eligible with the retro
  start month.
- `sickAccrual(employmentType, workedThisMonth, policy)`.
In `packages/domain/scheduling/src/policies.ts`: `rankSubstitutes` (rank and wave), `substituteExclusion`, `staffingGaps`.

### 6.3 Services and worker
- Work items from lessons taught (group sessions held, private slots with a booking) per staff and month.
- Timesheets: the instructor confirms or disputes; the owner resolves (with an adjustment when needed).
- Payroll run: draft (redraft replaces), approve (locks, accrues sick leave, emits `payroll.run_approved`).
- Accountant export (XLSX): payslip sheet per employee (lines, pension status, sick-leave balance) and a transfers
  sheet.
- Substitutes: request from a cancelled lesson, ranked candidates, waves (worker every five minutes), accept,
  decline, cancel; the worker puts the substitute on the session and emits `scheduling.staff_changed`.
- Staffing gaps: next month's sessions without a lead instructor, grouped by venue, weekday and time.
- Applicants: create, move stage, note; a Hebrew job-post text per venue and day.

### 6.4 Screens
- **צוות › שכר**: payroll runs, the draft per staff member split payslip/transfer, adjustments, approve.
- **צוות › מחליפים**: open requests, waves, who was offered and why; new request from a lesson.
- **צוות › חוסרים**: the coming month's gaps.
- **צוות › גיוס**: applicant pipeline and job post text.
- Instructor app: **שעות** (last and this month's lessons, confirm or dispute; approved statements and sick-leave
  balance), **החלפות** (open offers, accept or decline).
- Accountant: payroll runs with the XLSX export.
- Policy editor: the new keys.
