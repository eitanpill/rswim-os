CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"template_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"delay_min" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_rules_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "automation_rules_event" UNIQUE("organization_id","event_type"),
	CONSTRAINT "automation_rules_template_check" CHECK (template_key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'free_text')),
	CONSTRAINT "automation_rules_delay_check" CHECK ("automation_rules"."delay_min" between 0 and 10080)
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"segment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"template_key" text,
	"body" text,
	"scheduled_for" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcasts_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "broadcasts_status_check" CHECK (status in ('draft', 'scheduled', 'sent', 'cancelled')),
	CONSTRAINT "broadcasts_content_check" CHECK ("broadcasts"."template_key" is not null or coalesce("broadcasts"."body", '') <> '')
);
--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text DEFAULT 'ghl' NOT NULL,
	"external_id" text NOT NULL,
	"from_phone_e164" text,
	"guardian_id" uuid,
	"household_id" uuid,
	"staff_member_id" uuid,
	"body" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"intent" text NOT NULL,
	"confidence" smallint NOT NULL,
	"classification" jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_messages_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "inbound_messages_external" UNIQUE("organization_id","provider","external_id"),
	CONSTRAINT "inbound_messages_intent_check" CHECK (intent in ('absence_notice', 'makeup_request', 'schedule_question', 'payment_question', 'receipt_request', 'cancellation_request', 'freeze_request', 'lead', 'complaint', 'instructor_message', 'personal_other')),
	CONSTRAINT "inbound_messages_status_check" CHECK (status in ('new', 'actioned', 'dismissed', 'needs_human')),
	CONSTRAINT "inbound_messages_confidence_check" CHECK ("inbound_messages"."confidence" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"locale" text DEFAULT 'he' NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"body" text NOT NULL,
	"ghl_template_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "message_templates_key_locale" UNIQUE("organization_id","key","locale"),
	CONSTRAINT "message_templates_key_check" CHECK (key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'free_text')),
	CONSTRAINT "message_templates_locale_check" CHECK ("message_templates"."locale" in ('he', 'en')),
	CONSTRAINT "message_templates_channel_check" CHECK (channel in ('whatsapp', 'sms'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"guardian_id" uuid,
	"household_id" uuid,
	"to_phone_e164" text,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"template_key" text NOT NULL,
	"locale" text DEFAULT 'he' NOT NULL,
	"body" text,
	"status" text NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"hold_reason" text,
	"block_reason" text,
	"explanation" jsonb,
	"error" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"source_event_id" uuid,
	"source_event_type" text,
	"broadcast_id" uuid,
	"inbound_message_id" uuid,
	"provider_message_id" text,
	"idempotency_key" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "messages_idempotency" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "messages_channel_check" CHECK (channel in ('whatsapp', 'sms')),
	CONSTRAINT "messages_template_check" CHECK (template_key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'free_text')),
	CONSTRAINT "messages_status_check" CHECK (status in ('queued', 'held', 'sent', 'failed', 'blocked')),
	CONSTRAINT "messages_hold_check" CHECK (hold_reason is null or hold_reason in ('quiet_hours', 'rest_window')),
	CONSTRAINT "messages_block_check" CHECK ((status = 'blocked') = (block_reason is not null) and (block_reason is null or block_reason in ('opted_out', 'no_phone', 'missing_variable', 'template_inactive', 'no_provider'))),
	CONSTRAINT "messages_sent_check" CHECK (("messages"."status" = 'sent') = ("messages"."sent_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "triage_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explanation" jsonb,
	"result" jsonb,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_actions_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "triage_actions_kind_check" CHECK (kind in ('absence_notice', 'makeup_request', 'freeze_request', 'cancellation_request', 'receipt_request')),
	CONSTRAINT "triage_actions_status_check" CHECK (status in ('pending', 'approved', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_actions" ADD CONSTRAINT "triage_actions_inbound_fk" FOREIGN KEY ("organization_id","inbound_message_id") REFERENCES "public"."inbound_messages"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_messages_org_status" ON "inbound_messages" USING btree ("organization_id","status","received_at");--> statement-breakpoint
CREATE INDEX "inbound_messages_household" ON "inbound_messages" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "messages_due" ON "messages" USING btree ("status","not_before");--> statement-breakpoint
CREATE INDEX "messages_org_created" ON "messages" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_household" ON "messages" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "triage_actions_one_pending" ON "triage_actions" USING btree ("inbound_message_id") WHERE status = 'pending';