-- A school's own database (docs/TENANT-DATABASES.md). The platform's database (the "control plane") keeps sign-in,
-- the list of schools, plans, subscriptions and the platform console. A school with a dedicated database keeps
-- everything else in its own Supabase project, which runs these same migrations.
--
-- Control plane only: tenant_databases (sealed connection strings), directory_memberships (who belongs to a school
-- whose real memberships live in its own database), platform_settings (the switch for new schools). The worker and
-- the server reach them with the connection's owner role; signed-in users only through the functions below.

-- ─── Triggers ───────────────────────────────────────────────────────────────
create trigger set_updated_at before update on tenant_databases
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on directory_memberships
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on platform_settings
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on tenant_databases
  for each row execute function app.audit_row();
--> statement-breakpoint

-- ─── Grants and row level security ──────────────────────────────────────────
select app.apply_standard_grants();
revoke select on staff_invites from authenticated;
grant select (id, organization_id, role, email, phone_e164, staff_member_id, expires_at, accepted_at,
              accepted_by, revoked_at, created_by, created_at) on staff_invites to authenticated;
revoke all on tenant_databases, directory_memberships, platform_settings from anon, authenticated, rswim_system;
grant execute on all functions in schema app to authenticated, rswim_system;
revoke execute on function app.apply_standard_grants() from public, authenticated, rswim_system;
alter table tenant_databases enable row level security;
alter table directory_memberships enable row level security;
alter table platform_settings enable row level security;

alter table directory_memberships
  add constraint directory_memberships_user_fk foreign key (user_id) references auth.users (id) on delete cascade;
--> statement-breakpoint

-- ─── Helpers ────────────────────────────────────────────────────────────────
-- True inside a school's own database (its bootstrap writes the marker).
create or replace function app.is_tenant_database() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from platform_settings where key = 'database_role' and value = 'tenant')
$$;

