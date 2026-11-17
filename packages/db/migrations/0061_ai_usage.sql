-- SaaS stage 6: Claude in the product has a monthly allowance per plan (docs/saas/DECISIONS.md, decision 8).
--
-- ai_usage holds one row per piece of AI work, an "AI action" in the price list (a copilot question, a bot reply, a
-- triage, the morning notes, a file's columns), with the tokens it used and its cost in millionths of a dollar, so the
-- platform sees what each school really costs. It is append-only: nobody updates or deletes a row.
-- plans.ai_monthly_actions is how many AI actions a school may run in a calendar month (Asia/Jerusalem); null = no
-- cap. The parents' bot becomes a plan feature (parent_bot).

alter table plans
  add column ai_monthly_actions integer,
  add constraint plans_ai_actions_check check (ai_monthly_actions >= 0);--> statement-breakpoint
alter table plans drop constraint plans_features_check;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_features_check" CHECK (features <@ array['reports', 'courses', 'transport', 'institutions', 'copilot', 'parent_bot']::text[]);
--> statement-breakpoint

CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "ai_usage_feature_check" CHECK (feature in ('copilot', 'parent_bot', 'triage', 'insights', 'import_columns')),
	CONSTRAINT "ai_usage_tokens_check" CHECK (input_tokens >= 0 and output_tokens >= 0 and cache_read_tokens >= 0 and cache_write_tokens >= 0 and cost_micros >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_month" ON "ai_usage" USING btree ("organization_id","created_at");--> statement-breakpoint

create trigger audit_row after insert or update or delete on ai_usage
  for each row execute function app.audit_row();
--> statement-breakpoint

grant select, insert on ai_usage to authenticated, rswim_system;
--> statement-breakpoint

-- The owner and the admins read the month's usage; any staff member's AI work (and the worker's) adds to it.
alter table ai_usage enable row level security;
create policy ai_usage_read on ai_usage for select to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy ai_usage_add on ai_usage for insert to authenticated, rswim_system
  with check (organization_id = (select app.current_org()) and (select app.is_staff()));
--> statement-breakpoint

-- The parent bot hands a message to the office when the allowance is used up.
alter table bot_replies drop constraint bot_replies_handoff_check;--> statement-breakpoint
ALTER TABLE "bot_replies" ADD CONSTRAINT "bot_replies_handoff_check" CHECK ((outcome = 'handed_off') = (handoff_reason is not null) and (handoff_reason is null or handoff_reason in ('unknown', 'sensitive', 'needs_action', 'model_failed', 'ai_cap')));
