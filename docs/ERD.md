# ERD — R-SWIM OS (draft v0.1)

Conventions for every table below unless stated:
- `id uuid pk`, `organization_id uuid not null` (FK → organizations, part of composite FKs), `created_at`, `updated_at`, `created_by`.
- Money columns end in `_agorot` (int). Dates in `Asia/Jerusalem` local `date`; instants `timestamptz`.
- `enc_` prefix = application-encrypted `bytea` (see ADR-0005).
- Versioned config tables carry `effective_from date`, `effective_to date null`, `version int`.

`organization_id` is omitted from the diagrams to keep them readable. Diagrams are split by module; FK names link across diagrams.

## 1. Tenancy, identity, settings

```mermaid
erDiagram
  organizations ||--|| org_settings : has
  organizations ||--o{ memberships : has
  users ||--o{ memberships : has
  organizations ||--o{ policy_sets : defines
  organizations ||--o{ price_lists : defines
  price_lists ||--o{ price_items : contains
  organizations ||--o{ discount_rules : defines
  organizations ||--o{ hebrew_calendar_overrides : has
  organizations ||--o{ feature_flags : has
  policy_sets ||--o{ policy_overrides : "overridden by"

  organizations {
    uuid id PK
    text slug UK
    text name
    text legal_name
    text tax_status
    text vat_number
    text timezone
    text default_locale
    text status
  }
  org_settings {
    uuid organization_id PK
    jsonb branding
    jsonb business_bank_details
    int vat_rate_bp
    int billing_run_day
    jsonb quiet_hours
    jsonb integrations
  }
  users {
    uuid id PK "auth.users"
    text phone
    text email
  }
  memberships {
    uuid id PK
    uuid user_id FK
    text role
    text_arr permissions
    uuid staff_member_id FK
    uuid guardian_id FK
    text status
  }
  platform_admins {
    uuid user_id PK
  }
  policy_sets {
    uuid id PK
    text scope_type
    uuid scope_id
    date effective_from
    date effective_to
    int version
    jsonb rules
    int schema_version
  }
  policy_overrides {
    uuid id PK
    uuid policy_set_id FK
    text subject_type
    uuid subject_id
    text decision
    text reason
    uuid attachment_id
    uuid approved_by
  }
  price_lists {
    uuid id PK
    text scope_type
    uuid scope_id
    date effective_from
    date effective_to
    int version
    text name
  }
  price_items {
    uuid id PK
    uuid price_list_id FK
    uuid program_id FK
    int duration_min
    text unit
    int amount_agorot
    jsonb meta
  }
  discount_rules {
    uuid id PK
    text kind "sibling|flat|promo|institutional"
    int percent_bp
    int flat_agorot
    text code
    jsonb conditions
    date effective_from
    date effective_to
  }
  hebrew_calendar_overrides {
    uuid id PK
    date day
    text kind "closed|open"
    text reason
    text scope_type
    uuid scope_id
  }
  feature_flags {
    uuid id PK
    text key
    bool enabled
  }
```

## 2. Venues

```mermaid
erDiagram
  venues ||--o{ venue_contracts : has
  venues ||--o{ pools : has
  pools ||--o{ lanes : has
  venues ||--o{ venue_operating_windows : has
  venues ||--|| venue_rules : has
  venues ||--o{ venue_closures : has
  venue_operating_windows }o--o{ lanes : "allocates (window_lanes)"

  venues {
    uuid id PK
    text name
    text kind
    text address
    text city
    jsonb geo
    text parking_instructions
    text entry_instructions
    text front_desk_script
    text status "prospect|active|renovation|closing|closed"
    date opened_on
    date closed_on
  }
  venue_contracts {
    uuid id PK
    uuid venue_id FK
    text kind "lease|tender|partnership"
    text rent_model "fixed_monthly|per_hour|per_lane|revenue_share"
    int amount_agorot
    int revenue_share_bp
    date starts_on
    date ends_on
    date renewal_on
    text tender_ref
  }
  pools {
    uuid id PK
    uuid venue_id FK
    text name
    bool indoor
    int temp_min_c10
    int temp_max_c10
    int depth_min_cm
    int depth_max_cm
  }
  lanes {
    uuid id PK
    uuid pool_id FK
    text label
    int sort
  }
  venue_operating_windows {
    uuid id PK
    uuid venue_id FK
    int weekday
    time starts_at
    time ends_at
    text gender_restriction "mixed|women|men|girls|boys"
    date effective_from
    date effective_to
  }
  window_lanes {
    uuid window_id FK
    uuid lane_id FK
  }
  venue_rules {
    uuid venue_id PK
    int companions_per_child
    int extra_child_fee_agorot
    text entry_procedure
    bool father_escort_in_women_hours
  }
  venue_closures {
    uuid id PK
    uuid venue_id FK
    timestamptz starts_at
    timestamptz ends_at
    text reason
    text cause "school|external"
    text source "venue|authority|school|weather|water_quality"
    jsonb scope
    timestamptz announced_at
    uuid mass_cancellation_event_id FK
  }
```

