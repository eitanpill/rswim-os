CREATE TABLE "ghl_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"mode" text DEFAULT 'shadow' NOT NULL,
	"location_id" text NOT NULL,
	"hook_token" text NOT NULL,
	"enc_token" "bytea" NOT NULL,
	"location_name" text,
	"checked_at" timestamp with time zone,
	"check_error" text,
	"last_inbound_at" timestamp with time zone,
	"last_error" text,
	"foreign_replies" integer DEFAULT 0 NOT NULL,
	"last_foreign_at" timestamp with time zone,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ghl_connections_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "ghl_connections_org" UNIQUE("organization_id"),
	CONSTRAINT "ghl_connections_status_check" CHECK (status in ('connected', 'disconnected')),
	CONSTRAINT "ghl_connections_mode_check" CHECK (mode in ('shadow', 'live'))
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_status_check";--> statement-breakpoint
ALTER TABLE "ghl_connections" ADD CONSTRAINT "ghl_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_status_check" CHECK (status in ('queued', 'held', 'sent', 'failed', 'blocked', 'suggested', 'dismissed'));--> statement-breakpoint

-- WhatsApp through the business's own GHL sub-account belongs to the owner, like its own Meta number. The token is
-- enc_token, which signed-in users cannot select (column grants below); only the tenant's system role (the worker,
-- the hook) opens it with the org's data key.
create trigger set_updated_at before update on ghl_connections
  for each row execute function app.set_updated_at();--> statement-breakpoint
create trigger audit_row after insert or update or delete on ghl_connections
  for each row execute function app.audit_row();--> statement-breakpoint
grant select, insert, update, delete on ghl_connections to rswim_system;--> statement-breakpoint
grant insert, update, delete on ghl_connections to authenticated;--> statement-breakpoint
grant select (id, organization_id, status, mode, location_id, hook_token, location_name, checked_at, check_error,
              last_inbound_at, last_error, foreign_replies, last_foreign_at, connected_by, connected_at,
              created_at, updated_at)
  on ghl_connections to authenticated;--> statement-breakpoint
alter table ghl_connections enable row level security;--> statement-breakpoint
create policy ghl_connections_owner on ghl_connections for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner()));--> statement-breakpoint
-- The office sees whether the bridge is on and in which mode, never its token (column grants above).
create policy ghl_connections_office_read on ghl_connections for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
