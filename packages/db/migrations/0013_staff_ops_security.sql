-- Phase 6 security layer: FKs drizzle cannot express, triggers, grants and RLS for staff operations and payroll.

-- ─── FKs with SET NULL on one column of a composite key ─────────────────────
alter table payroll_lines
  add constraint payroll_lines_pay_rule_fk foreign key (organization_id, pay_rule_id)
    references pay_rules (organization_id, id) on delete set null (pay_rule_id),
  add constraint payroll_lines_session_fk foreign key (organization_id, session_id)
    references sessions (organization_id, id) on delete set null (session_id),
  add constraint payroll_lines_slot_fk foreign key (organization_id, slot_id)
    references private_slots (organization_id, id) on delete set null (slot_id),
  add constraint payroll_lines_adjustment_fk foreign key (organization_id, adjustment_id)
    references payroll_adjustments (organization_id, id) on delete set null (adjustment_id);
alter table payroll_adjustments
  add constraint payroll_adjustments_timesheet_fk foreign key (organization_id, timesheet_id)
    references timesheets (organization_id, id) on delete set null (timesheet_id);
alter table sick_leave_entries
  add constraint sick_leave_entries_run_fk foreign key (organization_id, run_id)
    references payroll_runs (organization_id, id) on delete set null (run_id);
alter table substitute_requests
  add constraint substitute_requests_from_fk foreign key (organization_id, from_staff_id)
    references staff_members (organization_id, id) on delete set null (from_staff_id),
  add constraint substitute_requests_filled_fk foreign key (organization_id, filled_by)
    references staff_members (organization_id, id) on delete cascade;
alter table applicants
  add constraint applicants_staff_fk foreign key (organization_id, staff_member_id)
    references staff_members (organization_id, id) on delete set null (staff_member_id);
--> statement-breakpoint

-- ─── Helpers ────────────────────────────────────────────────────────────────
create or replace function app.payroll_period_locked(p_org uuid, p_period text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from payroll_runs
                 where organization_id = p_org and period = p_period and status = 'approved')
$$;

create or replace function app.payroll_run_approved(p_run uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from payroll_runs where id = p_run and status = 'approved')
$$;

create or replace function app.can_write_payroll() returns boolean
language sql stable as $$ select app.has_permission('payroll.write') $$;

create or replace function app.can_read_payroll() returns boolean
language sql stable as $$
  select app.has_permission('payroll.read') or coalesce(app.current_app_role() = 'accountant', false)
$$;
--> statement-breakpoint

-- ─── Triggers ───────────────────────────────────────────────────────────────
-- An approved run is the record the accountant worked from: its lines never change and it never goes back to draft.
create or replace function app.guard_payroll_run() returns trigger
language plpgsql as $$
begin
  if app.org_deleted(old.organization_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.status = 'approved' then
    raise exception 'payroll.errors.runLocked' using errcode = 'RSW01';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger guard_payroll_run before update or delete on payroll_runs
  for each row execute function app.guard_payroll_run();

create or replace function app.guard_payroll_line() returns trigger
language plpgsql as $$
declare v_run uuid; v_org uuid;
begin
  v_run := case when tg_op = 'INSERT' then new.run_id else old.run_id end;
  v_org := case when tg_op = 'INSERT' then new.organization_id else old.organization_id end;
  if app.org_deleted(v_org) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- A deleted rule, lesson or adjustment only clears its link; nothing a payslip says changes.
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['pay_rule_id', 'session_id', 'slot_id', 'adjustment_id'])
         = (to_jsonb(old) - array['pay_rule_id', 'session_id', 'slot_id', 'adjustment_id']) then
    return new;
  end if;
  if exists (select 1 from payroll_runs where id = v_run and status = 'approved') then
    raise exception 'payroll.errors.runLocked' using errcode = 'RSW01';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger guard_payroll_line before insert or update or delete on payroll_lines
  for each row execute function app.guard_payroll_line();

