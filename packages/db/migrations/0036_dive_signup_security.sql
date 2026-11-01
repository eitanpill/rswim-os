-- Freediving self-registration: anyone with the club's join link signs up as a diver (a household, a guardian who is
-- the diver, a customer membership and the diver's file), then uploads their certification cards for the club to
-- verify. A verified card lifts the diver's level on their file.

-- ─── Helpers ────────────────────────────────────────────────────────────────
-- Whether the club takes sign-ups through its join link (rules.registration.self_signup, default on).
create or replace function app.dive_self_signup_open(org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select (r.rules -> 'registration' ->> 'self_signup')::boolean from dive_rule_sets r
    where r.organization_id = org and r.effective_from <= app.today()
    order by r.effective_from desc limit 1), true)
$$;
--> statement-breakpoint

-- ─── The join page ──────────────────────────────────────────────────────────
-- What a visitor may know about a club before signing in: its name and whether it takes sign-ups. Only active
-- freediving clubs answer.
create or replace function public.dive_club_public(p_slug text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', o.id,
    'name', coalesce(nullif(s.branding ->> 'displayName', ''), o.name),
    'open', app.dive_self_signup_open(o.id))
  from organizations o left join org_settings s on s.organization_id = o.id
  where o.slug = p_slug and o.vertical = 'freediving' and o.status = 'active'
$$;
revoke execute on function public.dive_club_public(text) from public;
grant execute on function public.dive_club_public(text) to anon, authenticated;
--> statement-breakpoint

