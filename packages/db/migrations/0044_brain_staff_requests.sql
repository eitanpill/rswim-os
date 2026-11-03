ALTER TABLE "agent_settings" ADD COLUMN "approval_phone_e164" text;--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD COLUMN "ref" integer;--> statement-breakpoint
CREATE INDEX "copilot_actions_ref" ON "copilot_actions" USING btree ("organization_id","ref");