## 3. People

```mermaid
erDiagram
  households ||--o{ guardians : has
  households ||--o{ students : has
  students ||--o{ student_relations : "relates (a)"
  students ||--o{ consents : has
  households ||--o| reimbursement_profiles : "may use"
  guardians ||--o{ notification_prefs : has

  households {
    uuid id PK
    text display_name
    text billing_status
    uuid institution_id FK "payer if institutional"
    text preferred_locale
  }
  guardians {
    uuid id PK
    uuid household_id FK
    text first_name
    text last_name
    text phone_e164
    text email
    bool whatsapp_opt_in
    text locale
    text relation
    bool is_billing_contact
    text ghl_contact_id UK
  }
  students {
    uuid id PK
    uuid household_id FK
    text first_name
    text last_name
    date dob
    text gender
    text school
    text grade
    uuid level_id FK
    bool water_fear
    bytea enc_medical_notes
    bytea enc_national_id
    bool photo_consent
    uuid preferred_instructor_id FK
    jsonb custody_pattern
    bool is_self_guardian
    uuid self_guardian_id FK
  }
  student_relations {
    uuid student_a FK
    uuid student_b FK
    text type "sibling|twin|friend_together"
  }
  consents {
    uuid id PK
    uuid student_id FK
    text kind
    bool granted
    timestamptz at
    uuid form_submission_id FK
  }
  notification_prefs {
    uuid guardian_id FK
    text channel
    text category
    bool enabled
  }
  reimbursement_profiles {
    uuid id PK
    uuid household_id FK
    text kind "mod|insurance|reservists|employer|health_fund"
    text required_wording
    bytea enc_client_id
    bool split_per_month
    jsonb extra_fields
  }
```

## 4. Staff, payroll, recruitment

