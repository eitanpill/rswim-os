CREATE TABLE "class_template_lanes" (
	"organization_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"class_template_id" uuid NOT NULL,
	"lane_id" uuid NOT NULL,
	CONSTRAINT "class_template_lanes_class_template_id_lane_id_pk" PRIMARY KEY("class_template_id","lane_id")
);
--> statement-breakpoint
CREATE TABLE "class_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"program_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"starts_at" time NOT NULL,
	"duration_min" smallint NOT NULL,
	"level_min_id" uuid,
	"level_max_id" uuid,
	"age_min_months" smallint,
	"age_max_months" smallint,
	"admitted_gender" text DEFAULT 'mixed' NOT NULL,
	"capacity" smallint NOT NULL,
	"required_instructor_gender" text,
	"required_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"lead_staff_id" uuid,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_templates_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "class_templates_org_pool_id" UNIQUE("organization_id","pool_id","id"),
	CONSTRAINT "class_templates_weekday_check" CHECK ("class_templates"."weekday" between 0 and 6),
	CONSTRAINT "class_templates_duration_check" CHECK ("class_templates"."duration_min" between 5 and 240),
	CONSTRAINT "class_templates_capacity_check" CHECK ("class_templates"."capacity" between 1 and 100),
	CONSTRAINT "class_templates_age_check" CHECK ("class_templates"."age_min_months" is null or "class_templates"."age_max_months" is null or "class_templates"."age_max_months" >= "class_templates"."age_min_months"),
	CONSTRAINT "class_templates_gender_check" CHECK (admitted_gender in ('mixed', 'female', 'male')),
	CONSTRAINT "class_templates_instructor_gender_check" CHECK ("class_templates"."required_instructor_gender" is null or "class_templates"."required_instructor_gender" in ('female', 'male')),
	CONSTRAINT "class_templates_status_check" CHECK ("class_templates"."status" in ('active', 'archived')),
	CONSTRAINT "class_templates_dates_check" CHECK ("class_templates"."effective_to" is null or "class_templates"."effective_to" > "class_templates"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"class_template_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"source" text,
	"previous_enrollment_id" uuid,
	"created_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "enrollments_status_check" CHECK (status in ('lead', 'trial_booked', 'trial_done', 'active', 'frozen', 'cancel_requested', 'cancelled', 'completed')),
	CONSTRAINT "enrollments_dates_check" CHECK ("enrollments"."ends_on" is null or "enrollments"."ends_on" >= "enrollments"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "hebrew_calendar_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"venue_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_overrides_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "calendar_overrides_day" UNIQUE NULLS NOT DISTINCT("organization_id","venue_id","date"),
	CONSTRAINT "calendar_overrides_kind_check" CHECK ("hebrew_calendar_overrides"."kind" in ('closed', 'open'))
);
--> statement-breakpoint
CREATE TABLE "private_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"pool_id" uuid,
	"program_id" uuid,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" smallint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"series_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_slots_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "private_slots_kind_check" CHECK (kind in ('private', 'pair', 'trio', 'therapy', 'trial', 'makeup')),
	CONSTRAINT "private_slots_status_check" CHECK (status in ('open', 'full', 'cancelled')),
	CONSTRAINT "private_slots_capacity_check" CHECK ("private_slots"."capacity" between 1 and 10),
	CONSTRAINT "private_slots_time_check" CHECK ("private_slots"."ends_at" > "private_slots"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "session_generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"existing_count" integer DEFAULT 0 NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_runs_org_id" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "session_staff" (
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"role" text DEFAULT 'lead' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_staff_session_id_staff_member_id_pk" PRIMARY KEY("session_id","staff_member_id"),
	CONSTRAINT "session_staff_role_check" CHECK (role in ('lead', 'assistant', 'substitute'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"class_template_id" uuid NOT NULL,
	"term_id" uuid,
	"venue_id" uuid NOT NULL,
	"date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"cancel_reason" text,
	"generation_run_id" uuid,
	"policy_version_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "sessions_template_date" UNIQUE("class_template_id","date"),
	CONSTRAINT "sessions_status_check" CHECK (status in ('scheduled', 'cancelled_by_school', 'cancelled_external', 'completed')),
	CONSTRAINT "sessions_time_check" CHECK ("sessions"."ends_at" > "sessions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "shift_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"class_template_id" uuid,
	"session_id" uuid,
	"effective_from" date,
	"from_staff_id" uuid,
	"to_staff_id" uuid,
	"new_starts_at" timestamp with time zone,
	"new_ends_at" timestamp with time zone,
	"respondent_staff_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"requested_by" uuid,
	"escalate_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"response_note" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_changes_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "shift_changes_kind_check" CHECK (kind in ('reassign_group', 'reassign_session', 'reschedule_session')),
	CONSTRAINT "shift_changes_status_check" CHECK (status in ('pending', 'accepted', 'declined', 'escalated', 'applied', 'cancelled')),
	CONSTRAINT "shift_changes_shape_check" CHECK (case "shift_changes"."kind"
        when 'reassign_group' then "shift_changes"."class_template_id" is not null and "shift_changes"."effective_from" is not null
          and "shift_changes"."to_staff_id" is not null and "shift_changes"."session_id" is null
        when 'reassign_session' then "shift_changes"."session_id" is not null and "shift_changes"."to_staff_id" is not null
        when 'reschedule_session' then "shift_changes"."session_id" is not null and "shift_changes"."new_starts_at" is not null
          and "shift_changes"."new_ends_at" > "shift_changes"."new_starts_at"
      end)
);
--> statement-breakpoint
CREATE TABLE "slot_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"booked_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_bookings_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "slot_bookings_status_check" CHECK (status in ('booked', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'school_year' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "terms_org_name" UNIQUE("organization_id","name"),
	CONSTRAINT "terms_kind_check" CHECK (kind in ('school_year', 'summer', 'course', 'custom')),
	CONSTRAINT "terms_dates_check" CHECK ("terms"."ends_on" >= "terms"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"venue_id" uuid,
	"class_template_id" uuid,
	"preferred_weekdays" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"earliest_at" time,
	"latest_at" time,
	"priority" smallint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"placed_enrollment_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "waitlist_status_check" CHECK (status in ('waiting', 'offered', 'placed', 'withdrawn')),
	CONSTRAINT "waitlist_times_check" CHECK ("waitlist_entries"."earliest_at" is null or "waitlist_entries"."latest_at" is null or "waitlist_entries"."latest_at" > "waitlist_entries"."earliest_at")
);
--> statement-breakpoint
ALTER TABLE "class_template_lanes" ADD CONSTRAINT "template_lanes_template_fk" FOREIGN KEY ("organization_id","pool_id","class_template_id") REFERENCES "public"."class_templates"("organization_id","pool_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "class_template_lanes" ADD CONSTRAINT "template_lanes_lane_fk" FOREIGN KEY ("organization_id","pool_id","lane_id") REFERENCES "public"."lanes"("organization_id","pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_templates" ADD CONSTRAINT "class_templates_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_templates" ADD CONSTRAINT "class_templates_pool_fk" FOREIGN KEY ("organization_id","venue_id","pool_id") REFERENCES "public"."pools"("organization_id","venue_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_template_fk" FOREIGN KEY ("organization_id","class_template_id") REFERENCES "public"."class_templates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hebrew_calendar_overrides" ADD CONSTRAINT "hebrew_calendar_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hebrew_calendar_overrides" ADD CONSTRAINT "calendar_overrides_venue_fk" FOREIGN KEY ("organization_id","venue_id") REFERENCES "public"."venues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_slots" ADD CONSTRAINT "private_slots_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_slots" ADD CONSTRAINT "private_slots_venue_fk" FOREIGN KEY ("organization_id","venue_id") REFERENCES "public"."venues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_slots" ADD CONSTRAINT "private_slots_pool_fk" FOREIGN KEY ("organization_id","venue_id","pool_id") REFERENCES "public"."pools"("organization_id","venue_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_slots" ADD CONSTRAINT "private_slots_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_generation_runs" ADD CONSTRAINT "session_generation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_generation_runs" ADD CONSTRAINT "generation_runs_term_fk" FOREIGN KEY ("organization_id","term_id") REFERENCES "public"."terms"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_staff" ADD CONSTRAINT "session_staff_session_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_staff" ADD CONSTRAINT "session_staff_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_template_fk" FOREIGN KEY ("organization_id","class_template_id") REFERENCES "public"."class_templates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_term_fk" FOREIGN KEY ("organization_id","term_id") REFERENCES "public"."terms"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_venue_fk" FOREIGN KEY ("organization_id","venue_id") REFERENCES "public"."venues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_changes" ADD CONSTRAINT "shift_changes_template_fk" FOREIGN KEY ("organization_id","class_template_id") REFERENCES "public"."class_templates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_changes" ADD CONSTRAINT "shift_changes_session_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_changes" ADD CONSTRAINT "shift_changes_respondent_fk" FOREIGN KEY ("organization_id","respondent_staff_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_bookings" ADD CONSTRAINT "slot_bookings_slot_fk" FOREIGN KEY ("organization_id","slot_id") REFERENCES "public"."private_slots"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_bookings" ADD CONSTRAINT "slot_bookings_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_templates_venue_weekday" ON "class_templates" USING btree ("venue_id","weekday");--> statement-breakpoint
CREATE INDEX "class_templates_lead" ON "class_templates" USING btree ("lead_staff_id");--> statement-breakpoint
CREATE INDEX "enrollments_template" ON "enrollments" USING btree ("class_template_id","status");--> statement-breakpoint
CREATE INDEX "enrollments_student" ON "enrollments" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_one_seat" ON "enrollments" USING btree ("student_id","class_template_id") WHERE ends_on is null and status in ('trial_booked', 'active', 'frozen', 'cancel_requested');--> statement-breakpoint
CREATE INDEX "private_slots_staff_date" ON "private_slots" USING btree ("staff_member_id","date");--> statement-breakpoint
CREATE INDEX "private_slots_org_date" ON "private_slots" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "generation_runs_term" ON "session_generation_runs" USING btree ("term_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_staff_one_lead" ON "session_staff" USING btree ("session_id") WHERE role = 'lead';--> statement-breakpoint
CREATE INDEX "session_staff_staff" ON "session_staff" USING btree ("staff_member_id");--> statement-breakpoint
CREATE INDEX "sessions_org_date" ON "sessions" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "sessions_venue_date" ON "sessions" USING btree ("venue_id","date");--> statement-breakpoint
CREATE INDEX "shift_changes_respondent" ON "shift_changes" USING btree ("respondent_staff_id","status");--> statement-breakpoint
CREATE INDEX "shift_changes_org_status" ON "shift_changes" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "slot_bookings_once" ON "slot_bookings" USING btree ("slot_id","student_id") WHERE status = 'booked';--> statement-breakpoint
CREATE INDEX "waitlist_org_status" ON "waitlist_entries" USING btree ("organization_id","status");