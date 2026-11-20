-- Seats taken in a session, for the worker too (WhatsApp track W6: the divers' bot books for a diver).
-- app.dive_seats_taken is security definer, so inside it current_user is the owner and app.current_org() no longer saw
-- the system role's club: the worker counted no seats at all. The club now comes from the caller's membership, or,
-- when there is none (the system role), from the club the worker's transaction is bound to.
create or replace function app.dive_seats_taken(p_session uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from dive_bookings b
  where b.session_id = p_session
    and b.organization_id = coalesce((app.current_membership()).organization_id,
                                     nullif(current_setting('app.org_id', true), '')::uuid)
    and app.dive_holds_seat(b.status, b.hold_until)
$$;