```mermaid
erDiagram
  staff_members ||--o{ certifications : holds
  staff_members ||--o{ staff_skills : has
  staff_members ||--o{ availability_rules : has
  staff_members ||--o{ availability_exceptions : has
  staff_members ||--o{ pay_rules : "paid by"
  staff_members ||--o| pension_eligibility : tracks
  staff_members ||--o{ sick_leave_accruals : accrues
  staff_members ||--o{ staff_documents : has
  staff_members ||--o{ timesheets : submits
  timesheets ||--o{ timesheet_lines : contains
  payroll_runs ||--o{ payroll_lines : produces
  staff_members ||--o{ payroll_lines : receives
  applicants }o--o| job_posts : "applied to"
  staff_members ||--o{ cash_handovers : records

  staff_members {
    uuid id PK
    text first_name
    text last_name
    text phone_e164
    text gender
    text employment_type "employee|freelancer_exempt|freelancer_licensed|hybrid"
    date start_date
    date end_date
    bytea enc_national_id
    bytea enc_bank_details
    text status
  }
  certifications {
    uuid id PK
    uuid staff_member_id FK
    text type "swim_instructor|lifeguard|hydrotherapy|baby_swim|first_aid"
    text issuer
    date expires_on
    uuid file_id
  }
  staff_skills {
    uuid staff_member_id FK
    text skill "babies|water_fear|therapy|adults|advanced"
  }
  availability_rules {
    uuid id PK
    uuid staff_member_id FK
    int weekday
    time starts_at
    time ends_at
    uuid venue_id FK
    date effective_from
    date effective_to
  }
  availability_exceptions {
    uuid id PK
    uuid staff_member_id FK
    timestamptz starts_at
    timestamptz ends_at
    text kind "unavailable|extra"
    text reason
  }
  pay_rules {
    uuid id PK
    uuid staff_member_id FK
    text basis "per_hour|per_session_type|per_head|flat_per_lesson"
    text session_type
    uuid venue_id FK
    int amount_agorot
    int travel_agorot
    text routing "payslip|transfer"
    date effective_from
    date effective_to
    int version
  }
  pension_eligibility {
    uuid staff_member_id PK
    date continuous_since
    int threshold_months
    date eligible_from
    bool retro_applied
  }
  sick_leave_accruals {
    uuid id PK
    uuid staff_member_id FK
    date period
    int accrued_halfdays
    int used_halfdays
  }
  staff_documents {
    uuid id PK
    uuid staff_member_id FK
    text kind "payslip|form_101|form_100|contract"
    date period
    uuid file_id
  }
  timesheets {
    uuid id PK
    uuid staff_member_id FK
    date period
    text status "draft|confirmed|disputed|approved"
    timestamptz confirmed_at
  }
  timesheet_lines {
    uuid id PK
    uuid timesheet_id FK
    uuid session_id FK
    text source "auto|manual"
    int minutes
    text note
  }
  payroll_runs {
    uuid id PK
    date period
    text status
    uuid policy_version_id
  }
  payroll_lines {
    uuid id PK
    uuid payroll_run_id FK
    uuid staff_member_id FK
    text routing
    text kind
    int amount_agorot
    jsonb explanation
  }
  cash_handovers {
    uuid id PK
    uuid staff_member_id FK
    int amount_agorot
    timestamptz at
    uuid received_by
  }
  job_posts {
    uuid id PK
    uuid venue_id FK
    text title
    text body_he
    jsonb slots
    text status
  }
  applicants {
    uuid id PK
    uuid job_post_id FK
    text name
    text phone_e164
    text source
    text stage
    int rate_ask_agorot
    jsonb availability
    jsonb scorecard
  }
```

## 5. Programs, scheduling, enrollment

