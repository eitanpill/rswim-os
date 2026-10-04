CREATE TABLE "applicants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"phone_e164" text,
	"email" text,
	"gender" text,
	"source" text DEFAULT 'other' NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"certifications" text,
	"rate_expectation_agorot" integer,
	"availability" text,
	"scorecard" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trial_day_on" date,
	"notes" text,
	"staff_member_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applicants_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "applicants_stage_check" CHECK (stage in ('new', 'screening', 'trial_day', 'offer', 'hired', 'talent_pool', 'rejected')),
	CONSTRAINT "applicants_source_check" CHECK (source in ('facebook', 'college', 'referral', 'swim_club', 'website', 'other')),
	CONSTRAINT "applicants_gender_check" CHECK ("applicants"."gender" is null or "applicants"."gender" in ('female', 'male')),
	CONSTRAINT "applicants_rate_check" CHECK ("applicants"."rate_expectation_agorot" is null or "applicants"."rate_expectation_agorot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"period" text NOT NULL,
	"kind" text NOT NULL,
	"routing" text DEFAULT 'payslip' NOT NULL,
	"amount_agorot" integer NOT NULL,
	"note" text NOT NULL,
	"timesheet_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_adjustments_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "payroll_adjustments_period_check" CHECK ("payroll_adjustments"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_adjustments_kind_check" CHECK (kind in ('bonus', 'correction', 'expense')),
	CONSTRAINT "payroll_adjustments_routing_check" CHECK (routing in ('payslip', 'transfer')),
	CONSTRAINT "payroll_adjustments_amount_check" CHECK ("payroll_adjustments"."amount_agorot" <> 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"period" text NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"routing" text NOT NULL,
	"kind" text NOT NULL,
	"work_kind" text,
	"date" date,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit" text NOT NULL,
	"amount_agorot" integer NOT NULL,
	"pay_rule_id" uuid,
	"session_id" uuid,
	"slot_id" uuid,
	"adjustment_id" uuid,
	"explanation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_lines_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "payroll_lines_period_check" CHECK ("payroll_lines"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_lines_routing_check" CHECK (routing in ('payslip', 'transfer')),
	CONSTRAINT "payroll_lines_kind_check" CHECK (kind in ('work', 'travel', 'adjustment')),
	CONSTRAINT "payroll_lines_work_kind_check" CHECK (work_kind is null or work_kind in ('group', 'slot'))
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"policy_version_key" text,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"drafted_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "payroll_runs_once" UNIQUE("organization_id","period"),
	CONSTRAINT "payroll_runs_period_check" CHECK ("payroll_runs"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_runs_status_check" CHECK (status in ('draft', 'approved')),
	CONSTRAINT "payroll_runs_approved_check" CHECK (("payroll_runs"."status" = 'approved') = ("payroll_runs"."approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "sick_leave_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"date" date,
	"half_days" smallint NOT NULL,
	"run_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sick_leave_entries_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "sick_leave_entries_period_check" CHECK ("sick_leave_entries"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "sick_leave_entries_kind_check" CHECK (kind in ('accrual', 'taken')),
	CONSTRAINT "sick_leave_entries_sign_check" CHECK (("sick_leave_entries"."kind" = 'accrual' and "sick_leave_entries"."half_days" > 0) or ("sick_leave_entries"."kind" = 'taken' and "sick_leave_entries"."half_days" < 0 and "sick_leave_entries"."date" is not null))
);
--> statement-breakpoint
CREATE TABLE "substitute_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"wave" smallint NOT NULL,
	"rank" smallint NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"offered_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "substitute_offers_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "substitute_offers_once" UNIQUE("request_id","staff_member_id"),
	CONSTRAINT "substitute_offers_status_check" CHECK (status in ('queued', 'offered', 'accepted', 'declined', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "substitute_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"from_staff_id" uuid,
	"reason" text,
	"lesson" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"wave" smallint DEFAULT 0 NOT NULL,
	"next_wave_at" timestamp with time zone,
	"filled_by" uuid,
	"filled_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "substitute_requests_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "substitute_requests_status_check" CHECK (status in ('open', 'filled', 'unfilled', 'cancelled')),
	CONSTRAINT "substitute_requests_filled_check" CHECK (("substitute_requests"."status" = 'filled') = ("substitute_requests"."filled_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "timesheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dispute_note" text,
	"resolution" text,
	"confirmed_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheets_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "timesheets_once" UNIQUE("organization_id","staff_member_id","period"),
	CONSTRAINT "timesheets_period_check" CHECK ("timesheets"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "timesheets_status_check" CHECK (status in ('open', 'confirmed', 'disputed', 'resolved')),
	CONSTRAINT "timesheets_dispute_check" CHECK ("timesheets"."status" <> 'disputed' or "timesheets"."dispute_note" is not null)
);
--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_fk" FOREIGN KEY ("organization_id","run_id") REFERENCES "public"."payroll_runs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sick_leave_entries" ADD CONSTRAINT "sick_leave_entries_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_offers" ADD CONSTRAINT "substitute_offers_request_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."substitute_requests"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_offers" ADD CONSTRAINT "substitute_offers_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_requests" ADD CONSTRAINT "substitute_requests_session_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applicants_org_stage" ON "applicants" USING btree ("organization_id","stage");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_period" ON "payroll_adjustments" USING btree ("organization_id","period");--> statement-breakpoint
CREATE INDEX "payroll_lines_run_staff" ON "payroll_lines" USING btree ("run_id","staff_member_id");--> statement-breakpoint
CREATE INDEX "sick_leave_entries_staff" ON "sick_leave_entries" USING btree ("staff_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sick_leave_accrual_once" ON "sick_leave_entries" USING btree ("organization_id","staff_member_id","period") WHERE kind = 'accrual';--> statement-breakpoint
CREATE UNIQUE INDEX "substitute_offers_one_accepted" ON "substitute_offers" USING btree ("request_id") WHERE status = 'accepted';--> statement-breakpoint
CREATE INDEX "substitute_offers_staff" ON "substitute_offers" USING btree ("staff_member_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "substitute_requests_one_open" ON "substitute_requests" USING btree ("session_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "substitute_requests_org_status" ON "substitute_requests" USING btree ("organization_id","status");