-- The business brain (docs/AI-BRAIN.md): its settings belong to the owner, like the copilot. The journal stays in
-- copilot_actions, whose owner-only policy (0021) already covers rows from every channel.

-- ─── Triggers ───────────────────────────────────────────────────────────────
create trigger set_updated_at before update on agent_settings
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on agent_settings
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
alter table agent_settings enable row level security;
create policy agent_settings_owner on agent_settings for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner()));
