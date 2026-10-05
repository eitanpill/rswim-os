CREATE TABLE "route_riders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"dropoff_point" text,
	"dropoff_note" text,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_riders_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "route_riders_dates_check" CHECK ("route_riders"."ends_on" is null or "route_riders"."ends_on" > "route_riders"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "route_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"date" date NOT NULL,
	"escort_staff_id" uuid,
	"session_id" uuid,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_runs_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "route_runs_once" UNIQUE("organization_id","route_id","date"),
	CONSTRAINT "route_runs_status_check" CHECK (status in ('planned', 'underway', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"student_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "run_events_kind_check" CHECK (kind in ('left_school', 'arrived_pool', 'in_water', 'out_of_water', 'left_pool', 'run_done', 'boarded', 'missing', 'dropped_off')),
	CONSTRAINT "run_events_subject_check" CHECK ((kind in ('left_school', 'arrived_pool', 'in_water', 'out_of_water', 'left_pool', 'run_done')) = (student_id is null))
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"contact_name" text,
	"contact_phone" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schools_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "schools_org_name" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "transport_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"school_id" uuid NOT NULL,
	"class_template_id" uuid NOT NULL,
	"weekdays" smallint[] NOT NULL,
	"leaves_school_at" time NOT NULL,
	"ride_minutes" integer NOT NULL,
	"escort_staff_id" uuid,
	"vehicle" text,
	"driver_name" text,
	"driver_phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_routes_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "transport_routes_org_name" UNIQUE("organization_id","name"),
	CONSTRAINT "transport_routes_ride_check" CHECK ("transport_routes"."ride_minutes" between 0 and 180),
	CONSTRAINT "transport_routes_weekdays_check" CHECK (cardinality("transport_routes"."weekdays") > 0 and "transport_routes"."weekdays" <@ array[0,1,2,3,4,5,6]::smallint[])
);
--> statement-breakpoint
ALTER TABLE "automation_rules" DROP CONSTRAINT "automation_rules_template_check";--> statement-breakpoint
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_key_check";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_template_check";--> statement-breakpoint
ALTER TABLE "route_riders" ADD CONSTRAINT "route_riders_route_fk" FOREIGN KEY ("organization_id","route_id") REFERENCES "public"."transport_routes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_riders" ADD CONSTRAINT "route_riders_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_runs" ADD CONSTRAINT "route_runs_route_fk" FOREIGN KEY ("organization_id","route_id") REFERENCES "public"."transport_routes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_runs" ADD CONSTRAINT "route_runs_escort_fk" FOREIGN KEY ("organization_id","escort_staff_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_runs" ADD CONSTRAINT "route_runs_session_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."sessions"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_fk" FOREIGN KEY ("organization_id","run_id") REFERENCES "public"."route_runs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "public"."schools"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_template_fk" FOREIGN KEY ("organization_id","class_template_id") REFERENCES "public"."class_templates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_escort_fk" FOREIGN KEY ("organization_id","escort_staff_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "route_riders_open" ON "route_riders" USING btree ("organization_id","route_id","student_id") WHERE "route_riders"."ends_on" is null;--> statement-breakpoint
CREATE INDEX "route_riders_student" ON "route_riders" USING btree ("organization_id","student_id");--> statement-breakpoint
CREATE INDEX "route_runs_date" ON "route_runs" USING btree ("organization_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_stage_once" ON "run_events" USING btree ("organization_id","run_id","kind") WHERE "run_events"."student_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_mark_once" ON "run_events" USING btree ("organization_id","run_id","student_id","kind") WHERE "run_events"."student_id" is not null;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_template_check" CHECK (template_key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'transport_left_school', 'transport_arrived_pool', 'transport_left_pool', 'transport_dropped_off', 'free_text'));--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_key_check" CHECK (key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'transport_left_school', 'transport_arrived_pool', 'transport_left_pool', 'transport_dropped_off', 'free_text'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_check" CHECK (template_key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'transport_left_school', 'transport_arrived_pool', 'transport_left_pool', 'transport_dropped_off', 'free_text'));