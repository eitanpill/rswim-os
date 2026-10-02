-- Security layer: RLS, helper functions, triggers, sensitive-column privileges and the Supabase access-token hook.
-- See docs/adr/0005-multi-tenancy-and-rls.md. Every new tenant table must get policies here or in a later migration.

-- ─── Roles ──────────────────────────────────────────────────────────────────
-- rswim_system: used by the worker and server-side jobs acting for ONE org (withOrg()).
-- It does NOT bypass RLS; the org comes from the transaction-local setting app.org_id.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'rswim_system') then
    create role rswim_system nologin;
  end if;
  execute format('grant rswim_system to %I', current_user);
  execute format('grant authenticated to %I', current_user);
end $$;
--> statement-breakpoint

-- ─── FKs that drizzle cannot express (auth schema, composite with SET NULL) ───
alter table memberships
  add constraint memberships_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  add constraint memberships_staff_fk foreign key (organization_id, staff_member_id)
    references staff_members (organization_id, id) on delete set null (staff_member_id),
  add constraint memberships_guardian_fk foreign key (organization_id, guardian_id)
    references guardians (organization_id, id) on delete cascade;
alter table platform_admins
  add constraint platform_admins_user_fk foreign key (user_id) references auth.users (id) on delete cascade;
create index memberships_user on memberships (user_id);
--> statement-breakpoint

-- ─── Helper functions ───────────────────────────────────────────────────────
create schema if not exists app;
grant usage on schema app to authenticated, rswim_system;

create or replace function app.claims() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function app.is_system() returns boolean
language sql stable as $$
  select current_user = 'rswim_system'
$$;

create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(app.claims() ->> 'sub', '')::uuid
$$;

-- Note: only functions that must read past RLS are SECURITY DEFINER. Anything that calls app.is_system()
-- must stay SECURITY INVOKER, because inside a definer function current_user is the function owner.

-- The caller's ACTIVE membership in the org named by the JWT. Read live from the table, so a revoked
-- membership loses access immediately even while its JWT is still valid.
create or replace function app.current_membership() returns memberships
language sql stable security definer set search_path = public, pg_temp as $$
  select m.* from memberships m
  where m.user_id = app.current_user_id()
    and m.organization_id = nullif(app.claims() ->> 'org_id', '')::uuid
    and m.status = 'active'
$$;

create or replace function app.current_org() returns uuid
language sql stable as $$
  select case
    when app.is_system() then nullif(current_setting('app.org_id', true), '')::uuid
    else (app.current_membership()).organization_id
  end
$$;

create or replace function app.current_app_role() returns text
language sql stable as $$
  select case when app.is_system() then 'system' else (app.current_membership()).role end
$$;

create or replace function app.has_permission(p text) returns boolean
language sql stable as $$
  select app.is_system()
      or coalesce((app.current_membership()).role = 'owner', false)
      or coalesce(p = any ((app.current_membership()).permissions), false)
$$;

create or replace function app.is_owner() returns boolean
language sql stable as $$ select coalesce(app.current_app_role() in ('owner', 'system'), false) $$;

create or replace function app.is_owner_or_admin() returns boolean
language sql stable as $$ select coalesce(app.current_app_role() in ('owner', 'admin', 'system'), false) $$;

create or replace function app.is_staff() returns boolean
language sql stable as $$
  select coalesce(app.current_app_role() in ('owner', 'admin', 'instructor', 'escort', 'accountant', 'system'), false)
$$;

create or replace function app.current_staff_member_id() returns uuid
language sql stable as $$
  select (app.current_membership()).staff_member_id
$$;

create or replace function app.guardian_household_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select g.household_id
  from guardians g
  where g.id = (app.current_membership()).guardian_id
    and g.organization_id = app.current_org()
    and (app.current_membership()).role = 'parent'
$$;

-- Students an instructor may see. Phase 0 stub: no sessions exist yet, so the set is empty.
-- Phase 2 replaces the body with: students enrolled in sessions the instructor staffs, today −7d … today +14d.
create or replace function app.instructor_student_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id from students s where false
$$;

grant execute on all functions in schema app to authenticated, rswim_system;
--> statement-breakpoint

-- ─── Triggers ───────────────────────────────────────────────────────────────
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;

