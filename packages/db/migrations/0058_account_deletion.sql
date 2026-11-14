-- Deleting your own account from inside the app (store launch, stage 8: Apple 5.1.1(v), Google Play's account
-- deletion policy). The sign-in goes, and with it every membership and platform role. What a school keeps about the
-- family (the family's file, lessons, payments and receipts) stays with the school, unlinked from any sign-in: it is
-- the school's record, and the ledger is append-only. Open and declined join requests are the person's own and go.

-- Whether the caller is the only active owner of an active school anywhere in this database: such a school would be
-- left with nobody to run it, so the owner hands it over (or closes it) first.
create or replace function public.my_sole_owned_schools()
returns table (organization_id uuid, organization_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id, o.name
  from organizations o
  where o.status = 'active'
    and exists (
      select 1 from memberships m
      where m.organization_id = o.id and m.user_id = app.current_user_id() and m.role = 'owner' and m.status = 'active'
      union all
      select 1 from directory_memberships d
      where d.organization_id = o.id and d.user_id = app.current_user_id() and d.role = 'owner' and d.status = 'active')
    and not exists (
      select 1 from memberships m
      where m.organization_id = o.id and m.user_id <> app.current_user_id() and m.role = 'owner' and m.status = 'active'
      union all
      select 1 from directory_memberships d
      where d.organization_id = o.id and d.user_id <> app.current_user_id() and d.role = 'owner' and d.status = 'active')
  order by o.name
$$;
--> statement-breakpoint
revoke execute on function public.my_sole_owned_schools() from public, anon;
--> statement-breakpoint
grant execute on function public.my_sole_owned_schools() to authenticated;
--> statement-breakpoint

-- Deletes the caller's sign-in in this database (memberships, directory rows and platform roles cascade with it).
-- The web app runs it on each school's own database first and on the platform's last.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := app.current_user_id();
begin
  if uid is null then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  if exists (select 1 from public.my_sole_owned_schools()) then
    raise exception 'account.errors.soleOwner' using errcode = 'RSW01';
  end if;
  delete from join_requests where user_id = uid and status in ('new', 'declined', 'withdrawn');
  delete from auth.users where id = uid;
end $$;
--> statement-breakpoint
revoke execute on function public.delete_my_account() from public, anon;
--> statement-breakpoint
grant execute on function public.delete_my_account() to authenticated;
