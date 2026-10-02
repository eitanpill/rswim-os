CREATE TABLE "absence_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"minutes_before" integer,
	"classification" text,
	"decision" jsonb,
	"policy_version_key" text,
	"credit_id" uuid,
	"note" text,
	"reported_by" uuid,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absence_notices_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "absence_notices_channel_check" CHECK (channel in ('parent_portal', 'phone', 'whatsapp', 'instructor', 'other')),
	CONSTRAINT "absence_notices_status_check" CHECK (status in ('pending', 'processed', 'withdrawn')),
	CONSTRAINT "absence_notices_classification_check" CHECK (classification is null or classification in ('timely', 'late_notice'))
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" text DEFAULT 'member' NOT NULL,
	"status" text NOT NULL,
	"minutes_late" smallint,
	"note" text,
	"recorded_by" uuid,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_mark_id" text,
	"policy_version_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "attendance_once" UNIQUE("session_id","student_id"),
	CONSTRAINT "attendance_kind_check" CHECK (kind in ('member', 'makeup', 'trial')),
	CONSTRAINT "attendance_status_check" CHECK (status in ('present', 'late', 'absent')),
	CONSTRAINT "attendance_late_check" CHECK ("attendance"."minutes_late" is null or "attendance"."minutes_late" between 0 and 600)
);
--> statement-breakpoint
CREATE TABLE "closure_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid,
	"venue_closure_id" uuid,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"guarantee" text NOT NULL,
	"makeup_from" date NOT NULL,
	"makeup_deadline" date NOT NULL,
	"end_rule" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"policy_version_key" text,
	"created_by" uuid,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closure_events_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "closure_events_dates_check" CHECK ("closure_events"."ends_on" >= "closure_events"."starts_on"),
	CONSTRAINT "closure_events_window_check" CHECK ("closure_events"."makeup_deadline" >= "closure_events"."makeup_from"),
	CONSTRAINT "closure_events_source_check" CHECK (source in ('school', 'venue', 'authority', 'technical', 'water_quality', 'holiday')),
	CONSTRAINT "closure_events_guarantee_check" CHECK (guarantee in ('guaranteed', 'best_effort', 'none')),
	CONSTRAINT "closure_events_end_rule_check" CHECK (end_rule in ('expire', 'convert_to_credit', 'partial_refund')),
	CONSTRAINT "closure_events_status_check" CHECK (status in ('draft', 'open', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"form_template_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"student_id" uuid,
	"guardian_id" uuid,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"text_hash" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_submissions_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "form_submissions_channel_check" CHECK (channel in ('parent_portal', 'owner_recorded', 'paper'))
);
--> statement-breakpoint
CREATE TABLE "form_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" smallint NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effective_from" date NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_templates_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "form_templates_version" UNIQUE("organization_id","kind","version"),
	CONSTRAINT "form_templates_kind_check" CHECK (kind in ('registration', 'health_declaration', 'regulations', 'photo_consent')),
	CONSTRAINT "form_templates_version_check" CHECK ("form_templates"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "makeup_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"credit_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"booked_by" uuid,
	"override_note" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "makeup_bookings_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "makeup_bookings_status_check" CHECK (status in ('booked', 'attended', 'missed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "makeup_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"source_session_id" uuid,
	"source_date" date,
	"closure_event_id" uuid,
	"issued_on" date NOT NULL,
	"valid_from" date,
	"expires_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"counts_toward_cap" boolean DEFAULT true NOT NULL,
	"policy_version_key" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "makeup_credits_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "makeup_credits_reason_check" CHECK (reason in ('notified_absence', 'school_cancellation', 'external_closure', 'goodwill')),
	CONSTRAINT "makeup_credits_status_check" CHECK (status in ('open', 'booked', 'used', 'expired', 'converted', 'void')),
	CONSTRAINT "makeup_credits_dates_check" CHECK ("makeup_credits"."expires_on" >= "makeup_credits"."issued_on")
);
--> statement-breakpoint
CREATE TABLE "progress_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"level_id" uuid NOT NULL,
	"skill_code" text NOT NULL,
	"achieved_on" date NOT NULL,
	"session_id" uuid,
	"staff_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_marks_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "progress_marks_once" UNIQUE("student_id","level_id","skill_code")
);
--> statement-breakpoint
CREATE TABLE "trials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"class_template_id" uuid NOT NULL,
	"enrollment_id" uuid,
	"date" date NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"fee_agorot" integer,
	"outcome" text,
	"recommended_level_id" uuid,
	"recommended_template_id" uuid,
	"verdict_note" text,
	"verdict_by" uuid,
	"verdict_at" timestamp with time zone,
	"offer_valid_until" date,
	"converted_enrollment_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trials_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "trials_status_check" CHECK (status in ('booked', 'attended', 'no_show', 'cancelled')),
	CONSTRAINT "trials_outcome_check" CHECK (outcome is null or outcome in ('fit', 'not_fit')),
	CONSTRAINT "trials_fee_check" CHECK ("trials"."fee_agorot" is null or "trials"."fee_agorot" >= 0)
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "has_medical_notes" boolean GENERATED ALWAYS AS (enc_medical_notes is not null) STORED;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "closure_event_id" uuid;--> statement-breakpoint
ALTER TABLE "absence_notices" ADD CONSTRAINT "absence_notices_session_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_notices" ADD CONSTRAINT "absence_notices_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closure_events" ADD CONSTRAINT "closure_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_template_fk" FOREIGN KEY ("organization_id","form_template_id") REFERENCES "public"."form_templates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_household_fk" FOREIGN KEY ("organization_id","household_id") REFERENCES "public"."households"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_guardian_fk" FOREIGN KEY ("organization_id","guardian_id") REFERENCES "public"."guardians"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_credit_fk" FOREIGN KEY ("organization_id","credit_id") REFERENCES "public"."makeup_credits"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_session_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_credits" ADD CONSTRAINT "makeup_credits_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_credits" ADD CONSTRAINT "makeup_credits_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_credits" ADD CONSTRAINT "makeup_credits_closure_fk" FOREIGN KEY ("organization_id","closure_event_id") REFERENCES "public"."closure_events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_marks" ADD CONSTRAINT "progress_marks_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_session_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_template_fk" FOREIGN KEY ("organization_id","class_template_id") REFERENCES "public"."class_templates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "absence_notices_once" ON "absence_notices" USING btree ("session_id","student_id") WHERE status <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "absence_notices_org_status" ON "absence_notices" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "attendance_student" ON "attendance" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "closure_events_org_status" ON "closure_events" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "form_submissions_household" ON "form_submissions" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "makeup_bookings_one_per_credit" ON "makeup_bookings" USING btree ("credit_id") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "makeup_bookings_once" ON "makeup_bookings" USING btree ("session_id","student_id") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "makeup_bookings_session" ON "makeup_bookings" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "makeup_credits_one_per_lesson" ON "makeup_credits" USING btree ("student_id","source_session_id") WHERE source_session_id is not null and status <> 'void';--> statement-breakpoint
CREATE INDEX "makeup_credits_student_status" ON "makeup_credits" USING btree ("student_id","status");--> statement-breakpoint
CREATE INDEX "makeup_credits_closure" ON "makeup_credits" USING btree ("closure_event_id");--> statement-breakpoint
CREATE INDEX "progress_marks_student" ON "progress_marks" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trials_once" ON "trials" USING btree ("student_id","session_id") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "trials_org_date" ON "trials" USING btree ("organization_id","date");