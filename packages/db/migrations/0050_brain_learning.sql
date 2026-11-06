ALTER TABLE "agent_settings" ADD COLUMN "learning" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD COLUMN "dismiss_reason" text;--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD CONSTRAINT "copilot_actions_dismiss_reason_check" CHECK (dismiss_reason is null or dismiss_reason in ('not_now', 'special_case', 'too_small', 'wrong'));