-- In the control plane a member of a school with its own database has only a directory row; it stands in for the
-- membership there (enough to read the school's name and branding). Real memberships always win.
create or replace function app.current_membership() returns memberships
language sql stable security definer set search_path = public, pg_temp as $$
  select x.id, x.organization_id, x.user_id, x.role, x.permissions, x.staff_member_id, x.guardian_id, x.status,
         x.created_at
  from (
    select m.id, m.organization_id, m.user_id, m.role, m.permissions, m.staff_member_id, m.guardian_id, m.status,
           m.created_at, 0 as pick
    from memberships m
    where m.user_id = app.current_user_id()
      and m.organization_id = nullif(app.claims() ->> 'org_id', '')::uuid
      and m.status = 'active'
    union all
    select null::uuid, d.organization_id, d.user_id, d.role, d.permissions, null::uuid, null::uuid, d.status,
           d.created_at, 1
    from directory_memberships d
    where d.user_id = app.current_user_id()
      and d.organization_id = nullif(app.claims() ->> 'org_id', '')::uuid
      and d.status = 'active'
  ) x
  order by x.pick
  limit 1
$$;
--> statement-breakpoint

-- ─── Sign-in reads the directory too ────────────────────────────────────────
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

  select x.organization_id, x.role, x.permissions into m
  from (
    select mm.organization_id, mm.role, mm.permissions, mm.created_at
    from memberships mm where mm.user_id = uid and mm.status = 'active'
    union all
    select d.organization_id, d.role, d.permissions, d.created_at
    from directory_memberships d where d.user_id = uid and d.status = 'active'
  ) x
  order by (x.organization_id = preferred) desc nulls last, x.created_at
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

create or replace function public.my_memberships()
returns table (organization_id uuid, organization_name text, role text)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct on (o.id) o.id, o.name, x.role
  from (
    select m.organization_id, m.role, 0 as pick from memberships m
    where m.user_id = app.current_user_id() and m.status = 'active'
    union all
    select d.organization_id, d.role, 1 from directory_memberships d
    where d.user_id = app.current_user_id() and d.status = 'active'
  ) x join organizations o on o.id = x.organization_id and o.status = 'active'
  order by o.id, x.pick
$$;
revoke execute on function public.my_memberships() from public, anon;
grant execute on function public.my_memberships() to authenticated;
--> statement-breakpoint

-- ─── Self-serve sign-up asks for the school's own database ──────────────────
create or replace function public.create_school(p_name text, p_slug text, p_plan text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := app.current_user_id();
  org uuid;
  pl plans;
  owned integer;
  db_mode text;
begin
  if uid is null then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  if app.is_tenant_database() then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 or length(trim(p_name)) > 80 then
    raise exception 'platform.errors.schoolName' using errcode = 'RSW01';
  end if;
  if p_slug !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' then
    raise exception 'platform.errors.slug' using errcode = 'RSW01';
  end if;
  select * into pl from plans where code = p_plan and active;
  if not found then raise exception 'platform.errors.plan' using errcode = 'RSW01'; end if;
  select count(distinct organization_id) into owned from (
    select organization_id from memberships where user_id = uid and role = 'owner'
    union all
    select organization_id from directory_memberships where user_id = uid and role = 'owner'
  ) o;
  if owned >= 3 then raise exception 'platform.errors.tooManySchools' using errcode = 'RSW01'; end if;
  if exists (select 1 from organizations where slug = p_slug) then
    raise exception 'platform.errors.slugTaken' using errcode = 'RSW01';
  end if;

  insert into organizations (slug, name) values (p_slug, trim(p_name)) returning id into org;
  insert into org_settings (organization_id, branding)
    values (org, jsonb_build_object('displayName', trim(p_name)));
  insert into memberships (organization_id, user_id, role) values (org, uid, 'owner');
  insert into org_subscriptions (organization_id, plan_code, status, trial_ends_on)
    values (org, pl.code, 'trialing', (now() at time zone 'Asia/Jerusalem')::date + pl.trial_days);
  -- The worker gives the school its encryption key.
  insert into outbox (organization_id, event_type, payload, idempotency_key)
    values (org, 'platform.school_created', jsonb_build_object('planCode', pl.code, 'ownerId', uid),
            format('platform.school_created:%s', org));

  -- New schools get their own database when the platform says so; the worker creates it.
  select value into db_mode from platform_settings where key = 'new_school_database';
  if db_mode = 'dedicated' then
    insert into tenant_databases (organization_id, provider)
      values (org, coalesce((select value from platform_settings where key = 'tenant_database_provider'), 'supabase'));
    insert into outbox (organization_id, event_type, payload, idempotency_key)
      values (org, 'platform.database_requested', jsonb_build_object('ownerId', uid),
              format('platform.database_requested:%s:1', org));
  end if;

  -- So the next Supabase token is issued for the new school.
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('active_org_id', org)
  where id = uid;
  return org;
end $$;
revoke execute on function public.create_school(text, text, text) from public, anon;
grant execute on function public.create_school(text, text, text) to authenticated;
--> statement-breakpoint

-- ─── What a signed-in member may know about the school's database ──────────
-- 'shared', or the dedicated database's status (the "getting your system ready" screen polls it).
create or replace function public.my_school_database() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select jsonb_build_object('mode', 'dedicated', 'status', t.status)
     from tenant_databases t where t.organization_id = app.current_org()),
    jsonb_build_object('mode', 'shared', 'status', 'ready'))
$$;
revoke execute on function public.my_school_database() from public, anon;
grant execute on function public.my_school_database() to authenticated;

