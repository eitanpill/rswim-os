-- The business's own payment processor (docs/PAYMENTS.md). The connection belongs to the owner, like the brain's
-- settings; its credentials are enc_* columns, so apply_standard_grants keeps them unreadable for signed-in users
-- and only the tenant's system role (the checkout, the worker) opens them with the org's data key.
-- Checkouts are money rows: the office manages them, the accountant reads them, a family reads its own.

-- ─── Triggers ───────────────────────────────────────────────────────────────
create trigger set_updated_at before update on payment_connections
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on payment_connections
  for each row execute function app.audit_row();
create trigger set_updated_at before update on checkouts
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on checkouts
  for each row execute function app.audit_row();
--> statement-breakpoint

-- ─── Grants ─────────────────────────────────────────────────────────────────
select app.apply_standard_grants();
revoke select on staff_invites from authenticated;
grant select (id, organization_id, role, email, phone_e164, staff_member_id, expires_at, accepted_at,
              accepted_by, revoked_at, created_by, created_at) on staff_invites to authenticated;
grant execute on all functions in schema app to authenticated, rswim_system;
revoke execute on function app.apply_standard_grants() from public, authenticated, rswim_system;
--> statement-breakpoint

-- ─── Row level security ─────────────────────────────────────────────────────
alter table payment_connections enable row level security;
alter table checkouts enable row level security;

create policy payment_connections_owner on payment_connections for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner()));
-- The office sees whether a processor is connected (to offer "pay now"), never its secrets (column grants above).
create policy payment_connections_office_read on payment_connections for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));

create policy checkouts_write on checkouts for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy checkouts_accountant on checkouts for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.current_app_role()) = 'accountant');
create policy checkouts_family on checkouts for select to authenticated
  using (organization_id = (select app.current_org())
         and household_id in (select app.guardian_household_ids()));
