-- Phase 8 security layer for after-school transport: who sees routes and runs, what an escort may record, and the
-- trigger that keeps a run's status in step with its events.

-- ─── Helpers ────────────────────────────────────────────────────────────────
-- Routes the signed-in escort works: their own routes, and any route with a run they escort.
create or replace function app.escort_route_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id from transport_routes r
  where r.organization_id = app.current_org() and r.escort_staff_id = app.current_staff_member_id()
  union
  select x.route_id from route_runs x
  where x.organization_id = app.current_org() and x.escort_staff_id = app.current_staff_member_id()
$$;

-- Runs the signed-in escort works: escorted by them, or on their route with no one else named.
create or replace function app.escort_run_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select x.id from route_runs x join transport_routes r on r.id = x.route_id
  where x.organization_id = app.current_org()
    and coalesce(x.escort_staff_id, r.escort_staff_id) = app.current_staff_member_id()
$$;

-- Children on the signed-in escort's routes now (for their first names and the drop-off list).
create or replace function app.escort_student_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select rr.student_id from route_riders rr
  where rr.organization_id = app.current_org()
    and rr.route_id in (select app.escort_route_ids())
    and (rr.ends_on is null or rr.ends_on > app.today() - 1)
$$;

-- Routes the signed-in parent's children ride.
create or replace function app.family_route_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select rr.route_id from route_riders rr
  where rr.organization_id = app.current_org() and rr.student_id in (select app.guardian_student_ids())
$$;

create or replace function app.family_run_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select x.id from route_runs x
  where x.organization_id = app.current_org() and x.route_id in (select app.family_route_ids())
$$;
--> statement-breakpoint

-- ─── Triggers ───────────────────────────────────────────────────────────────
-- An escort records what happens as it happens: the database stamps who and when, so a stage cannot be backdated.
create or replace function app.guard_run_event() returns trigger
language plpgsql as $$
begin
  if current_user = 'authenticated' and not app.is_owner_or_admin() then
    new.recorded_by := auth.uid();
    new.at := now();
  end if;
  return new;
end $$;

-- A run is underway once it left the school and done once the escort closes it.
create or replace function app.advance_run() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.student_id is null then
    update route_runs set status = case when new.kind = 'run_done' then 'done' else 'underway' end
    where id = new.run_id and status in ('planned', 'underway');
  end if;
  return new;
end $$;

create trigger guard_run_event before insert on run_events
  for each row execute function app.guard_run_event();
create trigger advance_run after insert on run_events
  for each row execute function app.advance_run();
create trigger forbid_update before update on run_events
  for each row execute function app.forbid_mutation();
create trigger audit_row after insert or update or delete on run_events
  for each row execute function app.audit_row();

do $$
declare t text;
begin
  foreach t in array array['schools', 'transport_routes', 'route_riders', 'route_runs'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
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
-- The office (owner, admin) and the tenant's worker manage transport. An escort reads their routes, riders and runs,
-- opens today's run of their own route, and records its stages and children. A family follows the runs their
-- children ride. Nobody else (instructors, the accountant) sees transport.
create policy schools_office on schools for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy schools_read on schools for select to authenticated
  using (organization_id = (select app.current_org())
         and ((select app.current_app_role()) = 'escort'
              or id in (select r.school_id from transport_routes r where r.id in (select app.family_route_ids()))));

create policy transport_routes_office on transport_routes for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy transport_routes_read on transport_routes for select to authenticated
  using (organization_id = (select app.current_org())
         and (id in (select app.escort_route_ids()) or id in (select app.family_route_ids())));

create policy route_riders_office on route_riders for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy route_riders_read on route_riders for select to authenticated
  using (organization_id = (select app.current_org())
         and (route_id in (select app.escort_route_ids())
              or student_id in (select app.guardian_student_ids())));

create policy route_runs_office on route_runs for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
-- Row-based (not through app.escort_run_ids()), so the escort's insert can return the run it just opened.
create policy route_runs_read on route_runs for select to authenticated
  using (organization_id = (select app.current_org())
         and (escort_staff_id = (select app.current_staff_member_id())
              or (escort_staff_id is null
                  and route_id in (select r.id from transport_routes r
                                   where r.escort_staff_id = (select app.current_staff_member_id())))
              or route_id in (select app.family_route_ids())));
create policy route_runs_escort_open on route_runs for insert to authenticated
  with check (organization_id = (select app.current_org())
              and (select app.current_app_role()) = 'escort'
              and date = (select app.today()) and status = 'planned'
              and escort_staff_id = (select app.current_staff_member_id())
              and route_id in (select r.id from transport_routes r
                               where r.escort_staff_id = (select app.current_staff_member_id())));

create policy run_events_office_read on run_events for select to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy run_events_office_insert on run_events for insert to authenticated, rswim_system
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy run_events_office_delete on run_events for delete to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy run_events_read on run_events for select to authenticated
  using (organization_id = (select app.current_org())
         and (run_id in (select app.escort_run_ids())
              or (run_id in (select app.family_run_ids())
                  and (student_id is null or student_id in (select app.guardian_student_ids())))));
create policy run_events_escort_insert on run_events for insert to authenticated
  with check (organization_id = (select app.current_org())
              and (select app.current_app_role()) = 'escort'
              and run_id in (select app.escort_run_ids())
              and run_id in (select x.id from route_runs x
                             where x.date = (select app.today()) and x.status <> 'cancelled')
              and (student_id is null
                   or student_id in (select rr.student_id from route_riders rr
                                     join route_runs x on x.route_id = rr.route_id
                                     where x.id = run_id)));

-- Escorts see the children on their routes (names only matter; medical notes stay encrypted).
drop policy students_select on students;
create policy students_select on students for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin())
              or household_id in (select app.guardian_household_ids())
              or id in (select app.instructor_student_ids())
              or id in (select app.escort_student_ids())));
