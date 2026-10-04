-- Phase 5 security layer: FKs drizzle cannot express, triggers, grants and RLS for the communications tables.

-- ─── FKs with SET NULL on one column of a composite key ─────────────────────
alter table messages
  add constraint messages_guardian_fk foreign key (organization_id, guardian_id)
    references guardians (organization_id, id) on delete set null (guardian_id),
  add constraint messages_household_fk foreign key (organization_id, household_id)
    references households (organization_id, id) on delete set null (household_id),
  add constraint messages_broadcast_fk foreign key (organization_id, broadcast_id)
    references broadcasts (organization_id, id) on delete set null (broadcast_id),
  add constraint messages_inbound_fk foreign key (organization_id, inbound_message_id)
    references inbound_messages (organization_id, id) on delete set null (inbound_message_id);
alter table inbound_messages
  add constraint inbound_messages_guardian_fk foreign key (organization_id, guardian_id)
    references guardians (organization_id, id) on delete set null (guardian_id),
  add constraint inbound_messages_household_fk foreign key (organization_id, household_id)
    references households (organization_id, id) on delete set null (household_id),
  add constraint inbound_messages_staff_fk foreign key (organization_id, staff_member_id)
    references staff_members (organization_id, id) on delete set null (staff_member_id);
--> statement-breakpoint

-- ─── Triggers ───────────────────────────────────────────────────────────────
-- The log is the record of what was said: a message that went out (or was blocked) keeps its text and recipient.
create or replace function app.guard_message() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if not app.org_deleted(old.organization_id) then
      raise exception 'comms.errors.logLocked' using errcode = 'RSW01';
    end if;
    return old;
  end if;
  if old.status in ('sent', 'blocked')
     and (new.status <> old.status or new.body is distinct from old.body
          or new.to_phone_e164 is distinct from old.to_phone_e164) then
    raise exception 'comms.errors.logLocked' using errcode = 'RSW01';
  end if;
  return new;
end $$;
create trigger guard_message before update or delete on messages
  for each row execute function app.guard_message();

do $$
declare t text;
begin
  foreach t in array array['message_templates', 'automation_rules', 'broadcasts', 'messages', 'inbound_messages',
                           'triage_actions'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['message_templates', 'automation_rules', 'broadcasts', 'triage_actions'] loop
    execute format('create trigger audit_row after insert or update or delete on %I for each row execute function app.audit_row()', t);
  end loop;
end $$;
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
-- Owner/admin (and the tenant's worker) manage communications. Families read the messages sent to their household and
-- the ones they wrote; nobody else (instructors, escorts, the accountant) reads families' conversations.
do $$
declare t text;
begin
  foreach t in array array['message_templates', 'automation_rules', 'broadcasts', 'messages', 'inbound_messages',
                           'triage_actions'] loop
    execute format($f$
      create policy %1$s_write on %1$I for all to authenticated, rswim_system
        using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
        with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))$f$, t);
  end loop;
  foreach t in array array['messages', 'inbound_messages'] loop
    execute format($f$
      create policy %1$s_family on %1$I for select to authenticated
        using (organization_id = (select app.current_org())
               and household_id in (select app.guardian_household_ids()))$f$, t);
  end loop;
end $$;