```mermaid
erDiagram
  programs ||--o{ levels : "has ladder"
  levels ||--o{ level_skills : checklist
  programs ||--o{ class_templates : instantiates
  venues ||--o{ class_templates : hosts
  terms ||--o{ class_templates : "runs in"
  class_templates ||--o{ sessions : generates
  sessions ||--o{ session_staff : staffed
  staff_members ||--o{ session_staff : works
  sessions ||--o{ pending_shift_changes : "change requests"
  staff_members ||--o{ private_slots : offers
  students ||--o{ enrollments : has
  class_templates ||--o{ enrollments : "seat in"
  packages ||--o{ enrollments : "or package"
  enrollments ||--o{ freezes : has
  enrollments ||--o{ cancellation_requests : has
  enrollments ||--o| package_balances : tracks
  students ||--o{ waitlist_entries : waits
  students ||--o{ trials : books
  students ||--o{ skill_progress : progresses

  programs {
    uuid id PK
    text code "group_kids|baby|adult_beginner|adult_style|private|pair|trio|therapy|after_school|intensive_course|camp|school_program"
    text name_he
    text name_en
    int default_duration_min
    int default_capacity
  }
  levels {
    uuid id PK
    uuid program_id FK
    text code
    text name_he
    int sort
  }
  level_skills {
    uuid id PK
    uuid level_id FK
    text code
    text name_he
    int sort
  }
  terms {
    uuid id PK
    text name
    date starts_on
    date ends_on
    text kind "school_year|summer|course|custom"
    bool skip_chol_hamoed
  }
  class_templates {
    uuid id PK
    uuid venue_id FK
    uuid program_id FK
    uuid term_id FK
    int weekday
    time starts_at
    int duration_min
    int capacity
    int age_min_months
    int age_max_months
    uuid level_min FK
    uuid level_max FK
    text gender
    text required_instructor_gender
    text_arr required_skills
    uuid_arr lane_ids
    text status
  }
  sessions {
    uuid id PK
    uuid class_template_id FK
    uuid venue_id FK
    timestamptz starts_at
    timestamptz ends_at
    uuid_arr lane_ids
    text status "scheduled|cancelled_by_school|cancelled_external|completed"
    text cancel_reason
    uuid venue_closure_id FK
  }
  session_staff {
    uuid session_id FK
    uuid staff_member_id FK
    text role "lead|assistant|substitute"
    text status "confirmed|pending|declined"
  }
  pending_shift_changes {
    uuid id PK
    uuid session_id FK
    uuid staff_member_id FK
    jsonb change
    text status "pending|accepted|declined|escalated"
    timestamptz respond_by
  }
  private_slots {
    uuid id PK
    uuid staff_member_id FK
    uuid venue_id FK
    timestamptz starts_at
    int duration_min
    text usable_for "private|trial|makeup"
    text status
  }
  enrollments {
    uuid id PK
    uuid student_id FK
    uuid class_template_id FK
    uuid package_id FK
    text status "lead|trial_booked|trial_done|active|frozen|cancel_requested|cancelled|completed"
    date starts_on
    date ends_on
    int price_snapshot_agorot
    jsonb discount_snapshot
    uuid price_item_id FK
    text source
  }
  freezes {
    uuid id PK
    uuid enrollment_id FK
    date starts_on
    date ends_on
    text reason
    uuid attachment_id
    uuid approved_by
    text status
  }
  cancellation_requests {
    uuid id PK
    uuid enrollment_id FK
    timestamptz requested_at
    date effective_month
    text reason_code
    text reason_text
    uuid policy_version_id
  }
  packages {
    uuid id PK
    text kind "course|punch_card|camp_week|annual"
    uuid program_id FK
    int lessons
    int amount_agorot
    date starts_on
    date ends_on
    uuid regulation_version_id FK
  }
  package_balances {
    uuid enrollment_id PK
    int lessons_total
    int lessons_used
  }
  waitlist_entries {
    uuid id PK
    uuid student_id FK
    uuid program_id FK
    uuid venue_id FK
    jsonb preferences
    int rank
    text status
  }
  trials {
    uuid id PK
    uuid student_id FK
    uuid session_id FK
    uuid private_slot_id FK
    int fee_agorot
    jsonb offset_rule
    text outcome
    uuid recommended_level_id FK
    date offset_valid_until
  }
  skill_progress {
    uuid student_id FK
    uuid level_skill_id FK
    text state
    uuid by_staff FK
    timestamptz at
  }
```

## 6. Attendance & makeups

```mermaid
erDiagram
  sessions ||--o{ attendance : records
  students ||--o{ attendance : attends
  students ||--o{ absence_notices : notifies
  absence_notices ||--o| makeup_credits : "may earn"
  sessions ||--o{ makeup_credits : "earned from"
  makeup_credits ||--o| makeup_bookings : "used by"
  sessions ||--o{ makeup_bookings : "seat in"
  mass_cancellation_events ||--o{ makeup_credits : issues
  mass_cancellation_events ||--o{ makeup_windows : opens

  attendance {
    uuid id PK
    uuid session_id FK
    uuid student_id FK
    text status "present|absent_notified|absent_late_notice|no_show|late|makeup|trial"
    int late_minutes
    uuid recorded_by
    text client_idempotency_key UK
    timestamptz recorded_at
  }
  absence_notices {
    uuid id PK
    uuid student_id FK
    uuid session_id FK
    text channel "portal|whatsapp|staff"
    timestamptz received_at
    int minutes_before
    text classification
    uuid policy_version_id
    jsonb explanation
  }
  makeup_credits {
    uuid id PK
    uuid student_id FK
    uuid source_session_id FK
    text reason "notified_absence|school_cancellation|external_closure|goodwill"
    date expires_on
    text status "open|booked|used|expired|converted_to_credit"
    uuid policy_version_id
    uuid mass_cancellation_event_id FK
  }
  makeup_bookings {
    uuid id PK
    uuid makeup_credit_id FK
    uuid session_id FK
    text kind "regular|double"
    text status
  }
  mass_cancellation_events {
    uuid id PK
    text title
    text cause
    date starts_on
    date ends_on
    date makeup_deadline
    timestamptz final_notice_at
    text end_rule "expire|convert_to_credit|partial_refund"
    text status
  }
  makeup_windows {
    uuid id PK
    uuid mass_cancellation_event_id FK
    uuid venue_id FK
    timestamptz starts_at
    timestamptz ends_at
    int capacity
  }
```

