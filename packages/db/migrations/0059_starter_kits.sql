-- SaaS stage 4: a freediving club is held to its plan like a swim school. Its divers count as the plan's customers
-- (max_students) and its open dive sites as its places (max_venues). A business is one kind, so each count adds
-- both tables: the other one is always empty.

create or replace function app.enforce_plan_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  what text := tg_argv[0];
  lim integer;
  used integer;
begin
  if what = 'staff' and to_jsonb(new) ->> 'status' <> 'active' then return new; end if;
  if what = 'venues' and to_jsonb(new) ->> 'status' = 'closed' then return new; end if;
  if what = 'sites' and (to_jsonb(new) ->> 'active')::boolean is false then return new; end if;
  select case
           when what in ('students', 'divers') then p.max_students
           when what = 'staff' then p.max_staff
           else p.max_venues end
    into lim
  from org_subscriptions s join plans p on p.code = s.plan_code
  where s.organization_id = new.organization_id;
  if lim is null then return new; end if;
  if what in ('students', 'divers') then
    select (select count(*) from students where organization_id = new.organization_id)
         + (select count(*) from dive_divers where organization_id = new.organization_id)
      into used;
  elsif what = 'staff' then
    select count(*) into used from staff_members where organization_id = new.organization_id and status = 'active';
  else
    select (select count(*) from venues where organization_id = new.organization_id and status <> 'closed')
         + (select count(*) from dive_sites where organization_id = new.organization_id and active)
      into used;
  end if;
  if used >= lim then
    raise exception 'platform.errors.limit.%', what using errcode = 'RSW01';
  end if;
  return new;
end $$;

create trigger plan_limit before insert on dive_divers
  for each row execute function app.enforce_plan_limit('divers');
create trigger plan_limit before insert on dive_sites
  for each row execute function app.enforce_plan_limit('sites');
--> statement-breakpoint

-- The platform's list of schools counts a club's divers and sites the same way.
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
         (select count(*) from students x where x.organization_id = o.id)
           + (select count(*) from dive_divers x where x.organization_id = o.id),
         (select count(*) from staff_members x where x.organization_id = o.id and x.status = 'active'),
         (select count(*) from venues x where x.organization_id = o.id and x.status <> 'closed')
           + (select count(*) from dive_sites x where x.organization_id = o.id and x.active),
         i.period, i.status, i.amount_agorot
  from organizations o
  left join org_subscriptions s on s.organization_id = o.id
  left join lateral (
    select period, status, amount_agorot from platform_invoices p
    where p.organization_id = o.id order by period desc limit 1
  ) i on true
  order by o.created_at;
end $$;
