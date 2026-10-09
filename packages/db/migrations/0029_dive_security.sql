-- Freediving club security layer: FKs drizzle cannot express, guards and bookkeeping triggers, the platform's
-- network view, grants and RLS for every dive_* table.

-- ─── FKs with SET NULL on one column of a composite key ─────────────────────
alter table dive_sessions
  add constraint dive_sessions_lead_fk foreign key (organization_id, lead_staff_id)
    references staff_members (organization_id, id) on delete set null (lead_staff_id),
  add constraint dive_sessions_assist_fk foreign key (organization_id, assist_staff_id)
    references staff_members (organization_id, id) on delete set null (assist_staff_id);
alter table dive_bookings
  add constraint dive_bookings_buddy_fk foreign key (organization_id, buddy_diver_id)
    references dive_divers (organization_id, id) on delete set null (buddy_diver_id),
  add constraint dive_bookings_pass_fk foreign key (organization_id, pass_id)
    references dive_passes (organization_id, id) on delete set null (pass_id),
  add constraint dive_bookings_rules_fk foreign key (organization_id, rule_set_id)
    references dive_rule_sets (organization_id, id) on delete set null (rule_set_id);
alter table dive_logs
  add constraint dive_logs_session_fk foreign key (organization_id, session_id)
    references dive_sessions (organization_id, id) on delete set null (session_id);
alter table dive_incidents
  add constraint dive_incidents_session_fk foreign key (organization_id, session_id)
    references dive_sessions (organization_id, id) on delete set null (session_id),
  add constraint dive_incidents_diver_fk foreign key (organization_id, diver_id)
    references dive_divers (organization_id, id) on delete set null (diver_id);
alter table dive_enrollments
  add constraint dive_enrollments_instructor_fk foreign key (organization_id, instructor_staff_id)
    references staff_members (organization_id, id) on delete set null (instructor_staff_id);
alter table dive_sales
  add constraint dive_sales_diver_fk foreign key (organization_id, diver_id)
    references dive_divers (organization_id, id) on delete set null (diver_id),
  add constraint dive_sales_program_fk foreign key (organization_id, program_id)
    references dive_programs (organization_id, id) on delete set null (program_id),
  add constraint dive_sales_session_fk foreign key (organization_id, session_id)
    references dive_sessions (organization_id, id) on delete set null (session_id);
alter table dive_conditions
  add constraint dive_conditions_site_fk foreign key (organization_id, site_id)
    references dive_sites (organization_id, id) on delete set null (site_id),
  add constraint dive_conditions_rules_fk foreign key (organization_id, rule_set_id)
    references dive_rule_sets (organization_id, id) on delete set null (rule_set_id);
alter table dive_leads
  add constraint dive_leads_program_fk foreign key (organization_id, interest_program_id)
    references dive_programs (organization_id, id) on delete set null (interest_program_id);
--> statement-breakpoint

-- ─── Helpers ────────────────────────────────────────────────────────────────
-- The diver record(s) of the signed-in customer: the ones linked to their own guardian row.
create or replace function app.dive_my_diver_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id from dive_divers d
  where d.organization_id = app.current_org()
    and d.guardian_id = (app.current_membership()).guardian_id
    and (app.current_membership()).role = 'parent'
$$;

create or replace function app.is_instructor() returns boolean
language sql stable as $$ select coalesce(app.current_app_role() = 'instructor', false) $$;

create or replace function app.is_customer() returns boolean
language sql stable as $$ select coalesce(app.current_app_role() = 'parent', false) $$;
--> statement-breakpoint

-- ─── Triggers ───────────────────────────────────────────────────────────────
-- A customer may sign the waiver and update their own medical date, phone and emergency contact; nothing else.
create or replace function app.guard_dive_diver() returns trigger
language plpgsql as $$
declare keep dive_divers;
begin
  if current_user = 'authenticated' and app.is_customer() then
    keep := old;
    keep.waiver_signed_on := new.waiver_signed_on;
    keep.medical_expires_on := new.medical_expires_on;
    keep.emergency_name := new.emergency_name;
    keep.emergency_phone := new.emergency_phone;
    keep.phone_e164 := new.phone_e164;
    keep.email := new.email;
    keep.updated_at := now();
    return keep;
  end if;
  return new;