-- ─── Platform console ───────────────────────────────────────────────────────
create or replace function public.platform_school_databases()
returns table (
  organization_id uuid, name text, slug text, provider text, status text, project_ref text, region text,
  attempts smallint, last_error text, ready_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not app.is_platform_admin() then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  return query
    select t.organization_id, o.name, o.slug, t.provider, t.status, t.project_ref, t.region, t.attempts,
           t.last_error, t.ready_at, t.created_at
    from tenant_databases t join organizations o on o.id = t.organization_id
    order by t.created_at desc;
end $$;
revoke execute on function public.platform_school_databases() from public, anon;
grant execute on function public.platform_school_databases() to authenticated;

create or replace function public.platform_database_settings() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.is_platform_admin() then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  return jsonb_build_object(
    'newSchoolDatabase', coalesce((select value from platform_settings where key = 'new_school_database'), 'shared'),
    'provider', coalesce((select value from platform_settings where key = 'tenant_database_provider'), 'supabase'));
end $$;
revoke execute on function public.platform_database_settings() from public, anon;
grant execute on function public.platform_database_settings() to authenticated;

create or replace function public.platform_set_new_school_database(p_mode text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_platform_admin() then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  if p_mode not in ('shared', 'dedicated') then raise exception 'common.errors.invalid' using errcode = 'RSW01'; end if;
  insert into platform_settings (key, value) values ('new_school_database', p_mode)
    on conflict (key) do update set value = excluded.value;
end $$;
revoke execute on function public.platform_set_new_school_database(text) from public, anon;
grant execute on function public.platform_set_new_school_database(text) to authenticated;

-- A failed database starts again from where it stopped (the worker skips the steps already done).
create or replace function public.platform_retry_school_database(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n smallint;
begin
  if not app.is_platform_admin() then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  update tenant_databases set status = case when project_ref is null then 'requested' else status end,
         last_error = null
  where organization_id = p_org and status <> 'ready'
  returning attempts into n;
  if not found then raise exception 'common.errors.notFound' using errcode = 'RSW01'; end if;
  insert into outbox (organization_id, event_type, payload, idempotency_key)
    values (p_org, 'platform.database_requested', jsonb_build_object('retry', true),
            format('platform.database_requested:%s:retry:%s', p_org, extract(epoch from clock_timestamp())));
end $$;
revoke execute on function public.platform_retry_school_database(uuid) from public, anon;
grant execute on function public.platform_retry_school_database(uuid) to authenticated;
--> statement-breakpoint

-- ─── Keeping the two databases in step ──────────────────────────────────────
-- Inside a school's own database: who belongs, its branding and its domains are reported up to the control plane
-- (sign-in and the white-label host lookup read them there). One event per table and transaction.
create or replace function app.report_tenant_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare org uuid := coalesce((to_jsonb(new) ->> 'organization_id')::uuid, (to_jsonb(old) ->> 'organization_id')::uuid);
begin
  if org is null or not app.is_tenant_database() then return null; end if;
  insert into outbox (organization_id, event_type, payload, idempotency_key)
    values (org, 'platform.tenant_changed', jsonb_build_object('table', tg_table_name),
            format('platform.tenant_changed:%s:%s', tg_table_name, txid_current()))
    on conflict (organization_id, idempotency_key) do nothing;
  return null;
end $$;

create trigger report_tenant_change after insert or update or delete on memberships
  for each row execute function app.report_tenant_change();
create trigger report_tenant_change after insert or update or delete on org_settings
  for each row execute function app.report_tenant_change();
create trigger report_tenant_change after insert or update or delete on org_domains
  for each row execute function app.report_tenant_change();

-- In the control plane: a school with its own database gets its name, status and subscription copied down
-- (plan limits and the owner's plan page read them there).
create or replace function app.report_platform_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare org uuid := coalesce((to_jsonb(new) ->> 'organization_id')::uuid, (to_jsonb(new) ->> 'id')::uuid);
begin
  if org is null or app.is_tenant_database() then return null; end if;
  if not exists (select 1 from tenant_databases t where t.organization_id = org and t.status = 'ready') then
    return null;
  end if;
  insert into outbox (organization_id, event_type, payload, idempotency_key)
    values (org, 'platform.org_changed', jsonb_build_object('table', tg_table_name),
            format('platform.org_changed:%s:%s', tg_table_name, txid_current()))
    on conflict (organization_id, idempotency_key) do nothing;
  return null;
end $$;

create trigger report_platform_change after update on organizations
  for each row execute function app.report_platform_change();
create trigger report_platform_change after insert or update on org_subscriptions
  for each row execute function app.report_platform_change();

grant execute on all functions in schema app to authenticated, rswim_system;
revoke execute on function app.apply_standard_grants() from public, authenticated, rswim_system;
