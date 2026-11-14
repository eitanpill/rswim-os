-- Finding a school (store launch, stage 4): the app's school search, a school's public page, join and trial
-- requests that land with the school's office, and "we found you": a person whose verified phone the office already
-- has on a family's file joins that family in one tap.

-- ─── Triggers, grants, row level security ──────────────────────────────────
create trigger set_updated_at before update on join_requests
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on join_requests
  for each row execute function app.audit_row();
--> statement-breakpoint
-- Granted by hand: the standard grants would reopen the control-plane tables 0052 closed.
grant select on join_requests to authenticated;
grant select, insert, update, delete on join_requests to rswim_system;
--> statement-breakpoint
-- The office reads its own school's requests. Nobody writes them directly: the functions below do, with their checks.
alter table join_requests enable row level security;
create policy join_requests_office on join_requests for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy join_requests_system on join_requests for all to rswim_system
  using (organization_id = (select app.current_org()))
  with check (organization_id = (select app.current_org()));
--> statement-breakpoint

-- ─── The school search and a school's public page ───────────────────────────
-- Works signed out. Only active schools that did not opt out of the search; `p_q` matches the name, the city or the
-- link name, `p_vertical` narrows to swim schools or freediving clubs.
create or replace function public.school_directory(p_q text default null, p_vertical text default null)
returns table (slug text, name text, vertical text, city text, about text)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.slug, coalesce(nullif(s.branding ->> 'displayName', ''), o.name), o.vertical, o.city, o.about
  from organizations o left join org_settings s on s.organization_id = o.id
  where o.status = 'active' and o.listed
    and (p_vertical is null or o.vertical = p_vertical)
    and (nullif(btrim(coalesce(p_q, '')), '') is null
         or position(lower(btrim(p_q)) in lower(coalesce(nullif(s.branding ->> 'displayName', ''), o.name))) > 0
         or position(lower(btrim(p_q)) in lower(coalesce(o.city, ''))) > 0
         or position(lower(btrim(p_q)) in o.slug) > 0)
  order by 2
  limit 60
$$;
--> statement-breakpoint
revoke execute on function public.school_directory(text, text) from public;
--> statement-breakpoint
grant execute on function public.school_directory(text, text) to anon, authenticated;
--> statement-breakpoint

-- What anyone may know about a school by its link, listed or not: its name, kind, city and a line about it.
create or replace function public.school_public(p_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', o.id,
    'name', coalesce(nullif(s.branding ->> 'displayName', ''), o.name),
    'vertical', o.vertical,
    'city', o.city,
    'about', o.about)
  from organizations o left join org_settings s on s.organization_id = o.id
  where o.slug = p_slug and o.status = 'active'
$$;
--> statement-breakpoint
revoke execute on function public.school_public(text) from public;
--> statement-breakpoint
grant execute on function public.school_public(text) to anon, authenticated;
--> statement-breakpoint