end $$;

-- A session never takes more divers than its capacity. A customer books for themself, online, as "booked".
create or replace function app.guard_dive_booking() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare taken integer; cap integer;
begin
  if tg_op = 'INSERT' or (new.status in ('booked', 'checked_in') and old.status not in ('booked', 'checked_in')) then
    select capacity into cap from dive_sessions where id = new.session_id;
    select count(*) into taken from dive_bookings
      where session_id = new.session_id and status in ('booked', 'checked_in') and id <> new.id;
    if new.status in ('booked', 'checked_in') and taken >= cap then
      raise exception 'dive.errors.sessionFull' using errcode = 'RSW01';
    end if;
  end if;
  if coalesce(app.current_app_role() = 'parent', false) then
    if tg_op = 'INSERT' then
      new.status := 'booked';
      new.booked_via := 'online';
      new.checked_in_at := null;
      new.line_label := null;
      new.buddy_diver_id := null;
      new.created_by := app.current_user_id();
    else
      -- A customer can only cancel their own booking.
      if not (old.status = 'booked' and new.status = 'cancelled') then
        raise exception 'dive.errors.customerCannotChange' using errcode = 'RSW01';
      end if;
      new := old;
      new.status := 'cancelled';
      new.updated_at := now();
    end if;
  end if;
  return new;
end $$;

-- Who logged a dive and when is stamped by the database for instructors.
create or replace function app.guard_dive_log() returns trigger
language plpgsql as $$
begin
  if current_user = 'authenticated' and not app.is_owner_or_admin() then
    new.recorded_by := app.current_user_id();
    new.recorded_at := now();
  end if;
  return new;
end $$;

-- A clean dive deeper (or longer) than the diver's best becomes their new personal best.
create or replace function app.dive_personal_best() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.outcome not in ('clean', 'early_turn') then return new; end if;
  if new.discipline in ('CWT', 'CWTB') and new.depth_m is not null then
    update dive_divers set pb_cwt_m = new.depth_m where id = new.diver_id and coalesce(pb_cwt_m, 0) < new.depth_m;
  elsif new.discipline = 'FIM' and new.depth_m is not null then
    update dive_divers set pb_fim_m = new.depth_m where id = new.diver_id and coalesce(pb_fim_m, 0) < new.depth_m;
  elsif new.discipline = 'STA' and new.duration_sec is not null then
    update dive_divers set pb_sta_sec = new.duration_sec
    where id = new.diver_id and coalesce(pb_sta_sec, 0) < new.duration_sec;
  elsif new.discipline in ('DYN', 'DYNB') and new.distance_m is not null then
    update dive_divers set pb_dyn_m = new.distance_m where id = new.diver_id and coalesce(pb_dyn_m, 0) < new.distance_m;
  end if;
  return new;
end $$;

-- Rental gear follows its rentals: out when rented, back on the shelf when returned.
create or replace function app.dive_rental_gear() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.returned_at is null then
    if exists (select 1 from dive_gear where id = new.gear_id and status <> 'available') then
      raise exception 'dive.errors.gearNotAvailable' using errcode = 'RSW01';
    end if;
    update dive_gear set status = 'rented' where id = new.gear_id;
  elsif tg_op = 'UPDATE' and new.returned_at is not null and old.returned_at is null then
    update dive_gear set status = 'available' where id = new.gear_id and status = 'rented';
  end if;
  return new;
end $$;

create trigger guard_dive_diver before update on dive_divers
  for each row execute function app.guard_dive_diver();
create trigger guard_dive_booking before insert or update on dive_bookings
  for each row execute function app.guard_dive_booking();
