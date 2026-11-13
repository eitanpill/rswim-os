-- One app for everyone (store launch, stage 3): a person who belongs to several schools, or holds several roles,
-- picks which one they are working in. The choice is remembered on their sign-in row and read by the access-token
-- hook, so the next token carries that school. Runs on the platform database only (where sign-in lives).

-- Lists every school the caller belongs to, with the vertical, so the picker can show a swim school and a freediving
-- club apart. Same sources as my_memberships (memberships + the directory of schools with their own database).
create or replace function public.my_schools()
returns table (organization_id uuid, organization_name text, role text, vertical text, active boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct on (o.id) o.id, o.name, x.role, o.vertical,
         coalesce(o.id = nullif(app.claims() ->> 'org_id', '')::uuid, false)
  from (
    select m.organization_id, m.role, 0 as pick from memberships m
    where m.user_id = app.current_user_id() and m.status = 'active'
    union all
    select d.organization_id, d.role, 1 from directory_memberships d
    where d.user_id = app.current_user_id() and d.status = 'active'
  ) x join organizations o on o.id = x.organization_id and o.status = 'active'
  order by o.id, x.pick
$$;
--> statement-breakpoint
revoke execute on function public.my_schools() from public, anon;
--> statement-breakpoint
grant execute on function public.my_schools() to authenticated;
--> statement-breakpoint

-- Remembers the school the caller picked. Refused unless they hold an active membership there.
create or replace function public.switch_school(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := app.current_user_id();
begin
  if uid is null or app.is_tenant_database() then
    raise exception 'common.errors.forbidden' using errcode = 'RSW01';
  end if;
  if not exists (select 1 from public.my_schools() s where s.organization_id = p_org) then
    raise exception 'common.errors.forbidden' using errcode = 'RSW01';
  end if;
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('active_org_id', p_org)
  where id = uid;
end $$;
--> statement-breakpoint
revoke execute on function public.switch_school(uuid) from public, anon;
--> statement-breakpoint
grant execute on function public.switch_school(uuid) to authenticated;
