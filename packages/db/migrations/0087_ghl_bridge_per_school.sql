ALTER TABLE "org_subscriptions" ADD COLUMN "extras" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_extras_check" CHECK (extras <@ array['ghl_bridge']::text[]);--> statement-breakpoint
-- An option the platform turned on for one business by hand (org_subscriptions.extras). Security definer so every
-- role asks the same question; inside a school's own database the subscription is the copy synced down.
create or replace function app.has_extra(org uuid, extra text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select extra = any (s.extras) from org_subscriptions s where s.organization_id = org), false)
$$;--> statement-breakpoint
revoke execute on function app.has_extra(uuid, text) from public, anon;--> statement-breakpoint
grant execute on function app.has_extra(uuid, text) to authenticated, rswim_system;--> statement-breakpoint
-- The GHL bridge exists only for a business the platform gave it to: without the option nobody sees, changes or uses
-- the connection (it comes back as it was if the option is turned on again).
drop policy ghl_connections_owner on ghl_connections;--> statement-breakpoint
create policy ghl_connections_owner on ghl_connections for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner())
         and app.has_extra(organization_id, 'ghl_bridge'))
  with check (organization_id = (select app.current_org()) and (select app.is_owner())
              and app.has_extra(organization_id, 'ghl_bridge'));--> statement-breakpoint
drop policy ghl_connections_office_read on ghl_connections;--> statement-breakpoint
create policy ghl_connections_office_read on ghl_connections for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin())
         and app.has_extra(organization_id, 'ghl_bridge'));
