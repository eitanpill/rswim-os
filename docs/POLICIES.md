# Policy Catalog (תקנון → configuration)

Every rule below is a **key in `policy_sets.rules`** (ADR-0004), resolved by scope `class_template > venue_program > program > venue > org` and effective date. Values shown are **R-SWIM defaults** from the current regulations and the conversation analysis. Nothing here is hard-coded.

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
| `absence.timely.earns_makeup` | `true` | `canEarnMakeup` | 13h → credit; 11h → none (Phase 3 AC) |
| `absence.late_notice.charge` | `charged_no_makeup` | | |
| `absence.no_show.charge` | `charged_no_makeup` | | |
| `absence.private.late_notice` | `charged_full` | | Private lessons: 24h cancellation |
| `makeup.max_per_month` | `1` | `canEarnMakeup` | Counted per student per calendar month |
| `makeup.expiry` | `end_of_source_month` | `makeupExpiry` | Same month only, no carry-over |
| `makeup.requires_active_subscription` | `true` | `canBookMakeup` | |
| `makeup.self_booking` | `true` | `canBookMakeup` | Within policy and capacity (DECISIONS #7) |
| `makeup.compatibility` | `{age: true, level: ±1, gender_window: true, program: same, venue: any_active}` | makeup marketplace | |
| `makeup.double_lesson_allowed` | `false` (groups), `true` (private) | | Configurable per program |
| `makeup.enforcement` | `strict_with_override` | | DECISIONS #3 |

## 6. Cancellations by school vs. external

| Key | Default | Function | Notes |
|---|---|---|---|
| `closure.school.makeup` | `guaranteed` | `closureTreatment` | Makeup credit, no expiry cap beyond event deadline |
| `closure.external.makeup` | `best_effort` | | Technical, water quality, fecal incident, venue decision, authorities. Credit issued with event deadline |
| `closure.external.refund` | `none` | | Owner can change per mass-cancellation event |
| `closure.event.end_rule` | `expire` | | `expire` / `convert_to_credit` / `partial_refund`, decided per event |
| `closure.makeup_cap_bypass` | `true` | | Closure credits do not count against `makeup.max_per_month` *(assumption)* |

## 7. Calendar

| Key | Default | Function | Notes |
|---|---|---|---|
| `calendar.no_lessons_on` | `[shabbat, erev_chag, yom_tov, yom_kippur, tisha_bav, yom_hazikaron_evening]` | session generator | |
| `calendar.chol_hamoed` | `skip` | | Camps/summer courses may set `run` |
| `calendar.holiday_makeup` | `none` | | No refund/makeup unless stated |
| `calendar.holiday_notice_days_before` | `3` | comms automation | Auto "no lessons / back to routine" message |

## 8. Health, safety, consent

| Key | Default | Notes |
|---|---|---|
| `health.declaration_required` | `true` | Before first lesson; renew yearly |
| `health.medical_cert_required_for` | `[declared_limitation]` | Owner may require |
| `consent.photo.default` | `granted_unless_opt_out` | Opt-out in writing (form) |
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

## 11. Staff & payroll (Phase 6, listed for completeness)

| Key | Default | Notes |
|---|---|---|
| `payroll.pension.threshold_months` | `3` | Continuous months; retro on eligibility (DECISIONS #6) |
| `payroll.sick_leave.accrual_halfdays_per_month` | `3` (1.5 days) | Israeli statutory default *(verify with accountant)* |
| `staffing.shift_change.requires_acceptance` | `true` | Parents notified only after instructor accepts |
| `staffing.shift_change.escalate_after_hours` | `12` | |
| `staffing.substitute.wave_size` | `3` | Offers go out in waves, first accept wins |

## 12. Communications

| Key | Default | Notes |
|---|---|---|
| `comms.quiet_hours` | `21:30–08:00` | |
| `comms.block_shabbat_and_chag` | `true` | From candle lighting − 30 min to havdalah + 30 min |
| `comms.lead_followup.max_nudges` | `3` | |
| `comms.reminder_before_lesson_hours` | `2` | |
| `comms.auto_reply_personal` | `false` | Never auto-reply to personal/other |

## Rounding & money rules
- All amounts integer agorot. Percentage = `round_half_up(amount × bp / 10000)`.
- Proration rounds per line; statement total = sum of rounded lines.
- VAT: prices are VAT-inclusive (B2C) *(assumption, DECISIONS)*; invoice lines split VAT via the invoicing provider.
