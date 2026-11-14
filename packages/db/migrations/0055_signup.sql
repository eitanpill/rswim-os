-- Self-serve sign-up (SaaS stage 2): the owner picks the kind of business when opening it, and visitors see the price
-- list before signing in. create_school: same checks and steps as 0052, plus the vertical ('swim' or 'freediving'),
-- which decides the screens the school's people get; old callers with three arguments still open a swim school.
drop function public.create_school(text, text, text);
--> statement-breakpoint
create function public.create_school(p_name text, p_slug text, p_plan text, p_vertical text default 'swim')
returns uuid
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
  if p_vertical is null or p_vertical not in ('swim', 'freediving') then
    raise exception 'platform.errors.vertical' using errcode = 'RSW01';
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

  insert into organizations (slug, name, vertical) values (p_slug, trim(p_name), p_vertical) returning id into org;
  insert into org_settings (organization_id, branding)
    values (org, jsonb_build_object('displayName', trim(p_name)));
  insert into memberships (organization_id, user_id, role) values (org, uid, 'owner');
  insert into org_subscriptions (organization_id, plan_code, status, trial_ends_on)
    values (org, pl.code, 'trialing', (now() at time zone 'Asia/Jerusalem')::date + pl.trial_days);
  -- The worker gives the school its encryption key.
  insert into outbox (organization_id, event_type, payload, idempotency_key)
    values (org, 'platform.school_created', jsonb_build_object('planCode', pl.code, 'ownerId', uid, 'vertical', p_vertical),
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
--> statement-breakpoint
revoke execute on function public.create_school(text, text, text, text) from public, anon;
--> statement-breakpoint
grant execute on function public.create_school(text, text, text, text) to authenticated;
--> statement-breakpoint

-- The public price list (landing page, before sign-in): active plans only, and only what a visitor may see.
create or replace function public.public_plans()
returns table (code text, name_he text, name_en text, price_agorot integer, max_students integer,
               max_staff integer, max_venues integer, features text[], trial_days smallint)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.code, p.name_he, p.name_en, p.price_agorot, p.max_students, p.max_staff, p.max_venues, p.features,
         p.trial_days
  from plans p where p.active order by p.sort_order, p.price_agorot
$$;
--> statement-breakpoint
revoke execute on function public.public_plans() from public;
--> statement-breakpoint
grant execute on function public.public_plans() to anon, authenticated;
