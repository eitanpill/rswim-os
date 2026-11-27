CREATE TABLE "invoicing_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"enc_credentials" "bytea" NOT NULL,
	"credential_hints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_check_error" text,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoicing_connections_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "invoicing_connections_org" UNIQUE("organization_id"),
	CONSTRAINT "invoicing_connections_provider_check" CHECK (provider in ('morning')),
	CONSTRAINT "invoicing_connections_status_check" CHECK (status in ('connected', 'failed', 'disconnected'))
);
--> statement-breakpoint
ALTER TABLE "invoicing_connections" ADD CONSTRAINT "invoicing_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- The business's own receipts account (docs/payments/MORNING.md) belongs to the owner, like its processor. Its API
-- key is enc_credentials, which signed-in users cannot select (column grants below); only the tenant's system role
-- (the worker issuing documents) opens it with the org's data key.
create trigger set_updated_at before update on invoicing_connections
  for each row execute function app.set_updated_at();--> statement-breakpoint
create trigger audit_row after insert or update or delete on invoicing_connections
  for each row execute function app.audit_row();--> statement-breakpoint
grant select, insert, update, delete on invoicing_connections to rswim_system;--> statement-breakpoint
grant insert, update, delete on invoicing_connections to authenticated;--> statement-breakpoint
grant select (id, organization_id, provider, status, credential_hints, last_checked_at, last_check_error,
              connected_by, created_at, updated_at)
  on invoicing_connections to authenticated;--> statement-breakpoint
alter table invoicing_connections enable row level security;--> statement-breakpoint
create policy invoicing_connections_owner on invoicing_connections for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner()));--> statement-breakpoint
-- The office and the accountant see whether receipts are connected, never the key (column grants above).
create policy invoicing_connections_office_read on invoicing_connections for select to authenticated
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin()) or (select app.current_app_role()) = 'accountant'));
