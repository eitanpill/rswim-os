-- Phase 10 security layer: plans, subscriptions, platform invoices, custom domains and the template marketplace.

-- ─── Triggers ───────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['org_subscriptions', 'platform_invoices', 'templates'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['org_subscriptions', 'platform_invoices', 'org_domains', 'template_installs'] loop
    execute format('create trigger audit_row after insert or update or delete on %I for each row execute function app.audit_row()', t);
  end loop;
end $$;
--> statement-breakpoint

-- ─── Helpers ────────────────────────────────────────────────────────────────
create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from platform_admins p where p.user_id = app.current_user_id())
$$;

-- Plan limits (docs/POLICIES.md §18). A school without a subscription has none. Counted at insert time: two
-- simultaneous inserts at the limit may both pass, which is accepted (DECISIONS).
create or replace function app.enforce_plan_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  what text := tg_argv[0];
  lim integer;
  used integer;
begin
  if what = 'staff' and to_jsonb(new) ->> 'status' <> 'active' then return new; end if;
  if what = 'venues' and to_jsonb(new) ->> 'status' = 'closed' then return new; end if;
  select case what when 'students' then p.max_students when 'staff' then p.max_staff else p.max_venues end
    into lim
  from org_subscriptions s join plans p on p.code = s.plan_code
  where s.organization_id = new.organization_id;
  if lim is null then return new; end if;
  if what = 'students' then
    select count(*) into used from students where organization_id = new.organization_id;
  elsif what = 'staff' then
    select count(*) into used from staff_members where organization_id = new.organization_id and status = 'active';
  else
    select count(*) into used from venues where organization_id = new.organization_id and status <> 'closed';
  end if;
  if used >= lim then
    raise exception 'platform.errors.limit.%', what using errcode = 'RSW01';
  end if;
  return new;
end $$;

create trigger plan_limit before insert on students
  for each row execute function app.enforce_plan_limit('students');
create trigger plan_limit before insert on staff_members
  for each row execute function app.enforce_plan_limit('staff');
create trigger plan_limit before insert on venues
  for each row execute function app.enforce_plan_limit('venues');
--> statement-breakpoint

-- ─── Self-serve sign-up ─────────────────────────────────────────────────────
-- A signed-in user with an account but no school creates one: the organization, its settings, the caller as owner
-- and a trial on the chosen plan. The defaults inside the school are added afterwards by the ordinary services,
-- running as the new owner.
create or replace function public.create_school(p_name text, p_slug text, p_plan text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := app.current_user_id();
  org uuid;
  pl plans;
  owned integer;
begin
  if uid is null then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 or length(trim(p_name)) > 80 then
    raise exception 'platform.errors.schoolName' using errcode = 'RSW01';
  end if;
  if p_slug !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' then
    raise exception 'platform.errors.slug' using errcode = 'RSW01';
  end if;
  select * into pl from plans where code = p_plan and active;
  if not found then raise exception 'platform.errors.plan' using errcode = 'RSW01'; end if;
  select count(*) into owned from memberships where user_id = uid and role = 'owner';
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
  -- So the next Supabase token is issued for the new school.
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('active_org_id', org)
  where id = uid;
  return org;
end $$;
revoke execute on function public.create_school(text, text, text) from public, anon;
grant execute on function public.create_school(text, text, text) to authenticated;

-- ─── Branding ───────────────────────────────────────────────────────────────
-- Any member sees their school's name and colours (org_settings itself is the office's).
create or replace function public.my_branding() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select s.branding || jsonb_build_object('name', o.name)
  from org_settings s join organizations o on o.id = s.organization_id
  where s.organization_id = app.current_org()
$$;
revoke execute on function public.my_branding() from public, anon;
grant execute on function public.my_branding() to authenticated;

