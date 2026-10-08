CREATE TABLE "bot_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'office' NOT NULL,
	"source_inbound_message_id" uuid,
	"created_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_knowledge_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "bot_knowledge_status_check" CHECK (status in ('suggested', 'active', 'archived')),
	CONSTRAINT "bot_knowledge_source_check" CHECK (source in ('office', 'learned')),
	CONSTRAINT "bot_knowledge_question_check" CHECK (length("bot_knowledge"."question") between 1 and 500),
	CONSTRAINT "bot_knowledge_answer_check" CHECK (length("bot_knowledge"."answer") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "bot_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"household_id" uuid,
	"outcome" text NOT NULL,
	"model" text NOT NULL,
	"answer" text,
	"handoff_reason" text,
	"handoff_summary" text,
	"knowledge_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_id" uuid,
	"review" text DEFAULT 'unreviewed' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_replies_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "bot_replies_once" UNIQUE("organization_id","inbound_message_id"),
	CONSTRAINT "bot_replies_outcome_check" CHECK (outcome in ('answered', 'handed_off')),
	CONSTRAINT "bot_replies_review_check" CHECK (review in ('unreviewed', 'good', 'bad')),
	CONSTRAINT "bot_replies_handoff_check" CHECK ((outcome = 'handed_off') = (handoff_reason is not null) and (handoff_reason is null or handoff_reason in ('unknown', 'sensitive', 'needs_action', 'model_failed'))),
	CONSTRAINT "bot_replies_answer_check" CHECK ("bot_replies"."outcome" <> 'answered' or "bot_replies"."answer" is not null)
);
--> statement-breakpoint
ALTER TABLE "automation_rules" DROP CONSTRAINT "automation_rules_template_check";--> statement-breakpoint
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_key_check";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_template_check";--> statement-breakpoint
ALTER TABLE "bot_knowledge" ADD CONSTRAINT "bot_knowledge_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_replies" ADD CONSTRAINT "bot_replies_inbound_fk" FOREIGN KEY ("organization_id","inbound_message_id") REFERENCES "public"."inbound_messages"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_knowledge_org_status" ON "bot_knowledge" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_knowledge_one_per_inbound" ON "bot_knowledge" USING btree ("organization_id","source_inbound_message_id") WHERE source_inbound_message_id is not null;--> statement-breakpoint
CREATE INDEX "bot_replies_recent" ON "bot_replies" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_replies_household" ON "bot_replies" USING btree ("household_id","created_at");--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_template_check" CHECK (template_key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'transport_left_school', 'transport_arrived_pool', 'transport_left_pool', 'transport_dropped_off', 'venue_migration', 'venue_migration_reverted', 'bot_handoff', 'free_text'));--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_key_check" CHECK (key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'transport_left_school', 'transport_arrived_pool', 'transport_left_pool', 'transport_dropped_off', 'venue_migration', 'venue_migration_reverted', 'bot_handoff', 'free_text'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_check" CHECK (template_key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'transport_left_school', 'transport_arrived_pool', 'transport_left_pool', 'transport_dropped_off', 'venue_migration', 'venue_migration_reverted', 'bot_handoff', 'free_text'));