-- A signed-in person joins a club as a diver (`p_beginner`: new to freediving, no card to upload). Joining twice
-- returns the same club (nothing new is created); someone who already works in the club cannot join it as a customer.
create or replace function public.dive_join_club(
  p_slug text, p_first text, p_last text, p_phone text, p_email text, p_dob date,
  p_emergency_name text, p_emergency_phone text, p_beginner boolean default false
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := app.current_user_id();
  org organizations;
  m memberships;
  hh uuid;
  g uuid;
  first_name text := btrim(coalesce(p_first, ''));
  last_name text := btrim(coalesce(p_last, ''));
begin
  if uid is null then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  select * into org from organizations where slug = p_slug and vertical = 'freediving' and status = 'active';
  if org.id is null then raise exception 'dive.errors.clubNotFound' using errcode = 'RSW01'; end if;

  select * into m from memberships where organization_id = org.id and user_id = uid;
  if m.id is not null then
    if m.role = 'parent' and exists (
      select 1 from dive_divers d where d.organization_id = org.id and d.guardian_id = m.guardian_id) then
      update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('active_org_id', org.id)
      where id = uid;
      return org.id;
    end if;
    raise exception 'dive.errors.alreadyMember' using errcode = 'RSW01';
  end if;

  if not app.dive_self_signup_open(org.id) then
    raise exception 'dive.errors.signupClosed' using errcode = 'RSW01';
  end if;
  if length(first_name) not between 1 and 60 or length(last_name) not between 1 and 60 then
    raise exception 'dive.errors.joinName' using errcode = 'RSW01';
  end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'dive.errors.joinPhone' using errcode = 'RSW01';
  end if;
  if p_emergency_phone is not null and p_emergency_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'dive.errors.joinPhone' using errcode = 'RSW01';
  end if;
  if p_dob is not null and (p_dob > app.today() - interval '10 years' or p_dob < date '1920-01-01') then
    raise exception 'dive.errors.joinDob' using errcode = 'RSW01';
  end if;

  insert into households (organization_id, display_name)
    values (org.id, first_name || ' ' || last_name) returning id into hh;
  insert into guardians (organization_id, household_id, first_name, last_name, relation, phone_e164, email,
                         is_billing_contact)
    values (org.id, hh, first_name, last_name, 'self', p_phone, nullif(btrim(coalesce(p_email, '')), ''), true)
    returning id into g;
  insert into memberships (organization_id, user_id, role, guardian_id) values (org.id, uid, 'parent', g);
  insert into dive_divers (organization_id, guardian_id, first_name, last_name, phone_e164, email, dob,
                           emergency_name, emergency_phone, source, tags)
    values (org.id, g, first_name, last_name, p_phone, nullif(btrim(coalesce(p_email, '')), ''), p_dob,
            nullif(btrim(coalesce(p_emergency_name, '')), ''), p_emergency_phone, 'join_link',
            case when coalesce(p_beginner, false) then '{self_signup,beginner}'::text[] else '{self_signup}'::text[] end);
  -- The office hears about the new diver (and the CRM may pick it up later).
  insert into outbox (organization_id, event_type, payload, idempotency_key)
    values (org.id, 'dive.diver_joined', jsonb_build_object('guardianId', g, 'userId', uid),
            format('dive.diver_joined:%s:%s', org.id, uid));
  -- So the next Supabase token is issued for the club.
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('active_org_id', org.id)
  where id = uid;
  return org.id;
end $$;
revoke execute on function public.dive_join_club(text, text, text, text, text, date, text, text, boolean) from public, anon;
grant execute on function public.dive_join_club(text, text, text, text, text, date, text, text, boolean) to authenticated;
--> statement-breakpoint

-- ─── Certification cards ────────────────────────────────────────────────────
-- Security invoker on purpose (as for form signatures): it tells the customer's session apart from the office's.
-- A customer's card always starts pending; the desk may record a card it saw as verified on the spot.
create or replace function app.dive_cert_fill() returns trigger
language plpgsql as $$
begin
  new.name := btrim(coalesce(new.name, ''));
  if length(new.name) not between 2 and 80 then
    raise exception 'dive.errors.certName' using errcode = 'RSW01';
  end if;
  new.number := nullif(btrim(coalesce(new.number, '')), '');
  if new.issued_on is not null and new.issued_on > app.today() then
    raise exception 'dive.errors.certIssued' using errcode = 'RSW01';
  end if;
  if current_user in ('authenticated', 'rswim_system') then
    new.submitted_by := app.current_user_id();
    new.created_at := now();
  end if;
  if app.is_customer() or new.status = 'pending' then
    new.status := 'pending';
    new.review_note := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
  elsif current_user in ('authenticated', 'rswim_system') then
    new.reviewed_by := app.current_user_id();
    new.reviewed_at := now();
  end if;
  return new;
end $$;

-- After upload, only the club's review of a pending card may change it: by the office, once. The office may correct
-- the level it saw on the card.
create or replace function app.guard_dive_cert() returns trigger
language plpgsql as $$
declare keep dive_certifications;
begin
  if tg_op = 'DELETE' then
    if app.org_deleted(old.organization_id) or app.is_owner_or_admin() then return old; end if;
    raise exception 'common.errors.forbidden' using errcode = 'RSW01';
  end if;
  if not app.is_owner_or_admin() then
    raise exception 'common.errors.forbidden' using errcode = 'RSW01';
  end if;
  if old.status <> 'pending' or new.status not in ('verified', 'rejected') then
    raise exception 'dive.errors.certNotPending' using errcode = 'RSW01';
  end if;
  keep := old;
  keep.status := new.status;
  keep.level := new.level;
  keep.review_note := nullif(btrim(coalesce(new.review_note, '')), '');
  keep.reviewed_by := app.current_user_id();
  keep.reviewed_at := now();
  keep.updated_at := now();
  return keep;
end $$;

-- A verified card at or above the diver's level becomes the level on their file (agency, name, number).
create or replace function app.dive_cert_apply() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'verified' then
    update dive_divers set
      cert_level = new.level,
      cert_agency = case when new.agency in ('molchanovs', 'aida', 'ssi', 'padi') then new.agency else cert_agency end,
      cert_name = new.name,
      cert_number = coalesce(new.number, cert_number)
    where id = new.diver_id and organization_id = new.organization_id and cert_level <= new.level;
  end if;
  return new;
end $$;

create trigger dive_cert_fill before insert on dive_certifications
  for each row execute function app.dive_cert_fill();
create trigger guard_dive_cert before update or delete on dive_certifications
  for each row execute function app.guard_dive_cert();
create trigger dive_cert_apply after insert or update on dive_certifications
  for each row execute function app.dive_cert_apply();
create trigger set_updated_at before update on dive_certifications
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on dive_certifications
  for each row execute function app.audit_row();
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
alter table dive_certifications enable row level security;

-- The office records and reviews; instructors read (who may go how deep); a customer uploads and reads their own.
create policy dive_certifications_office on dive_certifications for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy dive_certifications_instructor_read on dive_certifications for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_instructor()));
create policy dive_certifications_customer_read on dive_certifications for select to authenticated
  using (organization_id = (select app.current_org()) and diver_id in (select app.dive_my_diver_ids()));
create policy dive_certifications_customer_upload on dive_certifications for insert to authenticated
  with check (organization_id = (select app.current_org()) and diver_id in (select app.dive_my_diver_ids()));