-- Before sign-in: only a verified domain's school name and colour, nothing else.
create or replace function public.branding_for_host(p_host text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('name', o.name, 'slug', o.slug)
         || (s.branding - array(select k from jsonb_object_keys(s.branding) k where k not in ('displayName', 'hue')))
  from org_domains d
  join organizations o on o.id = d.organization_id and o.status = 'active'
  join org_settings s on s.organization_id = o.id
  where d.host = lower(p_host) and d.status = 'verified'
$$;
revoke execute on function public.branding_for_host(text) from public;
grant execute on function public.branding_for_host(text) to anon, authenticated;

-- ─── Platform console ───────────────────────────────────────────────────────
-- Every school with its plan, status and usage, for platform admins only.
create or replace function public.platform_schools()
returns table (
  organization_id uuid, name text, slug text, org_status text, created_at timestamptz,
  plan_code text, status text, trial_ends_on date, past_due_since date, mandate_id text,
  students bigint, staff bigint, venues bigint, last_period date, last_status text, last_amount integer
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not app.is_platform_admin() then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  return query
  select o.id, o.name, o.slug, o.status, o.created_at,
         s.plan_code, s.status, s.trial_ends_on, s.past_due_since, s.mandate_id,
         (select count(*) from students x where x.organization_id = o.id),
         (select count(*) from staff_members x where x.organization_id = o.id and x.status = 'active'),
         (select count(*) from venues x where x.organization_id = o.id and x.status <> 'closed'),
         i.period, i.status, i.amount_agorot
  from organizations o
  left join org_subscriptions s on s.organization_id = o.id
  left join lateral (
    select period, status, amount_agorot from platform_invoices p
    where p.organization_id = o.id order by period desc limit 1
  ) i on true
  order by o.created_at;
end $$;
revoke execute on function public.platform_schools() from public, anon;
grant execute on function public.platform_schools() to authenticated;

-- Asks the worker to bill every school due for a month (active or past due). Each request is a new event; the
-- worker issues at most one invoice per school and month and never charges a paid one again.
create or replace function public.platform_request_billing(p_period date) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if not app.is_platform_admin() then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  if p_period <> date_trunc('month', p_period)::date then
    raise exception 'platform.errors.period' using errcode = 'RSW01';
  end if;
  insert into outbox (organization_id, event_type, payload, idempotency_key)
  select s.organization_id, 'platform.billing_due',
         jsonb_build_object('period', p_period, 'requestedBy', app.current_user_id()),
         format('platform.billing_due:%s:%s:%s', s.organization_id, p_period,
                (extract(epoch from clock_timestamp()) * 1000)::bigint)
  from org_subscriptions s
  where s.status in ('active', 'past_due')
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.platform_request_billing(date) from public, anon;
grant execute on function public.platform_request_billing(date) to authenticated;
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
-- Plans: everyone signed in reads them; only platform admins change them.
create policy plans_read on plans for select to authenticated, rswim_system using (true);
create policy plans_platform on plans for all to authenticated
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));

-- A school's subscription: every member reads it (features hide surfaces); platform admins and the worker change it.
create policy org_subscriptions_read on org_subscriptions for select to authenticated, rswim_system
  using (organization_id = (select app.current_org()) or (select app.is_platform_admin()));
create policy org_subscriptions_platform on org_subscriptions for update to authenticated
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));
create policy org_subscriptions_worker on org_subscriptions for update to rswim_system
  using (organization_id = (select app.current_org()))
  with check (organization_id = (select app.current_org()));

-- The platform's invoices to a school: its office reads them; the worker issues and settles them.
create policy platform_invoices_read on platform_invoices for select to authenticated
  using ((organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
         or (select app.is_platform_admin()));
create policy platform_invoices_worker on platform_invoices for all to rswim_system
  using (organization_id = (select app.current_org()))
  with check (organization_id = (select app.current_org()));

-- Domains: the office adds and removes them (always pending); the worker verifies.
create policy org_domains_office_read on org_domains for select to authenticated
  using ((organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
         or (select app.is_platform_admin()));
create policy org_domains_office_add on org_domains for insert to authenticated
  with check (organization_id = (select app.current_org()) and (select app.is_owner())
              and status = 'pending' and verified_at is null and checked_at is null);
create policy org_domains_office_remove on org_domains for delete to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_owner()));
create policy org_domains_worker on org_domains for all to rswim_system
  using (organization_id = (select app.current_org()))
  with check (organization_id = (select app.current_org()));

-- Templates: published ones are for everyone; a school's owner sees and submits its own; platform admins review.
create policy templates_read on templates for select to authenticated
  using (status = 'published'
         or (source_organization_id = (select app.current_org()) and (select app.is_owner()))
         or (select app.is_platform_admin()));
create policy templates_submit on templates for insert to authenticated
  with check (source_organization_id = (select app.current_org()) and (select app.is_owner())
              and status = 'submitted' and reviewed_by is null and reviewed_at is null
              and created_by = (select app.current_user_id()));
create policy templates_platform on templates for all to authenticated
  using ((select app.is_platform_admin())) with check ((select app.is_platform_admin()));

create policy template_installs_office on template_installs for all to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
