-- Phase 9 security layer: venue migrations, the owner's copilot and the weekly digest.

-- ─── Triggers ───────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['venue_migrations', 'venue_migration_items', 'copilot_actions'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
    execute format('create trigger audit_row after insert or update or delete on %I for each row execute function app.audit_row()', t);
  end loop;
end $$;
create trigger audit_row after insert or update or delete on copilot_requests
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
-- Venue migrations and digests: the office (and the worker) only.
do $$
declare t text;
begin
  foreach t in array array['venue_migrations', 'venue_migration_items', 'weekly_digests'] loop
    execute format($p$create policy %1$s_office on %1$I for all to authenticated, rswim_system
      using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
      with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))$p$, t);
  end loop;
end $$;

-- The copilot is the owner's: only the owner asks, reads and confirms.
do $$
declare t text;
begin
  foreach t in array array['copilot_requests', 'copilot_actions'] loop
    execute format($p$create policy %1$s_owner on %1$I for all to authenticated, rswim_system
      using (organization_id = (select app.current_org()) and (select app.is_owner()))
      with check (organization_id = (select app.current_org()) and (select app.is_owner()))$p$, t);
  end loop;
end $$;