-- ─── Join and trial requests ────────────────────────────────────────────────
-- A signed-in person asks a swim school to take their family (or to book a trial). Asking again while the first
-- request is still open updates it. Freediving clubs take divers directly (dive_join_club).
create or replace function public.request_to_join(
  p_slug text, p_kind text, p_first text, p_last text, p_phone text, p_email text, p_children jsonb, p_note text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := app.current_user_id();
  org organizations;
  req uuid;
  kids jsonb := '[]'::jsonb;
  kid jsonb;
  kid_name text;
  kid_dob date;
  v_first text := btrim(coalesce(p_first, ''));
  v_last text := btrim(coalesce(p_last, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if uid is null then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  select * into org from organizations where slug = p_slug and status = 'active' and vertical = 'swim';
  if org.id is null then raise exception 'join.errors.notFound' using errcode = 'RSW01'; end if;
  if exists (select 1 from memberships m where m.organization_id = org.id and m.user_id = uid) then
    raise exception 'join.errors.alreadyMember' using errcode = 'RSW01';
  end if;
  if p_kind is null or p_kind not in ('join', 'trial') then
    raise exception 'forms.errors.invalid' using errcode = 'RSW01';
  end if;
  if length(v_first) not between 1 and 60 or length(v_last) not between 1 and 60 then
    raise exception 'join.errors.name' using errcode = 'RSW01';
  end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'join.errors.phone' using errcode = 'RSW01';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'forms.errors.invalid' using errcode = 'RSW01';
  end if;
  if p_children is not null and jsonb_typeof(p_children) <> 'array' then
    raise exception 'forms.errors.invalid' using errcode = 'RSW01';
  end if;
  if jsonb_array_length(coalesce(p_children, '[]'::jsonb)) > 4 then
    raise exception 'join.errors.tooManyChildren' using errcode = 'RSW01';
  end if;
  for kid in select * from jsonb_array_elements(coalesce(p_children, '[]'::jsonb)) loop
    kid_name := btrim(coalesce(kid ->> 'firstName', ''));
    if length(kid_name) not between 1 and 40 then
      raise exception 'join.errors.childName' using errcode = 'RSW01';
    end if;
    begin
      kid_dob := nullif(kid ->> 'dob', '')::date;
    exception when others then
      raise exception 'join.errors.childDob' using errcode = 'RSW01';
    end;
    if kid_dob is not null and (kid_dob > app.today() or kid_dob < date '1925-01-01') then
      raise exception 'join.errors.childDob' using errcode = 'RSW01';
    end if;
    kids := kids || jsonb_build_array(jsonb_build_object('firstName', kid_name, 'dob', kid_dob));
  end loop;

  update join_requests set kind = p_kind, first_name = v_first,
         last_name = v_last, phone_e164 = p_phone,
         email = nullif(btrim(coalesce(p_email, '')), ''), children = kids, note = v_note
  where organization_id = org.id and user_id = uid and status = 'new'
  returning id into req;
  if req is not null then return req; end if;

  insert into join_requests (organization_id, user_id, kind, first_name, last_name, phone_e164, email, children, note)
    values (org.id, uid, p_kind, v_first, v_last, p_phone,
            nullif(btrim(coalesce(p_email, '')), ''), kids, v_note)
    returning id into req;
  -- The office hears about it (and the CRM may pick it up later).
  insert into outbox (organization_id, event_type, payload, idempotency_key)
    values (org.id, 'school.join_requested', jsonb_build_object('requestId', req, 'kind', p_kind),
            format('school.join_requested:%s', req));
  return req;
end $$;
--> statement-breakpoint
revoke execute on function public.request_to_join(text, text, text, text, text, text, jsonb, text) from public, anon;
--> statement-breakpoint
grant execute on function public.request_to_join(text, text, text, text, text, text, jsonb, text) to authenticated;
--> statement-breakpoint

-- The person's own requests, in every school of this database, newest first.
create or replace function public.my_join_requests()
returns table (id uuid, organization_id uuid, organization_name text, kind text, status text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id, r.organization_id, coalesce(nullif(s.branding ->> 'displayName', ''), o.name), r.kind, r.status,
         r.created_at
  from join_requests r
  join organizations o on o.id = r.organization_id
  left join org_settings s on s.organization_id = o.id
  where r.user_id = app.current_user_id()
  order by r.created_at desc
$$;
--> statement-breakpoint
revoke execute on function public.my_join_requests() from public, anon;
--> statement-breakpoint
grant execute on function public.my_join_requests() to authenticated;
--> statement-breakpoint

-- The office checks a request it is about to decide: it must be its own school's, still open, and the caller the
-- owner or the office.
create or replace function app.open_join_request(p_id uuid) returns join_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare req join_requests;
begin
  select * into req from join_requests where id = p_id for update;
  if req.id is null or req.organization_id is distinct from app.current_org() or not app.is_owner_or_admin() then
    raise exception 'common.errors.forbidden' using errcode = 'RSW01';
  end if;
  if req.status <> 'new' then raise exception 'join.errors.handled' using errcode = 'RSW01'; end if;
  return req;
end $$;
--> statement-breakpoint

-- The office takes the family: when the school already has a family contact with this phone (and nobody signed in
-- holds it yet) the person joins that family; otherwise a new family is opened with the children the parent named.
-- The person gets the parent app at this school. Returns the family contact.
create or replace function public.accept_join_request(p_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  req join_requests := app.open_join_request(p_id);
  g guardians;
  hh uuid;
  kid jsonb;
begin
  if exists (select 1 from memberships m where m.organization_id = req.organization_id and m.user_id = req.user_id) then
    raise exception 'join.errors.alreadyMember' using errcode = 'RSW01';
  end if;
  select * into g from guardians x
  where x.organization_id = req.organization_id and x.phone_e164 = req.phone_e164
    and not exists (select 1 from memberships m where m.organization_id = x.organization_id and m.guardian_id = x.id)
  order by x.created_at limit 1;
  if g.id is null then
    insert into households (organization_id, display_name)
      values (req.organization_id, req.first_name || ' ' || req.last_name) returning id into hh;
    insert into guardians (organization_id, household_id, first_name, last_name, phone_e164, email, is_billing_contact)
      values (req.organization_id, hh, req.first_name, req.last_name, req.phone_e164, req.email, true)
      returning * into g;
  end if;
  for kid in select * from jsonb_array_elements(req.children) loop
    if not exists (select 1 from students s where s.organization_id = req.organization_id
                   and s.household_id = g.household_id and s.first_name = kid ->> 'firstName') then
      insert into students (organization_id, household_id, first_name, last_name, dob)
        values (req.organization_id, g.household_id, kid ->> 'firstName', req.last_name,
                nullif(kid ->> 'dob', '')::date);
    end if;
  end loop;
  insert into memberships (organization_id, user_id, role, guardian_id)
    values (req.organization_id, req.user_id, 'parent', g.id);
  update join_requests set status = 'accepted', guardian_id = g.id, handled_by = app.current_user_id(),
         handled_at = now()
  where id = req.id;
  -- Someone with no other school opens the app straight into this one.
  if not exists (select 1 from memberships m where m.user_id = req.user_id and m.organization_id <> req.organization_id
                 and m.status = 'active') then
    update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('active_org_id', req.organization_id)
    where id = req.user_id;
  end if;
  insert into outbox (organization_id, event_type, payload, idempotency_key)
    values (req.organization_id, 'school.join_accepted',
            jsonb_build_object('requestId', req.id, 'guardianId', g.id, 'userId', req.user_id),
            format('school.join_accepted:%s', req.id));
  return g.id;
end $$;
--> statement-breakpoint
revoke execute on function public.accept_join_request(uuid) from public, anon;
--> statement-breakpoint
grant execute on function public.accept_join_request(uuid) to authenticated;
--> statement-breakpoint

create or replace function public.decline_join_request(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare req join_requests := app.open_join_request(p_id);
begin
  update join_requests set status = 'declined', handled_by = app.current_user_id(), handled_at = now()
  where id = req.id;
end $$;
--> statement-breakpoint
revoke execute on function public.decline_join_request(uuid) from public, anon;
--> statement-breakpoint
grant execute on function public.decline_join_request(uuid) to authenticated;
--> statement-breakpoint

-- ─── "We found you" ─────────────────────────────────────────────────────────
-- The caller's sign-in phone (verified by its one-time code) as E.164, or null.
create or replace function app.my_phone() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select '+' || ltrim(u.phone, '+') from auth.users u
  where u.id = app.current_user_id() and nullif(u.phone, '') is not null
$$;
--> statement-breakpoint

-- The family contact a school has on file with the caller's phone, that nobody signed in holds yet, in a school the
-- caller is not part of.
create or replace function app.phone_match(p_org uuid) returns guardians
language sql stable security definer set search_path = public, pg_temp as $$
  select g.* from guardians g
  join organizations o on o.id = g.organization_id and o.status = 'active'
  where g.organization_id = p_org and g.phone_e164 = app.my_phone()
    and not exists (select 1 from memberships m where m.organization_id = g.organization_id
                    and (m.user_id = app.current_user_id() or m.guardian_id = g.id))
  order by g.created_at limit 1
$$;
--> statement-breakpoint

-- Every school that has the caller's phone on a family's file (and that they are not part of yet).
create or replace function public.my_phone_matches()
returns table (organization_id uuid, organization_name text, vertical text)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id, coalesce(nullif(s.branding ->> 'displayName', ''), o.name), o.vertical
  from organizations o left join org_settings s on s.organization_id = o.id
  where o.status = 'active' and app.my_phone() is not null
    and exists (select 1 from guardians g where g.organization_id = o.id and g.phone_e164 = app.my_phone())
    and (app.phone_match(o.id)).id is not null
  order by 2
$$;
--> statement-breakpoint
revoke execute on function public.my_phone_matches() from public, anon;
--> statement-breakpoint
grant execute on function public.my_phone_matches() to authenticated;
--> statement-breakpoint

-- "Yes, that's me": the caller joins the family the school has on file with their phone, as its parent (or, at a
-- freediving club, as the diver). Returns the school.
create or replace function public.claim_by_phone(p_org uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := app.current_user_id();
  g guardians;
begin
  if uid is null then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  g := app.phone_match(p_org);
  if g.id is null then raise exception 'join.errors.noMatch' using errcode = 'RSW01'; end if;
  insert into memberships (organization_id, user_id, role, guardian_id) values (p_org, uid, 'parent', g.id);
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('active_org_id', p_org)
  where id = uid;
  insert into outbox (organization_id, event_type, payload, idempotency_key)
    values (p_org, 'school.family_claimed', jsonb_build_object('guardianId', g.id, 'userId', uid),
            format('school.family_claimed:%s:%s', p_org, uid));
  return p_org;
end $$;
--> statement-breakpoint
revoke execute on function public.claim_by_phone(uuid) from public, anon;
--> statement-breakpoint
grant execute on function public.claim_by_phone(uuid) to authenticated;
--> statement-breakpoint
grant execute on all functions in schema app to authenticated, rswim_system;
--> statement-breakpoint
revoke execute on function app.apply_standard_grants() from public, authenticated, rswim_system;
