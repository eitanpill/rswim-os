CREATE TABLE "chat_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"taken_by" uuid,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_holds_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "chat_holds_phone" UNIQUE("organization_id","phone_e164")
);
--> statement-breakpoint
ALTER TABLE "chat_holds" ADD CONSTRAINT "chat_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- WhatsApp track W9: a conversation a person took over is the office's (owner and admins) and the tenant's worker,
-- which reads it before any bot answers.
alter table chat_holds enable row level security;
--> statement-breakpoint
grant select, insert, update, delete on chat_holds to authenticated, rswim_system;
--> statement-breakpoint
create policy chat_holds_office on chat_holds for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
--> statement-breakpoint
create trigger set_updated_at before update on chat_holds for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger audit_row after insert or update or delete on chat_holds for each row execute function app.audit_row();