-- Audits a row change without ever copying ciphertext (enc_* columns become "[encrypted]").
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_j jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  new_j jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  diff jsonb := '{}'::jsonb;
  k text;
  row_j jsonb := case when tg_op = 'DELETE' then old_j else new_j end;
begin
  for k in select jsonb_object_keys(old_j || new_j) loop
    continue when k in ('updated_at', 'created_at');
    continue when (old_j -> k) is not distinct from (new_j -> k);
    diff := diff || jsonb_build_object(k, case
      when k like 'enc\_%' then '"[encrypted]"'::jsonb
      when tg_op = 'UPDATE' then jsonb_build_object('old', old_j -> k, 'new', new_j -> k)
      else coalesce(new_j -> k, old_j -> k)
    end);
  end loop;
  if tg_op = 'UPDATE' and diff = '{}'::jsonb then
    return null;
  end if;
  insert into audit_log (organization_id, actor_id, action, subject_type, subject_id, diff)
  values (
    coalesce((row_j ->> 'organization_id')::uuid, (row_j ->> 'id')::uuid),
    app.current_user_id(),
    lower(tg_op),
    tg_table_name,
    coalesce(row_j ->> 'id', row_j ->> 'key'),
    diff
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['organizations', 'org_settings', 'households', 'guardians', 'students', 'staff_members', 'feature_flags'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['organizations', 'org_settings', 'memberships', 'households', 'guardians', 'students', 'staff_members', 'feature_flags'] loop
    execute format('create trigger audit_row after insert or update or delete on %I for each row execute function app.audit_row()', t);
  end loop;
end $$;

create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function app.forbid_mutation();
--> statement-breakpoint

-- ─── Privileges ─────────────────────────────────────────────────────────────
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated, rswim_system;
grant select, insert, update, delete on all tables in schema public to authenticated, rswim_system;
grant usage on all sequences in schema public to authenticated, rswim_system;

-- Infrastructure tables: no direct access for signed-in users. Only the worker's service connection touches them.
revoke all on org_keys, inbox_receipts, webhook_events, dead_letters, platform_admins from authenticated;
revoke all on org_keys from rswim_system;
grant select on platform_admins to authenticated;
-- audit_log: triggers write row changes; app code may INSERT entries for its own org and actor only (policy below).
revoke update, delete on audit_log from authenticated, rswim_system;

-- Sensitive columns (enc_*): signed-in users can write ciphertext but never select it directly.
-- Their reads go through app.read_sensitive(), which checks permission and writes an audit record.
-- rswim_system (worker) keeps column access and audits through recordSensitiveRead() in @rswim/domain-core.
do $$
declare r record; cols text;
begin
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
end $$;

create or replace function app.read_sensitive(p_table text, p_column text, p_id uuid) returns bytea
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v bytea;
  allowed constant text[] := array[
    'students.enc_medical_notes', 'students.enc_national_id',
    'staff_members.enc_national_id', 'staff_members.enc_bank_details'
  ];
begin
  if not (p_table || '.' || p_column = any (allowed)) then
    raise exception 'not a sensitive column: %.%', p_table, p_column using errcode = 'invalid_parameter_value';
  end if;
  if not app.has_permission('sensitive.read') then
    raise exception 'permission denied: sensitive.read' using errcode = 'insufficient_privilege';
  end if;
  execute format('select %I from %I where id = $1 and organization_id = $2', p_column, p_table)
    into v using p_id, app.current_org();
  insert into audit_log (organization_id, actor_id, action, subject_type, subject_id, diff)
  values (app.current_org(), app.current_user_id(), 'sensitive_read', p_table, p_id::text,
          jsonb_build_object('column', p_column, 'found', v is not null));
  return v;
end $$;
grant execute on function app.read_sensitive(text, text, uuid) to authenticated;
--> statement-breakpoint

-- ─── Row level security ─────────────────────────────────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- organizations
create policy org_select on organizations for select to authenticated, rswim_system
  using (id = (select app.current_org()));
create policy org_update on organizations for update to authenticated, rswim_system
  using (id = (select app.current_org()) and (select app.has_permission('settings.write')));

-- org_settings
create policy org_settings_select on org_settings for select to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy org_settings_update on org_settings for update to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.has_permission('settings.write')));

