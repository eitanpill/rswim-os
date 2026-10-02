-- Phase 1 security layer: grants, RLS policies, triggers and FKs for the core data tables.
-- Every later migration that adds tables ends with `select app.apply_standard_grants();`.

-- ─── FKs drizzle cannot express (composite with SET NULL on one column) ─────
alter table students
  add constraint students_level_fk foreign key (organization_id, level_id)
    references levels (organization_id, id) on delete set null (level_id),
  add constraint students_preferred_staff_fk foreign key (organization_id, preferred_staff_id)
    references staff_members (organization_id, id) on delete set null (preferred_staff_id);
alter table staff_invites
  add constraint staff_invites_staff_fk foreign key (organization_id, staff_member_id)
    references staff_members (organization_id, id) on delete set null (staff_member_id);
alter table certifications
  add constraint certifications_file_fk foreign key (organization_id, file_id)
    references files (organization_id, id) on delete set null (file_id);
--> statement-breakpoint

-- ─── Standard grants, reusable by later migrations ──────────────────────────
-- Table privileges for app roles, RLS on, and enc_* columns hidden from `authenticated` (ADR-0005).
-- Tables listed in app.infrastructure_tables() stay out of reach of signed-in users.
create or replace function app.infrastructure_tables() returns text[]
language sql immutable as $$
  select array['org_keys', 'inbox_receipts', 'webhook_events', 'dead_letters', 'platform_admins']
$$;

create or replace function app.apply_standard_grants() returns void
language plpgsql as $$
declare r record; cols text;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', r.tablename);
    if not (r.tablename = any (app.infrastructure_tables())) then
      execute format('grant select, insert, update, delete on %I to authenticated, rswim_system', r.tablename);
    end if;
  end loop;
  for r in
    select distinct c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name like 'enc\_%'
  loop
    select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = r.table_name and column_name not like 'enc\_%';
    execute format('revoke select on %I from authenticated', r.table_name);
    execute format('grant select (%s) on %I to authenticated', cols, r.table_name);
  end loop;
  grant usage on all sequences in schema public to authenticated, rswim_system;
end $$;
--> statement-breakpoint

-- ─── Triggers ───────────────────────────────────────────────────────────────
create or replace function app.today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Jerusalem')::date $$;

-- A policy set already in effect is history: only its end date may be set, and not into the past.
create or replace function app.guard_policy_set() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.effective_from <= app.today() then
      raise exception 'policy set % is in effect and cannot be deleted', old.id using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if old.effective_from <= app.today() then
    if (to_jsonb(new) - 'effective_to') is distinct from (to_jsonb(old) - 'effective_to')
       or (new.effective_to is not null and new.effective_to < app.today()) then
      raise exception 'policy set % is in effect: create a new version instead', old.id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger guard_policy_set before update or delete on policy_sets
  for each row execute function app.guard_policy_set();

-- A published price list in effect is history too. Drafts and future lists stay editable.
create or replace function app.price_list_locked(p_status text, p_from date) returns boolean
language sql stable as $$ select p_status <> 'draft' and p_from <= app.today() $$;

create or replace function app.guard_price_list() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if app.price_list_locked(old.status, old.effective_from) then
      raise exception 'price list % is in effect and cannot be deleted', old.id using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if app.price_list_locked(old.status, old.effective_from) then
    if (to_jsonb(new) - array['effective_to', 'status', 'updated_at'])
         is distinct from (to_jsonb(old) - array['effective_to', 'status', 'updated_at'])
       or new.status not in ('published', 'archived')
       or (new.effective_to is distinct from old.effective_to
           and new.effective_to is not null and new.effective_to < app.today()) then
      raise exception 'price list % is in effect: create a new version instead', old.id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger guard_price_list before update or delete on price_lists
  for each row execute function app.guard_price_list();

create or replace function app.guard_price_item() returns trigger
language plpgsql as $$
declare l record;
begin
  select status, effective_from into l from price_lists
  where id = case when tg_op = 'DELETE' then old.price_list_id else new.price_list_id end;
  if found and app.price_list_locked(l.status, l.effective_from) then
    raise exception 'price list is in effect: create a new version instead' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.price_list_id <> old.price_list_id then
    raise exception 'price items cannot move between lists' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger guard_price_item before insert or update or delete on price_items
  for each row execute function app.guard_price_item();

