CREATE TABLE "agent_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"profile" text DEFAULT 'careful' NOT NULL,
	"levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_auto_per_day" integer DEFAULT 30 NOT NULL,
	"max_auto_payment_agorot" integer DEFAULT 30000 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_settings_profile_check" CHECK (profile in ('careful', 'balanced', 'autopilot')),
	CONSTRAINT "agent_settings_caps_check" CHECK (max_auto_per_day >= 0 and max_auto_payment_agorot >= 0)
);
--> statement-breakpoint
ALTER TABLE "copilot_actions" DROP CONSTRAINT "copilot_actions_kind_check";--> statement-breakpoint
ALTER TABLE "copilot_actions" ALTER COLUMN "request_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD COLUMN "source" text DEFAULT 'owner_chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD COLUMN "autonomy" text;--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD COLUMN "ran_alone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_actions_recent" ON "copilot_actions" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD CONSTRAINT "copilot_actions_source_check" CHECK (source in ('owner_chat', 'parent_whatsapp', 'staff', 'morning_check'));--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD CONSTRAINT "copilot_actions_autonomy_check" CHECK (autonomy is null or autonomy in ('off', 'suggest', 'approve', 'auto'));--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD CONSTRAINT "copilot_actions_alone_check" CHECK (not "copilot_actions"."ran_alone" or "copilot_actions"."decided_by" is null);--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD CONSTRAINT "copilot_actions_kind_check" CHECK (kind in ('report_absence', 'book_makeup', 'lesson_reminder', 'payment_link', 'freeze', 'move_student', 'message_family', 'substitute', 'cancel_lessons', 'open_makeup_slots'));