create trigger guard_dive_log before insert on dive_logs
  for each row execute function app.guard_dive_log();
create trigger dive_personal_best after insert on dive_logs
  for each row execute function app.dive_personal_best();
create trigger dive_rental_gear after insert or update on dive_rentals
  for each row execute function app.dive_rental_gear();
-- Money in is append-only: a correction is a new (negative) sale.
create trigger dive_sales_append_only before update or delete on dive_sales
  for each row execute function app.forbid_mutation_unless_org_deleted();

do $$
declare t text;
begin
  foreach t in array array['dive_sites', 'dive_programs', 'dive_divers', 'dive_sessions', 'dive_passes',
                           'dive_bookings', 'dive_incidents', 'dive_enrollments', 'dive_gear', 'dive_rentals',
                           'dive_leads', 'dive_staff_certs'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['dive_rule_sets', 'dive_sites', 'dive_programs', 'dive_divers', 'dive_sessions',
                           'dive_passes', 'dive_bookings', 'dive_logs', 'dive_incidents', 'dive_enrollments',
                           'dive_gear', 'dive_rentals', 'dive_sales', 'dive_conditions', 'dive_leads',
                           'dive_staff_certs'] loop
    execute format('create trigger audit_row after insert or update or delete on %I for each row execute function app.audit_row()', t);
  end loop;
end $$;
--> statement-breakpoint

-- ─── The platform's network view ────────────────────────────────────────────
-- One row per school or club, with the numbers the platform admin compares across verticals.
create or replace function public.platform_network()
returns table (
  organization_id uuid, name text, slug text, vertical text, org_status text, plan_code text, status text,
  customers bigint, staff bigint, sessions_30d bigint, revenue_30d bigint, incidents_90d bigint,
  next_7d bigint, created_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not app.is_platform_admin() then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  return query
  select o.id, o.name, o.slug, o.vertical, o.status, s.plan_code, s.status,
         case when o.vertical = 'freediving'
              then (select count(*) from dive_divers x where x.organization_id = o.id)
              else (select count(*) from students x where x.organization_id = o.id) end,
         (select count(*) from staff_members x where x.organization_id = o.id and x.status = 'active'),
         case when o.vertical = 'freediving'
              then (select count(*) from dive_sessions x where x.organization_id = o.id
                      and x.starts_at between now() - interval '30 days' and now() and x.status <> 'cancelled')
              else (select count(*) from sessions x where x.organization_id = o.id
                      and x.date between current_date - 30 and current_date) end,
         case when o.vertical = 'freediving'
              then (select coalesce(sum(amount_agorot), 0) from dive_sales x where x.organization_id = o.id
                      and x.sold_at > now() - interval '30 days')
              else (select coalesce(sum(amount_agorot), 0) from payments x where x.organization_id = o.id
                      and x.status = 'succeeded' and x.paid_on > current_date - 30) end,
         (select count(*) from dive_incidents x where x.organization_id = o.id
            and x.occurred_at > now() - interval '90 days'),
         case when o.vertical = 'freediving'
              then (select count(*) from dive_bookings b join dive_sessions x on x.id = b.session_id
                      where b.organization_id = o.id and b.status in ('booked', 'checked_in')
                        and x.starts_at between now() and now() + interval '7 days')
              else (select count(*) from sessions x where x.organization_id = o.id
                      and x.date between current_date and current_date + 7) end,
         o.created_at
  from organizations o
  left join org_subscriptions s on s.organization_id = o.id
  order by o.created_at;
end $$;
revoke execute on function public.platform_network() from public, anon;
grant execute on function public.platform_network() to authenticated;
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
-- The office (owner, admins: the manager and the front desk) and the tenant's worker run the whole club.
do $$
declare t text;
begin
  foreach t in array array['dive_rule_sets', 'dive_sites', 'dive_programs', 'dive_divers', 'dive_sessions',
                           'dive_passes', 'dive_bookings', 'dive_logs', 'dive_incidents', 'dive_enrollments',
                           'dive_gear', 'dive_rentals', 'dive_sales', 'dive_conditions', 'dive_leads',
                           'dive_staff_certs'] loop
    execute format($p$create policy %1$s_office on %1$I for all to authenticated, rswim_system
      using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
      with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))$p$, t);
  end loop;