create or replace function app.guard_payroll_adjustment() returns trigger
language plpgsql as $$
declare r payroll_adjustments;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if app.org_deleted(r.organization_id) then
    return r;
  end if;
  if app.payroll_period_locked(r.organization_id, r.period)
     or (tg_op = 'UPDATE' and app.payroll_period_locked(old.organization_id, old.period)) then
    raise exception 'payroll.errors.periodLocked' using errcode = 'RSW01';
  end if;
  return r;
end $$;
create trigger guard_payroll_adjustment before insert or update or delete on payroll_adjustments
  for each row execute function app.guard_payroll_adjustment();

-- Sick leave is a ledger: entries are added, never changed.
create or replace function app.guard_sick_leave() returns trigger
language plpgsql as $$
begin
  if app.org_deleted(old.organization_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['run_id']) = (to_jsonb(old) - array['run_id']) then
    return new;
  end if;
  raise exception 'payroll.errors.sickLeaveAppendOnly' using errcode = 'RSW01';
end $$;
create trigger guard_sick_leave before update or delete on sick_leave_entries
  for each row execute function app.guard_sick_leave();

-- An instructor confirms or disputes their own month, and only while its payroll is not approved. Everything else
-- about timesheets (resolving a dispute, reopening) is the owner's.
create or replace function app.guard_timesheet() returns trigger
language plpgsql as $$
begin
  if current_user <> 'authenticated' or app.can_write_payroll() then
    return new;
  end if;
  if new.staff_member_id is distinct from app.current_staff_member_id()
     or new.status not in ('confirmed', 'disputed')
     or app.payroll_period_locked(new.organization_id, new.period)
     or new.resolved_by is not null or new.resolved_at is not null or new.resolution is not null then
    raise exception 'payroll.errors.timesheetNotYours' using errcode = 'RSW01';
  end if;
  if tg_op = 'UPDATE'
     and (old.status not in ('open', 'confirmed', 'disputed')
          or (to_jsonb(new) - array['status', 'snapshot', 'dispute_note', 'confirmed_at', 'updated_at'])
             is distinct from (to_jsonb(old) - array['status', 'snapshot', 'dispute_note', 'confirmed_at', 'updated_at'])) then
    raise exception 'payroll.errors.timesheetNotYours' using errcode = 'RSW01';
  end if;
  new.confirmed_at := case when new.status = 'confirmed' then now() else null end;
  return new;
end $$;
create trigger guard_timesheet before insert or update on timesheets
  for each row execute function app.guard_timesheet();

-- First accept wins. Accepting an offer locks its request: if someone got there first the accept fails; otherwise the
-- request is filled and every other offer is withdrawn, in the same statement. An instructor may only answer their
-- own offer while it is offered, and only its status.
create or replace function app.fill_substitute_request(p_offer substitute_offers) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  -- Callable only for an offer that is still offered to that person, by them or by the office.
  if not exists (select 1 from substitute_offers o
                 where o.id = p_offer.id and o.staff_member_id = p_offer.staff_member_id
                   and o.request_id = p_offer.request_id and o.status in ('queued', 'offered')
                   and (app.is_owner_or_admin() or o.staff_member_id = app.current_staff_member_id())) then
    raise exception 'staffing.errors.offerClosed' using errcode = 'RSW01';
  end if;
  select status into v_status from substitute_requests where id = p_offer.request_id for update;
  if v_status is distinct from 'open' then
    raise exception 'staffing.errors.substituteTaken' using errcode = 'RSW01';
  end if;
  update substitute_requests
     set status = 'filled', filled_by = p_offer.staff_member_id, filled_at = now(), next_wave_at = null
   where id = p_offer.request_id;
  update substitute_offers
     set status = 'withdrawn'
   where request_id = p_offer.request_id and id <> p_offer.id and status in ('queued', 'offered');
end $$;

create or replace function app.guard_substitute_offer() returns trigger
language plpgsql as $$
begin
  if current_user = 'authenticated' and not app.is_owner_or_admin() then
    if old.staff_member_id is distinct from app.current_staff_member_id()
       or old.status <> 'offered' or new.status not in ('accepted', 'declined')
       or (to_jsonb(new) - array['status', 'responded_at', 'updated_at'])
          is distinct from (to_jsonb(old) - array['status', 'responded_at', 'updated_at']) then
      raise exception 'staffing.errors.offerClosed' using errcode = 'RSW01';
    end if;
  end if;
  if new.status in ('accepted', 'declined') and old.status is distinct from new.status then
    new.responded_at := now();
  end if;
  if new.status = 'accepted' and old.status <> 'accepted' then
    perform app.fill_substitute_request(new);
  end if;
  return new;
