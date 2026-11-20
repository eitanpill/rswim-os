CREATE TABLE "whatsapp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"phone_number_id" text NOT NULL,
	"business_account_id" text NOT NULL,
	"display_phone" text NOT NULL,
	"verify_token" text NOT NULL,
	"enc_access_token" "bytea" NOT NULL,
	"enc_app_secret" "bytea" NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_error" text,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_connections_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "whatsapp_connections_org" UNIQUE("organization_id"),
	CONSTRAINT "whatsapp_connections_phone" UNIQUE("phone_number_id"),
	CONSTRAINT "whatsapp_connections_status_check" CHECK (status in ('connected', 'disconnected', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_block_check";--> statement-breakpoint
ALTER TABLE "message_templates" ADD COLUMN "meta_name" text;--> statement-breakpoint
ALTER TABLE "message_templates" ADD COLUMN "meta_params" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "vars" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_block_check" CHECK ((status = 'blocked') = (block_reason is not null) and (block_reason is null or block_reason in ('opted_out', 'no_phone', 'missing_variable', 'template_inactive', 'no_provider', 'outside_window')));--> statement-breakpoint

-- WhatsApp track W5: the business's own number on Meta's Cloud API belongs to the owner, like its payment processor.
-- Its secrets are enc_* columns that signed-in users cannot select (column grants below); only the
-- tenant's system role (the worker, the webhook) opens them with the org's data key.
create trigger set_updated_at before update on whatsapp_connections
  for each row execute function app.set_updated_at();--> statement-breakpoint
create trigger audit_row after insert or update or delete on whatsapp_connections
  for each row execute function app.audit_row();--> statement-breakpoint
grant select, insert, update, delete on whatsapp_connections to rswim_system;--> statement-breakpoint
grant insert, update, delete on whatsapp_connections to authenticated;--> statement-breakpoint
grant select (id, organization_id, status, phone_number_id, business_account_id, display_phone, verify_token,
              last_inbound_at, last_error, connected_by, created_at, updated_at)
  on whatsapp_connections to authenticated;--> statement-breakpoint
alter table whatsapp_connections enable row level security;--> statement-breakpoint
create policy whatsapp_connections_owner on whatsapp_connections for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner()));--> statement-breakpoint
-- The office sees whether the number is connected (and which), never its secrets (column grants above).
create policy whatsapp_connections_office_read on whatsapp_connections for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