## 7. Money

```mermaid
erDiagram
  households ||--o{ ledger_entries : "account of"
  billing_runs ||--o{ ledger_entries : posts
  billing_runs ||--o{ billing_anomalies : flags
  households ||--o{ statements : receives
  households ||--o{ payments : makes
  payments ||--|| ledger_entries : "posts one"
  households ||--o{ payment_methods : has
  payment_methods ||--o{ standing_orders : backs
  payments ||--o{ documents_fiscal : "receipted by"
  households ||--o{ payment_links : gets
  households ||--o{ dunning_cases : has

  ledger_entries {
    uuid id PK
    uuid household_id FK
    uuid student_id FK
    uuid enrollment_id FK
    text entry_type
    int amount_agorot "signed"
    date period
    timestamptz occurred_at
    text source_type
    uuid source_id
    uuid policy_version_id
    uuid reverses_entry_id FK
    jsonb explanation
    text memo
  }
  billing_runs {
    uuid id PK
    date period
    text status "draft|reviewed|posted|charging|done"
    uuid policy_version_id
    jsonb summary
  }
  billing_anomalies {
    uuid id PK
    uuid billing_run_id FK
    uuid household_id FK
    text kind "charge_without_enrollment|enrollment_without_charge|duplicate_mandate|amount_outlier"
    jsonb detail
    text resolution
  }
  statements {
    uuid id PK
    uuid household_id FK
    date period
    int total_agorot
    uuid file_id
  }
  payments {
    uuid id PK
    uuid household_id FK
    text provider "grow|manual"
    text method "card|standing_order|bit|paybox|cash|bank_transfer|cheque"
    text external_id
    text status "pending|succeeded|failed|refunded"
    int amount_agorot
    text payer_phone
    uuid proof_file_id
    uuid recorded_by
  }
  payment_methods {
    uuid id PK
    uuid household_id FK
    text provider
    text token_ref
    text last4
    text status
    text last_failure
  }
  standing_orders {
    uuid id PK
    uuid household_id FK
    uuid payment_method_id FK
    text external_mandate_id UK
    int amount_agorot
    text status
    date next_charge_on
  }
  payment_links {
    uuid id PK
    uuid household_id FK
    text purpose
    int amount_agorot
    text external_url
    jsonb terms_text
    text status
  }
  documents_fiscal {
    uuid id PK
    uuid household_id FK
    uuid payment_id FK
    text kind "invoice_receipt|receipt|credit_note"
    text provider_doc_id
    text number
    jsonb lines
    uuid reimbursement_profile_id FK
    uuid file_id
  }
  dunning_cases {
    uuid id PK
    uuid household_id FK
    uuid payment_id FK
    text stage
    int attempts
    timestamptz next_action_at
  }
```
`debts` and `household_balances` are views over `ledger_entries`.

## 8. Transport (after-school)

```mermaid
erDiagram
  schools ||--o{ routes : "start of"
  routes ||--o{ route_stops : has
  routes ||--o{ route_runs : runs
  route_runs ||--o{ run_events : logs
  students ||--o{ route_stops : "picked/dropped at"

  schools {
    uuid id PK
    text name
    text address
  }
  routes {
    uuid id PK
    uuid school_id FK
    uuid venue_id FK
    int weekday
    time pickup_at
  }
  route_stops {
    uuid id PK
    uuid route_id FK
    uuid student_id FK
    text kind "pickup|dropoff"
    text place
    int sort
  }
  route_runs {
    uuid id PK
    uuid route_id FK
    date day
    uuid driver_id FK
    uuid escort_id FK
    text vehicle
  }
  run_events {
    uuid id PK
    uuid route_run_id FK
    text kind "left_school|arrived_pool|entered_water|left_water|departed_pool|dropped_at_stop"
    uuid student_id FK
    timestamptz at
  }
```
`escort_pay_rules` reuse `pay_rules` with `session_type = escort_run`.

## 9. Communications