-- memberships: owners manage; everyone sees their own; admins see the roster
create policy memberships_select on memberships for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin()) or user_id = (select app.current_user_id())));
create policy memberships_write on memberships for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner()));

-- platform_admins: you can see only whether you are one
create policy platform_admins_self on platform_admins for select to authenticated
  using (user_id = (select app.current_user_id()));

-- feature_flags: any member reads, owner writes
create policy feature_flags_select on feature_flags for select to authenticated, rswim_system
  using (organization_id = (select app.current_org()));
create policy feature_flags_write on feature_flags for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner()));

-- files: staff only for now (parent uploads arrive with Phase 7 and get their own policy)
create policy files_staff on files for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_staff()))
  with check (organization_id = (select app.current_org()) and (select app.is_staff()));

-- households / guardians / students
create policy households_select on households for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin())
              or (select app.current_app_role()) = 'accountant'
              or id in (select app.guardian_household_ids())));
create policy households_write on households for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));

create policy guardians_select on guardians for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin())
              or (select app.current_app_role()) = 'accountant'
              or household_id in (select app.guardian_household_ids())));
create policy guardians_write on guardians for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));

create policy students_select on students for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin())
              or household_id in (select app.guardian_household_ids())
              or id in (select app.instructor_student_ids())));
create policy students_write on students for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));

-- staff_members: owner/admin and accountant see the roster; staff see themselves
create policy staff_select on staff_members for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin())
              or (select app.current_app_role()) = 'accountant'
              or id = (select app.current_staff_member_id())));
create policy staff_write on staff_members for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));

-- audit_log: read with audit.read; append entries only as yourself, for your own org
create policy audit_select on audit_log for select to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.has_permission('audit.read')));
create policy audit_insert on audit_log for insert to authenticated, rswim_system
  with check (organization_id = (select app.current_org())
              and actor_id is not distinct from (select app.current_user_id()));

-- inbox_receipts: the worker (system role) records which events each consumer handled, per org
create policy inbox_system on inbox_receipts for all to rswim_system
  using (organization_id = (select app.current_org()))
  with check (organization_id = (select app.current_org()));

-- outbox: any member may enqueue for their own org (e.g. a parent reporting an absence); nobody reads it but the relay
create policy outbox_insert on outbox for insert to authenticated, rswim_system
  with check (organization_id = (select app.current_org()));
--> statement-breakpoint

-- ─── Org switcher ───────────────────────────────────────────────────────────
-- Lists the caller's active memberships across ALL orgs (RLS on memberships only shows the current org).
create or replace function public.my_memberships()
returns table (organization_id uuid, organization_name text, role text)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.organization_id, o.name, m.role
  from memberships m join organizations o on o.id = m.organization_id
  where m.user_id = app.current_user_id() and m.status = 'active' and o.status = 'active'
  order by o.name
$$;
revoke execute on function public.my_memberships() from public, anon;
grant execute on function public.my_memberships() to authenticated;
--> statement-breakpoint

-- ─── Supabase custom access-token hook ──────────────────────────────────────
-- Enable in Supabase: Authentication → Hooks → Custom Access Token → public.custom_access_token_hook
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  uid uuid := (event ->> 'user_id')::uuid;
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  preferred uuid;
  m record;
begin
  select nullif(u.raw_app_meta_data ->> 'active_org_id', '')::uuid into preferred
  from auth.users u where u.id = uid;

  select mm.organization_id, mm.role, mm.permissions into m
  from memberships mm
  where mm.user_id = uid and mm.status = 'active'
  order by (mm.organization_id = preferred) desc nulls last, mm.created_at
  limit 1;

  if found then
    claims := claims || jsonb_build_object('org_id', m.organization_id, 'app_role', m.role, 'permissions', to_jsonb(m.permissions));
  else
    claims := claims || jsonb_build_object('org_id', null, 'app_role', null, 'permissions', '[]'::jsonb);
  end if;
  claims := claims || jsonb_build_object('is_platform_admin', exists (select 1 from platform_admins p where p.user_id = uid));
  return jsonb_set(event, '{claims}', claims);
end $$;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