end $$;

-- Instructors work the water: they read the club's sessions, divers and gear (safety needs the whole picture),
-- log dives, report incidents, post the sea call, check divers in and tick course skills. Money and leads stay
-- with the office.
do $$
declare t text;
begin
  foreach t in array array['dive_rule_sets', 'dive_sites', 'dive_programs', 'dive_divers', 'dive_sessions',
                           'dive_bookings', 'dive_logs', 'dive_incidents', 'dive_enrollments', 'dive_gear',
                           'dive_rentals', 'dive_conditions', 'dive_passes'] loop
    execute format($p$create policy %1$s_instructor_read on %1$I for select to authenticated
      using (organization_id = (select app.current_org()) and (select app.is_instructor()))$p$, t);
  end loop;
end $$;
create policy dive_logs_instructor_write on dive_logs for insert to authenticated
  with check (organization_id = (select app.current_org()) and (select app.is_instructor()));
create policy dive_incidents_instructor_write on dive_incidents for insert to authenticated
  with check (organization_id = (select app.current_org()) and (select app.is_instructor()));
create policy dive_conditions_instructor_write on dive_conditions for insert to authenticated
  with check (organization_id = (select app.current_org()) and (select app.is_instructor()));
create policy dive_bookings_instructor_update on dive_bookings for update to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_instructor()))
  with check (organization_id = (select app.current_org()) and (select app.is_instructor()));
create policy dive_enrollments_instructor_update on dive_enrollments for update to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_instructor()))
  with check (organization_id = (select app.current_org()) and (select app.is_instructor()));
create policy dive_staff_certs_own on dive_staff_certs for select to authenticated
  using (organization_id = (select app.current_org())
         and staff_member_id = (select app.current_staff_member_id()));

-- Customers see the club's public side (sites, programs, the schedule, the sea) and only their own records.
do $$
declare t text;
begin
  foreach t in array array['dive_sites', 'dive_programs', 'dive_conditions', 'dive_rule_sets'] loop
    execute format($p$create policy %1$s_customer_read on %1$I for select to authenticated
      using (organization_id = (select app.current_org()) and (select app.is_customer()))$p$, t);
  end loop;
  foreach t in array array['dive_passes', 'dive_logs', 'dive_enrollments', 'dive_rentals', 'dive_sales'] loop
    execute format($p$create policy %1$s_customer_own on %1$I for select to authenticated
      using (organization_id = (select app.current_org()) and diver_id in (select app.dive_my_diver_ids()))$p$, t);
  end loop;
end $$;
create policy dive_sessions_customer_read on dive_sessions for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_customer()) and status <> 'cancelled');
create policy dive_divers_customer_own on dive_divers for select to authenticated
  using (organization_id = (select app.current_org()) and id in (select app.dive_my_diver_ids()));
create policy dive_divers_customer_update on dive_divers for update to authenticated
  using (organization_id = (select app.current_org()) and id in (select app.dive_my_diver_ids()))
  with check (organization_id = (select app.current_org()) and id in (select app.dive_my_diver_ids()));
create policy dive_bookings_customer_own on dive_bookings for select to authenticated
  using (organization_id = (select app.current_org()) and diver_id in (select app.dive_my_diver_ids()));
create policy dive_bookings_customer_book on dive_bookings for insert to authenticated
  with check (organization_id = (select app.current_org()) and diver_id in (select app.dive_my_diver_ids()));
create policy dive_bookings_customer_cancel on dive_bookings for update to authenticated
  using (organization_id = (select app.current_org()) and diver_id in (select app.dive_my_diver_ids()))
  with check (organization_id = (select app.current_org()) and diver_id in (select app.dive_my_diver_ids()));
