CREATE TABLE "coach_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"week_of" date NOT NULL,
	"priorities" jsonb NOT NULL,
	"review" jsonb,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_weeks_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "coach_weeks_week" UNIQUE("organization_id","week_of"),
	CONSTRAINT "coach_weeks_sunday_check" CHECK (extract(dow from "coach_weeks"."week_of") = 0)
);
--> statement-breakpoint
ALTER TABLE "coach_weeks" ADD CONSTRAINT "coach_weeks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The coach's weeks belong to the owner, like the brain's memory (0049); the tenant's system role writes them on Sunday.
alter table coach_weeks enable row level security;
--> statement-breakpoint
grant select, insert, update on coach_weeks to authenticated, rswim_system;
--> statement-breakpoint
create policy coach_weeks_owner on coach_weeks for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner()));
--> statement-breakpoint
create trigger set_updated_at before update on coach_weeks
  for each row execute function app.set_updated_at();
