-- Phase 7 security layer: FKs drizzle cannot express, the guard on family requests, grants and RLS.

-- ─── FKs with SET NULL on one column of a composite key ─────────────────────
alter table portal_requests
  add constraint portal_requests_freeze_fk foreign key (organization_id, freeze_id)
    references enrollment_freezes (organization_id, id) on delete set null (freeze_id),
  add constraint portal_requests_cancellation_fk foreign key (organization_id, cancellation_id)
    references cancellation_requests (organization_id, id) on delete set null (cancellation_id);
--> statement-breakpoint

-- ─── Guard ──────────────────────────────────────────────────────────────────
-- A family's request is stamped by the database: who asked and when (the cut-off is decided by that moment). A family
-- may only ask (pending, nothing decided) and later withdraw a pending request; deciding is the worker's or office's.
create or replace function app.guard_portal_request() returns trigger
language plpgsql as $$
begin
  if current_user <> 'authenticated' or app.is_owner_or_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.requested_by := auth.uid();
    new.requested_at := now();
    new.status := 'pending';
    new.freeze_id := null;
    new.cancellation_id := null;
    new.error := null;
    new.processed_at := null;
    return new;
  end if;
  if old.status <> 'pending' or new.status <> 'withdrawn'
     or new.enrollment_id is distinct from old.enrollment_id or new.kind is distinct from old.kind
     or new.from_date is distinct from old.from_date or new.to_date is distinct from old.to_date
     or new.requested_at is distinct from old.requested_at or new.requested_by is distinct from old.requested_by
     or new.freeze_id is not null or new.cancellation_id is not null or new.processed_at is not null then
    raise exception 'parent.requests.errors.notPending' using errcode = 'RSW01';
  end if;
  return new;
end $$;

create trigger guard_portal_request before insert or update on portal_requests
  for each row execute function app.guard_portal_request();
create trigger set_updated_at before update on portal_requests
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on portal_requests
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
-- The office (owner, admin, billing.write) and the tenant's worker manage requests; billing.read reads them. A family
-- asks for and reads requests on their own children's seats, and withdraws a pending one.
alter table portal_requests enable row level security;

create policy portal_requests_office on portal_requests for all to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin()) or (select app.has_permission('billing.write'))))
  with check (organization_id = (select app.current_org())
              and ((select app.is_owner_or_admin()) or (select app.has_permission('billing.write'))));
create policy portal_requests_read on portal_requests for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.has_permission('billing.read')));

create or replace function app.guardian_enrollment_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id from enrollments e
  where e.organization_id = app.current_org() and e.student_id in (select app.guardian_student_ids())
$$;
grant execute on function app.guardian_enrollment_ids() to authenticated;

create policy portal_requests_family on portal_requests for select to authenticated
  using (organization_id = (select app.current_org())
         and enrollment_id in (select app.guardian_enrollment_ids()));
create policy portal_requests_family_insert on portal_requests for insert to authenticated
  with check (organization_id = (select app.current_org())
              and enrollment_id in (select app.guardian_enrollment_ids()));
create policy portal_requests_family_withdraw on portal_requests for update to authenticated
  using (organization_id = (select app.current_org())
         and enrollment_id in (select app.guardian_enrollment_ids()) and status = 'pending')
  with check (organization_id = (select app.current_org())
              and enrollment_id in (select app.guardian_enrollment_ids()));