```mermaid
erDiagram
  message_templates ||--o{ outbound_messages : renders
  automations ||--o{ outbound_messages : triggers
  broadcasts ||--o{ outbound_messages : sends
  guardians ||--o{ outbound_messages : receives
  guardians ||--o{ conversations_mirror : "talks in"
  conversations_mirror ||--o| triage_results : classified

  message_templates {
    uuid id PK
    text key
    text locale
    text channel
    text body
    jsonb variables
    text ghl_template_id
    int version
  }
  automations {
    uuid id PK
    text trigger_event
    jsonb conditions
    jsonb actions
    bool enabled
  }
  broadcasts {
    uuid id PK
    jsonb segment
    uuid template_id FK
    timestamptz scheduled_at
    jsonb results
  }
  outbound_messages {
    uuid id PK
    uuid guardian_id FK
    uuid template_id FK
    text body_rendered
    text status
    text provider_msg_id
    text idempotency_key UK
    timestamptz sent_at
  }
  conversations_mirror {
    uuid id PK
    uuid guardian_id FK
    text direction
    text body
    text ghl_message_id UK
    timestamptz at
  }
  triage_results {
    uuid id PK
    uuid message_id FK
    text intent
    numeric confidence
    jsonb entities
    text action_status
  }
  update_groups {
    uuid id PK
    uuid venue_id FK
    uuid class_template_id FK
    text invite_link
  }
```

## 10. Ops, compliance, institutions, platform plumbing

```mermaid
erDiagram
  forms ||--o{ form_submissions : collects
  regulation_versions ||--o{ form_submissions : "accepted in"
  institutions ||--o{ institution_contracts : signs
  institutions ||--o{ households : pays_for

  tasks {
    uuid id PK
    uuid assignee_id
    date due_on
    text subject_type
    uuid subject_id
    text status
  }
  incidents {
    uuid id PK
    uuid venue_id FK
    uuid session_id FK
    text kind
    text description
    text severity
  }
  inventory_items {
    uuid id PK
    uuid venue_id FK
    text name
    int qty
  }
  forms {
    uuid id PK
    text kind "registration|health_declaration|insurance|photo_consent|regulations"
    jsonb schema
    int version
  }
  form_submissions {
    uuid id PK
    uuid form_id FK
    uuid regulation_version_id FK
    uuid guardian_id FK
    uuid student_id FK
    jsonb answers
    timestamptz signed_at
    text signed_phone
    inet ip
  }
  regulation_versions {
    uuid id PK
    text scope
    text body_he
    int version
    date effective_from
  }
  institutions {
    uuid id PK
    text type
    text name
    text contact
  }
  institution_contracts {
    uuid id PK
    uuid institution_id FK
    jsonb terms
    date starts_on
    date ends_on
  }
  audit_log {
    bigint id PK
    uuid actor_id
    text action
    text subject_type
    uuid subject_id
    jsonb diff
    inet ip
    timestamptz at
  }
  outbox {
    uuid id PK
    text event_type
    jsonb payload
    text idempotency_key UK
    timestamptz dispatched_at
    int attempts
    text last_error
  }
  inbox_receipts {
    text consumer PK
    uuid event_id PK
    timestamptz at
  }
  webhook_events {
    uuid id PK
    text provider
    text external_id
    jsonb raw
    text status
  }
  dead_letters {
    uuid id PK
    text source
    jsonb payload
    text error
    timestamptz at
  }
  files {
    uuid id PK
    text bucket
    text path
    text mime
    text purpose
  }
```

## Platform (Phase 10)
Not tenant data, but RLS is on: `plans` (read by everyone), `platform_admins`, and `templates` (published ones are
read by everyone, a school sees its own submissions). Per school: `org_subscriptions` (one row, keyed by the school),
`platform_invoices` (unique per school and month), `org_domains` (host unique across the platform) and
`template_installs`. Branding lives in `org_settings.branding`.

## Key integrity rules
- `attendance (session_id, student_id)` unique.
- `makeup_bookings`: seat count per session ≤ capacity, enforced with `SELECT … FOR UPDATE` on the session row in the booking service.
- `standing_orders`: partial unique index on `(household_id) where status = 'active'` to stop duplicate mandates; anomaly report also checks provider side.
- `ledger_entries`: trigger blocks UPDATE/DELETE.
- `session_staff`: exclusion constraint on staff × time range (no double-booking); `sessions` × lanes exclusion via `lane_bookings` helper table.
- All FKs between tenant tables are composite `(organization_id, id)`.
