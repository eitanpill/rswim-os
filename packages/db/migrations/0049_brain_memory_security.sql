-- The brain's memory (docs/AI-BRAIN.md, stage 5) belongs to the owner, like the brain's settings and journal: the
-- monthly facts and what it remembers about families and staff. The tenant's system role writes it in the daily sweep.

-- ─── Triggers ───────────────────────────────────────────────────────────────
create trigger set_updated_at before update on business_snapshots
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on business_memories
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on business_memories
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
alter table business_snapshots enable row level security;
alter table business_memories enable row level security;
create policy business_snapshots_owner on business_snapshots for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner()));
create policy business_memories_owner on business_memories for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner()));
