ALTER TABLE "ghl_connections" ADD COLUMN "whatsapp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ghl_connections" ADD COLUMN "summary" jsonb;--> statement-breakpoint
-- Every connection made so far was made for WhatsApp through GHL: it keeps doing that.
update ghl_connections set whatsapp = true;--> statement-breakpoint
-- The GHL connection is open to every business now (Pit 2026-11-28): the owner manages it, the office reads it, and the
-- platform's per-business option no longer decides who may have one.
drop policy ghl_connections_owner on ghl_connections;--> statement-breakpoint
create policy ghl_connections_owner on ghl_connections for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner()));--> statement-breakpoint
drop policy ghl_connections_office_read on ghl_connections;--> statement-breakpoint
create policy ghl_connections_office_read on ghl_connections for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
--> statement-breakpoint
-- Signed-in users read the two new columns too (the token stays out of reach).
grant select (whatsapp, summary) on ghl_connections to authenticated;