end $$;
create trigger guard_substitute_offer before update on substitute_offers
  for each row execute function app.guard_substitute_offer();

do $$
declare t text;
begin
  foreach t in array array['timesheets', 'payroll_runs', 'substitute_requests', 'substitute_offers', 'applicants'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['timesheets', 'payroll_runs', 'payroll_adjustments', 'sick_leave_entries',
                           'substitute_requests', 'substitute_offers', 'applicants'] loop
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
-- Payroll: payroll.write manages (owners implicitly, and the tenant's worker); payroll.read and the accountant read.
-- An instructor reads their own month, their own lines once the run is approved, and their sick-leave balance.
do $$
declare t text;
begin
  foreach t in array array['timesheets', 'payroll_runs', 'payroll_lines', 'payroll_adjustments', 'sick_leave_entries'] loop
    execute format($f$
      create policy %1$s_write on %1$I for all to authenticated, rswim_system
        using (organization_id = (select app.current_org()) and (select app.can_write_payroll()))
        with check (organization_id = (select app.current_org()) and (select app.can_write_payroll()))$f$, t);
    execute format($f$
      create policy %1$s_read on %1$I for select to authenticated
        using (organization_id = (select app.current_org()) and (select app.can_read_payroll()))$f$, t);
  end loop;
end $$;

create policy timesheets_own on timesheets for select to authenticated
  using (organization_id = (select app.current_org())
         and staff_member_id = (select app.current_staff_member_id()));
create policy timesheets_own_insert on timesheets for insert to authenticated
  with check (organization_id = (select app.current_org())
              and staff_member_id = (select app.current_staff_member_id()));
create policy timesheets_own_update on timesheets for update to authenticated
  using (organization_id = (select app.current_org())
         and staff_member_id = (select app.current_staff_member_id()))
  with check (organization_id = (select app.current_org())
              and staff_member_id = (select app.current_staff_member_id()));
create policy payroll_lines_own on payroll_lines for select to authenticated
  using (organization_id = (select app.current_org())
         and staff_member_id = (select app.current_staff_member_id())
         and (select app.payroll_run_approved(run_id)));
create policy payroll_adjustments_own on payroll_adjustments for select to authenticated
  using (organization_id = (select app.current_org())
         and staff_member_id = (select app.current_staff_member_id())
         and (select app.payroll_period_locked(organization_id, period)));
create policy sick_leave_entries_own on sick_leave_entries for select to authenticated
  using (organization_id = (select app.current_org())
         and staff_member_id = (select app.current_staff_member_id()));

-- Substitutes and applicants: owner/admin (and the worker) manage. An instructor sees the offers made to them and the
-- requests behind them, and answers their own offer (guard_substitute_offer limits what the answer may touch).
do $$
declare t text;
begin
  foreach t in array array['substitute_requests', 'substitute_offers', 'applicants'] loop
    execute format($f$
      create policy %1$s_write on %1$I for all to authenticated, rswim_system
        using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
        with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))$f$, t);
  end loop;
end $$;

create or replace function app.my_substitute_request_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select request_id from substitute_offers
  where organization_id = app.current_org()
    and staff_member_id = app.current_staff_member_id()
    and status <> 'queued'
$$;

create policy substitute_offers_own on substitute_offers for select to authenticated
  using (organization_id = (select app.current_org())
         and staff_member_id = (select app.current_staff_member_id())
         and status <> 'queued');
create policy substitute_offers_answer on substitute_offers for update to authenticated
  using (organization_id = (select app.current_org())
         and staff_member_id = (select app.current_staff_member_id())
         and status = 'offered')
  with check (organization_id = (select app.current_org())
              and staff_member_id = (select app.current_staff_member_id()));
create policy substitute_requests_offered on substitute_requests for select to authenticated
  using (organization_id = (select app.current_org())
         and id in (select app.my_substitute_request_ids()));
