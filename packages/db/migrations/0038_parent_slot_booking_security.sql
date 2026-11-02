-- Families book private, pair and therapy slots themselves from the parent portal. The office opts in per slot
-- (private_slots.parent_bookable). Parents still cannot read the slot tables directly (other families' bookings stay
-- hidden), so the portal goes through three definer functions that check the caller is a parent of the child, that
-- the slot is open to families, still in the future and has a free seat. A booking made here is an ordinary
-- slot_bookings row, so billing, payroll and the confirmation message treat it like one the office made.

-- How long before the lesson a family may still cancel a booking they made themselves.
create or replace function app.portal_slot_cancel_hours() returns integer
language sql immutable as $$ select 24 $$;
--> statement-breakpoint

-- ─── Open slots the signed-in parent may book (next four weeks) ──────────────
create or replace function public.portal_open_slots()
returns table (
  id uuid, kind text, date date, starts_at timestamptz, ends_at timestamptz,
  venue_name text, program_name text, instructor_first_name text, capacity smallint, seats_left integer
)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.kind, p.date, p.starts_at, p.ends_at,
         v.name, pr.name_he, sm.first_name, p.capacity,
         p.capacity - (select count(*)::int from slot_bookings b where b.slot_id = p.id and b.status = 'booked')
  from private_slots p
  join venues v on v.organization_id = p.organization_id and v.id = p.venue_id
  join staff_members sm on sm.organization_id = p.organization_id and sm.id = p.staff_member_id
  left join programs pr on pr.organization_id = p.organization_id and pr.id = p.program_id
  where p.organization_id = app.current_org()
    and (app.current_membership()).role = 'parent'
    and p.parent_bookable
    and p.status = 'open'
    and p.starts_at > now()
    and p.date <= app.today() + 28
  order by p.starts_at
$$;
revoke execute on function public.portal_open_slots() from public, anon;
grant execute on function public.portal_open_slots() to authenticated;
--> statement-breakpoint

-- ─── The family's own slot bookings (upcoming) ──────────────────────────────
create or replace function public.portal_my_slot_bookings()
returns table (
  id uuid, slot_id uuid, student_id uuid, kind text, date date, starts_at timestamptz, ends_at timestamptz,
  venue_name text, instructor_first_name text, booked_by_family boolean, can_cancel boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, p.id, b.student_id, p.kind, p.date, p.starts_at, p.ends_at, v.name, sm.first_name,
         b.booked_by = app.current_user_id(),
         b.booked_by = app.current_user_id()
           and p.starts_at > now() + make_interval(hours => app.portal_slot_cancel_hours())
  from slot_bookings b
  join private_slots p on p.organization_id = b.organization_id and p.id = b.slot_id
  join venues v on v.organization_id = p.organization_id and v.id = p.venue_id
  join staff_members sm on sm.organization_id = p.organization_id and sm.id = p.staff_member_id
  where b.organization_id = app.current_org()
    and (app.current_membership()).role = 'parent'
    and b.student_id in (select app.guardian_student_ids())
    and b.status = 'booked'
    and p.status <> 'cancelled'
    and p.ends_at > now()
  order by p.starts_at
$$;
revoke execute on function public.portal_my_slot_bookings() from public, anon;
grant execute on function public.portal_my_slot_bookings() to authenticated;
--> statement-breakpoint

-- ─── Book ───────────────────────────────────────────────────────────────────
create or replace function public.portal_book_slot(p_slot uuid, p_student uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  org uuid := app.current_org();
  uid uuid := app.current_user_id();
  s private_slots;
  taken integer;
  bid uuid;
begin
  if uid is null or org is null or coalesce((app.current_membership()).role, '') <> 'parent'
     or p_student not in (select app.guardian_student_ids()) then
    raise exception 'common.errors.forbidden' using errcode = 'RSW01';
  end if;
  select * into s from private_slots where organization_id = org and id = p_slot for update;
  if s.id is null or not s.parent_bookable then
    raise exception 'common.errors.notFound' using errcode = 'RSW01';
  end if;
  if s.status <> 'open' then raise exception 'scheduling.errors.slotNotOpen' using errcode = 'RSW01'; end if;
  if s.starts_at <= now() then raise exception 'scheduling.errors.slotPast' using errcode = 'RSW01'; end if;
  if exists (select 1 from slot_bookings b
             where b.slot_id = p_slot and b.student_id = p_student and b.status = 'booked') then
    raise exception 'scheduling.errors.alreadyBooked' using errcode = 'RSW01';
  end if;
  select count(*)::int into taken from slot_bookings b where b.slot_id = p_slot and b.status = 'booked';
  if taken >= s.capacity then raise exception 'scheduling.errors.slotNotOpen' using errcode = 'RSW01'; end if;

  insert into slot_bookings (organization_id, slot_id, student_id, booked_by)
    values (org, p_slot, p_student, uid) returning id into bid;
  if taken + 1 >= s.capacity then
    update private_slots set status = 'full' where id = p_slot;
  end if;
  -- The same event the office's booking emits: the family gets the confirmation, billing and payroll count it.
  insert into outbox (organization_id, event_type, payload, idempotency_key)
    values (org, 'scheduling.slot_booked',
            jsonb_build_object('bookingId', bid, 'slotId', p_slot, 'studentId', p_student, 'kind', s.kind,
                               'date', s.date, 'byFamily', true),
            format('scheduling.slot_booked:%s', bid));
  return bid;
end $$;
revoke execute on function public.portal_book_slot(uuid, uuid) from public, anon;
grant execute on function public.portal_book_slot(uuid, uuid) to authenticated;
--> statement-breakpoint

-- ─── Cancel (only a booking the family made, and only in time) ──────────────
create or replace function public.portal_cancel_slot_booking(p_booking uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  org uuid := app.current_org();
  uid uuid := app.current_user_id();
  b slot_bookings;
  s private_slots;
begin
  if uid is null or org is null or coalesce((app.current_membership()).role, '') <> 'parent' then
    raise exception 'common.errors.forbidden' using errcode = 'RSW01';
  end if;
  select * into b from slot_bookings
    where organization_id = org and id = p_booking and status = 'booked'
      and student_id in (select app.guardian_student_ids())
    for update;
  if b.id is null then raise exception 'common.errors.notFound' using errcode = 'RSW01'; end if;
  if b.booked_by is distinct from uid then
    raise exception 'scheduling.errors.portalCancelOffice' using errcode = 'RSW01';
  end if;
  select * into s from private_slots where id = b.slot_id for update;
  if s.starts_at <= now() + make_interval(hours => app.portal_slot_cancel_hours()) then
    raise exception 'scheduling.errors.portalCancelLate' using errcode = 'RSW01';
  end if;
  update slot_bookings set status = 'cancelled', cancelled_at = now() where id = b.id;
  update private_slots set status = 'open' where id = s.id and status = 'full';
  insert into outbox (organization_id, event_type, payload, idempotency_key)
    values (org, 'scheduling.slot_booking_cancelled',
            jsonb_build_object('bookingId', b.id, 'slotId', s.id, 'byFamily', true),
            format('scheduling.slot_booking_cancelled:%s', b.id));
end $$;
revoke execute on function public.portal_cancel_slot_booking(uuid) from public, anon;
grant execute on function public.portal_cancel_slot_booking(uuid) to authenticated;
