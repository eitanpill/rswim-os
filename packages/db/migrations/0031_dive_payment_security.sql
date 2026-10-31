-- Freediving: a paid session is confirmed only once it is paid.
-- A booking waiting for money is `pending_payment` and holds its seat until `hold_until`; after that the seat is free
-- again. A customer can never confirm their own booking: staff do at the desk, and the payment provider's callback
-- does through the system role.

-- Whether a booking takes a seat right now.
create or replace function app.dive_holds_seat(st text, hold timestamptz) returns boolean
language sql stable as $$
  select st in ('booked', 'checked_in') or (st = 'pending_payment' and hold is not null and hold > now())
$$;
--> statement-breakpoint

-- Seats taken in a session of the caller's club. A customer sees only their own bookings, yet must see how many
-- seats are left: this tells them the number and nothing else.
create or replace function app.dive_seats_taken(p_session uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from dive_bookings b
  where b.session_id = p_session and b.organization_id = app.current_org()
    and app.dive_holds_seat(b.status, b.hold_until)
$$;
--> statement-breakpoint

-- Whether the club in force asks for payment before confirming (rules.booking.require_payment, default yes).
create or replace function app.dive_requires_payment(org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select (r.rules -> 'booking' ->> 'require_payment')::boolean from dive_rule_sets r
    where r.organization_id = org and r.effective_from <= app.today()
    order by r.effective_from desc limit 1), true)
$$;
--> statement-breakpoint

-- A session never takes more divers than its capacity, counting seats held for payment. A customer books for
-- themself, online: with their own pass or a free session it is confirmed, otherwise it waits for payment. A
-- customer may cancel, or book again a cancelled or lapsed booking, and nothing else.
create or replace function app.guard_dive_booking() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  taken integer;
  cap integer;
  due integer;
  starts timestamptz;
  own_pass boolean;
  rebook boolean := false;
begin
  if coalesce(app.current_app_role() = 'parent', false) then
    if tg_op = 'UPDATE' then
      if new.status = 'cancelled' and old.status in ('booked', 'pending_payment') then
        new := old;
        new.status := 'cancelled';
        new.hold_until := null;
        new.updated_at := now();
        return new;
      end if;
      if not (old.status = 'cancelled' or (old.status = 'pending_payment' and not app.dive_holds_seat(old.status, old.hold_until))) then
        raise exception 'dive.errors.customerCannotChange' using errcode = 'RSW01';
      end if;
      rebook := true;
      new.diver_id := old.diver_id;
      new.session_id := old.session_id;
    end if;
    new.booked_via := 'online';
    new.checked_in_at := null;
    new.line_label := null;
    new.buddy_diver_id := null;
    if tg_op = 'INSERT' then new.created_by := app.current_user_id(); end if;
    own_pass := new.pass_id is not null
      and exists (select 1 from dive_passes p where p.id = new.pass_id and p.diver_id = new.diver_id);
    if not own_pass then new.pass_id := null; end if;
    select p.price_agorot, x.starts_at into due, starts
      from dive_sessions x join dive_programs p on p.id = x.program_id where x.id = new.session_id;
    if own_pass or coalesce(due, 0) = 0 or not app.dive_requires_payment(new.organization_id) then
      new.status := 'booked';
      new.hold_until := null;
      new.price_agorot := case when own_pass then 0 else coalesce(due, 0) end;
    else
      new.status := 'pending_payment';
      new.price_agorot := due;
      new.hold_until := least(coalesce(new.hold_until, now() + interval '30 minutes'), now() + interval '24 hours', starts);
    end if;
  end if;
  if new.status <> 'pending_payment' then new.hold_until := null; end if;
  if app.dive_holds_seat(new.status, new.hold_until)
     and (tg_op = 'INSERT' or rebook or new.status is distinct from old.status
          or new.hold_until is distinct from old.hold_until) then
    select capacity into cap from dive_sessions where id = new.session_id;
    select count(*) into taken from dive_bookings
      where session_id = new.session_id and id <> new.id and app.dive_holds_seat(status, hold_until);
    if taken >= cap then
      raise exception 'dive.errors.sessionFull' using errcode = 'RSW01';
    end if;
  end if;
  return new;
end $$;
--> statement-breakpoint

grant execute on all functions in schema app to authenticated, rswim_system;
