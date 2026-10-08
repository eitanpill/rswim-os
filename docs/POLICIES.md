# Policy Catalog (תקנון → configuration)

Every rule below is a **key in `policy_sets.rules`** (ADR-0004), resolved by scope `class_template > venue_program > program > venue > org` and effective date. Values shown are **R-SWIM defaults** from the current regulations and the conversation analysis. Nothing here is hard-coded.

The keys are defined, typed and range-checked in `packages/contracts/src/policy.ts` (`PolicyRules`); the owner edits them in **עוד › מדיניות**. Keys this page lists that the schema does not have yet (`trial.fee_agorot`, which is a price list item, `absence.private.late_notice`, `health.medical_cert_required_for`, `gear.required`, `receipts.*`) are added by the phase that first uses them.

Each rule lists: key · default · evaluated by · notes. "Override" means an owner can approve an exception, logged in `policy_overrides`.

## 1. Billing & subscription

| Key | Default | Function | Notes |
|---|---|---|---|
| `billing.method_required` | `standing_order` | `chargeForMonth` | Households without a mandate get a payment link automatically |
| `billing.run_day` | `1` | billing scheduler | Day of month the run is drafted; charging after owner review |
| `billing.cancellation_cutoff_day` | `25` | `cancellationEffectiveMonth` | Request on/before the 25th (Asia/Jerusalem, end of day) → last charged month is the current one; after → next month is charged too |
| `billing.absence_refund` | `none` | `chargeForMonth` | Absence for any reason → no refund/offset |
| `billing.proration` | `per_remaining_sessions` | `prorate` | Mid-month start/stop: price × remaining sessions ÷ scheduled sessions in month (DECISIONS #5). Rounded half-up to the agora |
| `billing.proration_min_sessions` | `1` | `prorate` | Start with 0 sessions left → begins next month |
| `billing.freeze_charge` | `none_while_frozen` | `chargeForMonth` | Approved freeze months are not charged; partial-month freeze prorated |
| `billing.freeze_requires_approval` | `true` | freeze service | Reason + attachment (medical cert) required for medical freezes |
| `billing.annual_early_termination` | `pay_difference_to_monthly` | `annualTermination` | Refund = paid − (months used × monthly price) |
| `billing.closure_credit` | `none` | `closureTreatment` | External closure → no refund; per-event override (DECISIONS #4) |
| `billing.anomaly_change_bp` | `3000` | `detectAnomalies` | The pre-run review flags a family whose total moved more than 30% from last month |

### Dunning (גבייה) (Phase 4)
| Key | Default | Rule | Notes |
|---|---|---|---|
| `dunning.first_retry_days` | `1` | `dunningNextStep` | Days after the failed charge before the first retry (or link resend when there is no standing order) |
| `dunning.retry_interval_days` | `3` | `dunningNextStep` | Days between later retries |
| `dunning.max_retries` | `3` | `dunningNextStep` | Automatic retries before only the owner can move the case |
| `dunning.escalate_after_days` | `10` | `dunningNextStep` | Days after opening when the case goes to the owner (`billing.dunning_escalated`) |
| `dunning.pause_enrollment` | `false` | `dunningNextStep` | Carried on the escalation event; pausing a seat stays the owner's decision |

## 2. Discounts

| Key | Default | Function | Notes |
|---|---|---|---|
| `discount.sibling.kind` | `percent` | `applyDiscounts` | `percent` or `flat` |
| `discount.sibling.percent_bp` | `1000` (10%) | | Applied to 2nd and later children |
| `discount.sibling.flat_agorot` | `3000` (₪30) | | Used where kind = flat |
| `discount.sibling.applies_to` | `cheapest_first` ⟶ *assumption* | | Which child gets the discount; logged in DECISIONS |
| `discount.stacking` | `best_single` | | Promo + sibling do not stack unless set to `additive` |

## 3. Trials

| Key | Default | Function | Notes |
|---|---|---|---|
| `trial.fee_agorot` | price list item `trial` | price lookup | ₪50 group, ₪75 Gilo, ₪90–100 Vert, ₪160 private |
| `trial.offset.enabled` | `true` | `trialOffset` | |
| `trial.offset.amount` | `full_trial_fee` | | Or a fixed amount; **always printed on the payment link** |
| `trial.offset.valid_days` | `14` | | Enroll within N days of the trial (DECISIONS #8) |

## 4. Attendance

| Key | Default | Function | Notes |
|---|---|---|---|
| `attendance.late_threshold_min` | `10` | `attendanceStatusForArrival` | Late > 10 min = absence |
| `attendance.leave_early_counts_as` | `attended` | | |
| `attendance.no_water_counts_as` | `attended` | | Came but didn't enter the water |

## 5. Absence notices & makeups (השלמות)

| Key | Default | Function | Notes |
|---|---|---|---|
| `absence.notice_min_hours` | `12` (groups), `24` (private/pair/trio/therapy) | `classifyAbsenceNotice` | Measured from `received_at` to session `starts_at`. `≥` threshold = timely |
| `absence.timely_earns_makeup` | `true` | `canEarnMakeup` | 13h → credit; 11h → none (Phase 3 AC) |
| `absence.late_notice_charge` | `charged_no_makeup` | | |
| `absence.no_show_charge` | `charged_no_makeup` | | |
| `absence.private.late_notice` | `charged_full` | | Private lessons: 24h cancellation |
| `makeup.max_per_month` | `1` | `canEarnMakeup` | Counted per student per calendar month |
| `makeup.expiry` | `end_of_source_month` | `makeupExpiry` | Same month only, no carry-over |
| `makeup.requires_active_subscription` | `true` | `canBookMakeup` | |
| `makeup.self_booking` | `true` | `canBookMakeup` | Within policy and capacity (DECISIONS #7) |
| `makeup.level_tolerance` | `1` | makeup marketplace | Levels apart a makeup group may be. Age, gender window and same program are always checked; venue is any active one |
| `makeup.double_lesson_allowed` | `false` (groups), `true` (private) | | Configurable per program |
| `makeup.enforcement` | `strict_with_override` | | DECISIONS #3 |

## 6. Cancellations by school vs. external

| Key | Default | Function | Notes |
|---|---|---|---|
| `closure.school_makeup` | `guaranteed` | `closureTreatment` | Makeup credit, no expiry cap beyond event deadline |
| `closure.external_makeup` | `best_effort` | | Technical, water quality, fecal incident, venue decision, authorities. Credit issued with event deadline |
| `closure.external_refund` | `none` | | Owner can change per mass-cancellation event |
| `closure.event_end_rule` | `expire` | | `expire` / `convert_to_credit` / `partial_refund`, decided per event |
| `closure.makeup_cap_bypass` | `true` | | Closure credits do not count against `makeup.max_per_month` *(assumption)* |

## 7. Calendar

| Key | Default | Function | Notes |
|---|---|---|---|
| `calendar.no_lessons_on` | `[shabbat, erev_chag, yom_tov, yom_kippur, tisha_bav, yom_hazikaron_evening]` | session generator | |
| `calendar.chol_hamoed` | `skip` | | Camps/summer courses may set `run` |
| `calendar.holiday_makeup` | `none` | | No refund/makeup unless stated |
| `calendar.holiday_notice_days_before` | `3` | (unused) | Superseded in Phase 5 by `comms.holiday_notice_days_before` |

Also available for `calendar.no_lessons_on` (off by default): `yom_hazikaron` (the day itself) and `yom_haatzmaut`.
The school's own exceptions (a closed day, or open despite a holiday) are `hebrew_calendar_overrides` rows, org-wide or
per venue; a venue closure always wins.

## 7a. Scheduling (Phase 2)

| Key | Default | Used by | Notes |
|---|---|---|---|
| `scheduling.travel_buffer_min` | `30` | instructor checks | Minimum gap when one instructor teaches at two venues back to back |
| `scheduling.window_instructor_gender` | `match_window` | instructor checks | In a women-only window only women teach (men-only: men). `any_gender` turns it off |
| `scheduling.open_group_min_waiting` | `5` | waitlist suggestions | Waiting families with the same program, day and age band that make "open a group" worth suggesting |

Soft placement scores (`SCORE_WEIGHTS` in `packages/domain/scheduling/src/policies.ts`) are tuning values for the
suggestion order, not business rules, so they live in code (DECISIONS 2026-10-02).

## 8. Health, safety, consent

| Key | Default | Notes |
|---|---|---|
| `health.declaration_required` | `true` | Before first lesson |
| `health.declaration_valid_months` | `12` | A new declaration is due after this many months (Phase 3) |
| `health.medical_cert_required_for` | `[declared_limitation]` | Owner may require |
| `consent.photo_default` | `granted_unless_opt_out` | Opt-out in writing (form) |
| `regulations.acceptance_required` | `true` | Versioned text + timestamp + phone/IP |

## 9. Venue entry

| Key | Default | Notes |
|---|---|---|
| `venue.companions_per_child` | `1` | Har Homa |
| `venue.extra_child_fee_agorot` | `2000` | ₪20 extra sibling (Har Homa) |
| `venue.entry_window` | `lesson_time_only` | Extra facility use may be charged |
| `venue.father_escort_in_women_hours` | `false` | Gender windows |

## 10. Program-specific overrides

### Summer intensive course (`program = intensive_course`)
- `makeup.*` → disabled unless owner override
- `enrollment.transfers_allowed` → `false` (fixed groups)
- `gear.required` → `[goggles, cap_if_long_hair]`
- `health.sick_children_allowed` → `false`
- separate `regulation_version`

### Private / pair / trio / therapy
- `absence.notice_min_hours` → `24`
- `makeup.double_lesson_allowed` → `true`

### Therapy
- `receipts.reimbursement_wording` → `"טיפולי הידרותרפיה"`; receipts list session dates, client ID, payment method.

## 11. Staff & payroll (Phase 6)

| Key | Default | Notes |
|---|---|---|
| `payroll.pension_threshold_months` | `3` | Continuous months with payslip work; retro to the streak's first month on eligibility (DECISIONS #6) |
| `payroll.sick_leave_accrual_halfdays_per_month` | `3` (1.5 days) | Accrued when a month is approved, for employees and the payslip side of a hybrid *(verify with accountant)* |
| `staffing.shift_change.requires_acceptance` | `true` | Parents notified only after instructor accepts |
| `staffing.shift_change.escalate_after_hours` | `12` | |
| `staffing.substitute_wave_size` | `3` | Offers go out in waves, first accept wins |
| `staffing.substitute_wave_minutes` | `30` | With no taker, the next wave opens after this many minutes; with no one left the request shows as unfilled on **מחליפים** |

Pay comes from each instructor's pay rules (per hour by the minute, per session, per head), the most specific
effective rule for the lesson (program and venue > program > venue > any). Each rule names its routing: payslip or
transfer against an invoice, so a hybrid instructor's groups and privates split by their rules. Travel is paid once
per working day and venue. A lesson no rule prices is listed on the draft and pays nothing until a rule exists.

Substitutes are ranked: knows the group first, then already at that venue that day, then the lighter week. Not
offered: no valid swim-instructor certificate, teaching at the same time, outside their availability, or the wrong
gender for a group that requires one.

## 12. Communications

| Key | Default | Notes |
|---|---|---|
| `comms.quiet_hours` | `21:30–08:00` | |
| `comms.block_shabbat_and_chag` | `true` | From candle lighting − 30 min to havdalah + 30 min |
| `comms.lead_followup.max_nudges` | `3` | |
| `comms.reminder_before_lesson_hours` | `2` | |
| `comms.auto_reply_personal` | `false` | Never auto-reply to personal/other |
| `comms.rate_per_minute` | `20` | At most this many messages leave per organization per minute |
| `comms.holiday_notice_days_before` | `2` | The "no lessons over the holiday" notice goes out this many days before the stretch |
| `comms.ai_triage` | `false` | Re-classify inbound WhatsApp with Claude (needs `ANTHROPIC_API_KEY` in the worker); the rules classifier stays the fallback |
| `comms.triage_min_confidence_pct` | `80` | Below this a message goes to a person instead of getting a draft action |

## 13. Transport (Phase 8)

| Key | Default | Notes |
|---|---|---|
| `transport.stale_after_min` | `30` | A stage or drop-off tapped longer ago than this is recorded but not messaged |
| `transport.short_water_warn_min` | `5` | In-water time shorter than the lesson by more than this is flagged on the run and the report |

Stages run in order (left school → arrived at the pool → in the water → out of the water → left the pool → done),
each once; a forgotten stage may be skipped, "out of the water" needs "in the water". A child is marked on board or
missing until the group reaches the pool, and dropped off only after it left the pool and only if they were on
board.

## 14. Courses, camps and institutions (Phase 8)

| Key | Default | Notes |
|---|---|---|
| `camp.children_per_staff` | `8` | A camp week takes at most this many children per staff member (lead instructors plus counselors) |

A cohort registers a child while it is open, has groups, before its closing date (else its last day) and with a
seat. A course's own rules are its program's policy version (scope `program`). An institution's month is priced
per child on the roster, per lesson held, or as a fixed sum; it is due after the contract's payment terms.

## 15. Venue migration (Phase 9)

| Key | Default | Notes |
|---|---|---|
| `migration.revert_hours` | `24` | An executed migration can be reverted for this long; places billing already charged block the revert |

Each group at the closing venue is either **relocated** (same group, new venue/pool/lanes, start time may shift on the
same weekday) or **merged** into an existing group elsewhere. Merge targets are ranked (`rankMergeTargets`): same
program 30, same weekday 20, a start within 15 minutes 20 (within an hour 10), overlapping age band 10, overlapping
level range 10, room for every child 10; a group admitting fewer people than the source is never offered. The preview
runs the ordinary hard rules on the timetable as it will be and the placement rules for every child who joins a group;
execution is refused while anything blocks.

## 16. Reports and weekly digest (Phase 9)

| Key | Default | Notes |
|---|---|---|
| `digest.enabled` | `true` | The worker builds the digest every Sunday at 07:00 (Israel) |
| `digest.high_occupancy_pct` | `90` | A group above this suggests a price rise |
| `digest.low_occupancy_pct` | `40` | A group below this is flagged |
| `digest.debt_attention_days` | `60` | Debts older than this are listed |
| `scheduling.open_group_min_waiting` | (scheduling) | Children waiting for one program and slot that suggest opening a group |

Venue margin = revenue attributed to the venue (charges for its groups' lessons, by where the lesson was held that
month, plus institution invoices) − rent − instructor pay for its lessons. Rent per month: fixed monthly as is, per
hour and per lane-hour from the lessons held; a revenue-share contract is shown as unknown. Occupancy = seats held /
capacity. Churn counts places that ended, by reason; transfers between groups, completed places and courses/camps are
not churn. The funnel source is "LeadYourWay" when the family came from GHL, otherwise "office".

## 17. Owner copilot (Phase 9)

| Key | Default | Notes |
|---|---|---|
| `copilot.enabled` | `false` | Also needs `ANTHROPIC_API_KEY` in the web app (or `RSWIM_COPILOT_FAKE=1` for demos) |

Owner only. The model reads through fixed tools (children, groups, staff, debts, lessons on a date, closures) and can
only propose three actions: move or add a child to a group, message a family, open makeup slots. A proposal is checked
before it is stored (a move runs the placement preview), and nothing happens until the owner confirms; the action then
runs through the ordinary service as the owner. A confirmed move can be undone; a message cannot.

## 17a. Owner insights (proactive alerts)

| Key | Default | Notes |
|---|---|---|
| `insights.enabled` | `true` | The daily check (06:30 Israel) and its lines in the weekly digest |
| `insights.ai_notes` | `true` | Claude writes a Hebrew explanation and next step per insight; also needs `ANTHROPIC_API_KEY` in the worker |
| `insights.lookback_days` | `28` | A group is "emptying" when its places now, less those ending in the coming month… |
| `insights.emptying_drop_seats` | `2` | …are at least this many below its places `lookback_days` ago |
| `insights.churn_absences` | `2` | Absences in a row that count as a churn signal |
| `insights.staff_max_weekly_hours` | `25` | Teaching hours in the coming week above which an instructor is flagged |
| `insights.trial_followup_days` | `14` | Trials held this recently with no place yet are flagged for a call |
| `insights.snooze_days` | `14` | A dismissed insight comes back after this many days if it still holds |

Advisory only: an insight never changes data. Old debts and empty groups reuse `digest.debt_attention_days` and
`digest.low_occupancy_pct`; the waitlist cluster reuses `scheduling.open_group_min_waiting`.

Churn risk scores each child holding a place whose family has not asked to leave: absences in a row at or above
`churn_absences` (2 points), otherwise two or more absences in the last four marks (1); a frozen place (1); a family
debt older than `debt_attention_days` (1). Two points or more is a risk. Each insight has a stable key (the kind and
its subject: a group id, or a fingerprint of the families listed), so a list with a new family in it is a new insight
and comes back even if the old one was dismissed.

## 18. Plans, limits and platform billing (Phase 10)

These are platform rules, not a school's own: they live in the `plans` rows (price, limits, features, trial and grace
days) and each school's `org_subscriptions` row. The demo plans (fake prices, not an offer):

| Plan | Price / month | Students | Active staff | Venues (not closed) | Features |
|---|---|---|---|---|---|
| `starter` | ₪149 | 60 | 3 | 1 | none |
| `growth` | ₪349 | 300 | 15 | 5 | reports, courses, transport |
| `pro` | ₪749 | unlimited | unlimited | unlimited | all, plus institutions and copilot |

- Limits are checked by a database trigger when a student, staff member or venue is added (`platform.errors.limit.*`),
  whichever path adds it. A school without a subscription has no limits and every feature.
- A school's own feature flags (`feature.<name>`) override its plan's features, for pilots and custom deals.
- A new school starts `trialing` for the plan's `trial_days` (14). The day after the trial ends it becomes `active`.
- Billing is monthly in advance, on the 1st at 06:00 (Israel), for the plan's full price (no proration). Trialing,
  suspended, cancelled and free schools are not billed. A month has at most one invoice; a failed one is charged again
  on the next run, each attempt with its own idempotency key (`platform:<org>:<month>:<attempt>`).
- A declined charge (or no mandate) makes the school `past_due` from that day, with a banner in its office. After the
  plan's `grace_days` (10) it is `suspended`: the office sees only its plan page, while parents, instructors and
  escorts keep working. A paid invoice makes it `active` again.
- A plan change (by a platform admin) is refused when the school already uses more than the new plan allows.
- One user may own at most 3 schools.

## Rounding & money rules
- All amounts integer agorot. Percentage = `round_half_up(amount × bp / 10000)`.
- Proration rounds per line; statement total = sum of rounded lines.
- VAT: prices are VAT-inclusive (B2C) *(assumption, DECISIONS)*; invoice lines split VAT via the invoicing provider.
