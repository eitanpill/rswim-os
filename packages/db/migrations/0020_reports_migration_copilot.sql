CREATE TABLE "venue_migration_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"migration_id" uuid NOT NULL,
	"source_template_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"target_venue_id" uuid,
	"target_pool_id" uuid,
	"target_lane_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"target_starts_at" time,
	"target_template_id" uuid,
	"lead_choice" text DEFAULT 'keep' NOT NULL,
	"new_lead_staff_id" uuid,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_migration_items_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "venue_migration_items_once" UNIQUE("migration_id","source_template_id"),
	CONSTRAINT "venue_migration_items_mode_check" CHECK (mode in ('relocate', 'merge')),
	CONSTRAINT "venue_migration_items_lead_check" CHECK (lead_choice in ('keep', 'other', 'none') and (lead_choice = 'other') = (new_lead_staff_id is not null)),
	CONSTRAINT "venue_migration_items_shape_check" CHECK (case "venue_migration_items"."mode"
        when 'relocate' then "venue_migration_items"."target_venue_id" is not null and "venue_migration_items"."target_pool_id" is not null
          and "venue_migration_items"."target_starts_at" is not null and cardinality("venue_migration_items"."target_lane_ids") > 0
          and "venue_migration_items"."target_template_id" is null
        when 'merge' then "venue_migration_items"."target_template_id" is not null
      end)
);
--> statement-breakpoint
CREATE TABLE "venue_migrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_venue_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"reason" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"executed_at" timestamp with time zone,
	"executed_by" uuid,
	"revert_until" timestamp with time zone,
	"reverted_at" timestamp with time zone,
	"reverted_by" uuid,
	"policy_version_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_migrations_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "venue_migrations_status_check" CHECK (status in ('draft', 'executed', 'reverted')),
	CONSTRAINT "venue_migrations_executed_check" CHECK ("venue_migrations"."status" = 'draft' or ("venue_migrations"."executed_at" is not null and "venue_migrations"."revert_until" is not null))
);
--> statement-breakpoint
CREATE TABLE "copilot_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"result" jsonb,
	"error_code" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copilot_actions_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "copilot_actions_kind_check" CHECK (kind in ('move_student', 'message_family', 'open_makeup_slots')),
	CONSTRAINT "copilot_actions_status_check" CHECK (status in ('proposed', 'confirmed', 'failed', 'dismissed', 'undone'))
);
--> statement-breakpoint
CREATE TABLE "copilot_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"answer" text,
	"trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copilot_requests_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "copilot_requests_status_check" CHECK (status in ('answered', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "weekly_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"week_of" date NOT NULL,
	"facts" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_digests_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "weekly_digests_once" UNIQUE("organization_id","week_of")
);
--> statement-breakpoint
ALTER TABLE "portal_requests" DROP CONSTRAINT "portal_requests_reason_check";--> statement-breakpoint
ALTER TABLE "automation_rules" DROP CONSTRAINT "automation_rules_template_check";--> statement-breakpoint
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_key_check";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_template_check";--> statement-breakpoint
ALTER TABLE "cancellation_requests" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "venue_migration_items" ADD CONSTRAINT "venue_migration_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_migration_items" ADD CONSTRAINT "venue_migration_items_migration_fk" FOREIGN KEY ("organization_id","migration_id") REFERENCES "public"."venue_migrations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_migration_items" ADD CONSTRAINT "venue_migration_items_source_fk" FOREIGN KEY ("organization_id","source_template_id") REFERENCES "public"."class_templates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_migration_items" ADD CONSTRAINT "venue_migration_items_target_fk" FOREIGN KEY ("organization_id","target_template_id") REFERENCES "public"."class_templates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_migration_items" ADD CONSTRAINT "venue_migration_items_venue_fk" FOREIGN KEY ("organization_id","target_venue_id") REFERENCES "public"."venues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_migration_items" ADD CONSTRAINT "venue_migration_items_pool_fk" FOREIGN KEY ("organization_id","target_pool_id") REFERENCES "public"."pools"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_migration_items" ADD CONSTRAINT "venue_migration_items_lead_fk" FOREIGN KEY ("organization_id","new_lead_staff_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_migrations" ADD CONSTRAINT "venue_migrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_migrations" ADD CONSTRAINT "venue_migrations_venue_fk" FOREIGN KEY ("organization_id","source_venue_id") REFERENCES "public"."venues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD CONSTRAINT "copilot_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD CONSTRAINT "copilot_actions_request_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."copilot_requests"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_requests" ADD CONSTRAINT "copilot_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_digests" ADD CONSTRAINT "weekly_digests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "venue_migrations_one_draft" ON "venue_migrations" USING btree ("source_venue_id") WHERE status = 'draft';--> statement-breakpoint
CREATE INDEX "copilot_actions_request" ON "copilot_actions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "copilot_requests_recent" ON "copilot_requests" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_reason_check" CHECK (reason is null or reason in ('cold_water', 'schedule', 'fear', 'moving', 'cost', 'level_done', 'other'));--> statement-breakpoint
ALTER TABLE "portal_requests" ADD CONSTRAINT "portal_requests_reason_check" CHECK (reason is null or reason in ('medical', 'vacation', 'other', 'cold_water', 'schedule', 'fear', 'moving', 'cost', 'level_done'));--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_template_check" CHECK (template_key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'transport_left_school', 'transport_arrived_pool', 'transport_left_pool', 'transport_dropped_off', 'venue_migration', 'venue_migration_reverted', 'free_text'));--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_key_check" CHECK (key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'transport_left_school', 'transport_arrived_pool', 'transport_left_pool', 'transport_dropped_off', 'venue_migration', 'venue_migration_reverted', 'free_text'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_check" CHECK (template_key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'transport_left_school', 'transport_arrived_pool', 'transport_left_pool', 'transport_dropped_off', 'venue_migration', 'venue_migration_reverted', 'free_text'));