do $$
declare t text;
begin
  foreach t in array array['venues', 'venue_contracts', 'pools', 'venue_operating_windows', 'venue_closures',
                           'programs', 'levels', 'price_lists', 'certifications', 'availability_rules'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['venues', 'venue_contracts', 'pools', 'lanes', 'venue_operating_windows', 'venue_closures',
                           'programs', 'levels', 'policy_sets', 'price_lists', 'price_items', 'certifications',
                           'availability_rules', 'availability_exceptions', 'pay_rules', 'staff_invites',
                           'student_relations'] loop
    execute format('create trigger audit_row after insert or update or delete on %I for each row execute function app.audit_row()', t);
  end loop;
end $$;
--> statement-breakpoint

-- ─── Grants ─────────────────────────────────────────────────────────────────
select app.apply_standard_grants();
-- Invite tokens are matched by hash inside app.accept_invite(); nobody reads the hash column.
revoke select on staff_invites from authenticated;
grant select (id, organization_id, role, email, phone_e164, staff_member_id, expires_at, accepted_at,
              accepted_by, revoked_at, created_by, created_at) on staff_invites to authenticated;
--> statement-breakpoint

-- ─── Row level security ─────────────────────────────────────────────────────
-- Venue data and the catalog: every staff member reads (instructors need addresses and lanes), owner/admin write.
do $$
declare t text;
begin
  foreach t in array array['venues', 'pools', 'lanes', 'venue_operating_windows', 'operating_window_lanes',
                           'venue_closures', 'programs', 'levels'] loop
    execute format($f$
      create policy %1$s_select on %1$I for select to authenticated, rswim_system
        using (organization_id = (select app.current_org()) and (select app.is_staff()))$f$, t);
    execute format($f$
      create policy %1$s_write on %1$I for all to authenticated, rswim_system
        using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
        with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))$f$, t);
  end loop;
end $$;

-- Venue contracts are money: owner/admin and the accountant read; owner/admin write.
create policy venue_contracts_select on venue_contracts for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin()) or (select app.current_app_role()) = 'accountant'));
create policy venue_contracts_write on venue_contracts for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));

-- Policies and prices: owner/admin and accountant read; writing needs settings.write (owners hold it implicitly).
do $$
declare t text;
begin
  foreach t in array array['policy_sets', 'price_lists', 'price_items'] loop
    execute format($f$
      create policy %1$s_select on %1$I for select to authenticated, rswim_system
        using (organization_id = (select app.current_org())
               and ((select app.is_owner_or_admin()) or (select app.current_app_role()) = 'accountant'))$f$, t);
    execute format($f$
      create policy %1$s_write on %1$I for all to authenticated, rswim_system
        using (organization_id = (select app.current_org()) and (select app.has_permission('settings.write')))
        with check (organization_id = (select app.current_org()) and (select app.has_permission('settings.write')))$f$, t);
  end loop;
end $$;

-- Certifications: owner/admin manage; a staff member sees their own.
create policy certifications_select on certifications for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin()) or staff_member_id = (select app.current_staff_member_id())));
create policy certifications_write on certifications for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));

-- Availability: owner/admin manage everyone's; staff manage their own (instructor PWA).
do $$
declare t text;
begin
  foreach t in array array['availability_rules', 'availability_exceptions'] loop
    execute format($f$
      create policy %1$s_rw on %1$I for all to authenticated, rswim_system
        using (organization_id = (select app.current_org())
               and ((select app.is_owner_or_admin()) or staff_member_id = (select app.current_staff_member_id())))
        with check (organization_id = (select app.current_org())
               and ((select app.is_owner_or_admin()) or staff_member_id = (select app.current_staff_member_id())))$f$, t);
  end loop;
end $$;

-- Pay rules: payroll.read / payroll.write (owners implicitly; the accountant via granted permission or role);
-- staff see their own rates.
create policy pay_rules_select on pay_rules for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.has_permission('payroll.read'))
              or (select app.current_app_role()) = 'accountant'
              or staff_member_id = (select app.current_staff_member_id())));
create policy pay_rules_write on pay_rules for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.has_permission('payroll.write')))
  with check (organization_id = (select app.current_org()) and (select app.has_permission('payroll.write')));

-- Staff invites: owners only, like memberships.
create policy staff_invites_owner on staff_invites for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner()));

-- Student relations follow students; a parent sees a relation only when both children are in their household.
create policy student_relations_select on student_relations for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin())
              or (student_id in (select s.id from students s where s.household_id in (select app.guardian_household_ids()))
                  and related_student_id in (select s.id from students s
                                             where s.household_id in (select app.guardian_household_ids())))));
create policy student_relations_write on student_relations for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));

-- Import runs: owner/admin.
create policy import_runs_rw on import_runs for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
--> statement-breakpoint

-- ─── Staff invite acceptance ────────────────────────────────────────────────
-- Called by a signed-in user who has no membership in the org yet, so it must read past RLS.
-- The token is a bearer secret, and when the invite names an email or phone the user's must match.
create or replace function public.accept_staff_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := app.current_user_id();
  inv staff_invites;
  u record;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  select * into inv from staff_invites
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  for update;
  if not found or inv.revoked_at is not null or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'invite is not valid' using errcode = 'invalid_parameter_value';
  end if;
  select email, phone into u from auth.users where id = uid;
  if not ((inv.email is not null and lower(inv.email) = lower(u.email))
          or (inv.phone_e164 is not null and inv.phone_e164 = '+' || ltrim(u.phone, '+'))) then
    raise exception 'invite was sent to someone else' using errcode = 'insufficient_privilege';
  end if;
  insert into memberships (organization_id, user_id, role, staff_member_id)
  values (inv.organization_id, uid, inv.role, inv.staff_member_id);
  update staff_invites set accepted_at = now(), accepted_by = uid where id = inv.id;
  return inv.organization_id;
end $$;
revoke execute on function public.accept_staff_invite(text) from public, anon;
grant execute on function public.accept_staff_invite(text) to authenticated;
grant execute on all functions in schema app to authenticated, rswim_system;
revoke execute on function app.apply_standard_grants() from public, authenticated, rswim_system;
