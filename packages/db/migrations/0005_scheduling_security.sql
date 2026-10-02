-- Phase 2 security layer: FKs drizzle cannot express, triggers, grants and RLS for the scheduling tables.

-- ─── FKs with SET NULL on one column of a composite key ─────────────────────
alter table class_templates
  add constraint class_templates_level_min_fk foreign key (organization_id, level_min_id)
    references levels (organization_id, id) on delete set null (level_min_id),
  add constraint class_templates_level_max_fk foreign key (organization_id, level_max_id)
    references levels (organization_id, id) on delete set null (level_max_id),
  add constraint class_templates_lead_fk foreign key (organization_id, lead_staff_id)
    references staff_members (organization_id, id) on delete set null (lead_staff_id);
alter table waitlist_entries
  add constraint waitlist_venue_fk foreign key (organization_id, venue_id)
    references venues (organization_id, id) on delete set null (venue_id),
  add constraint waitlist_template_fk foreign key (organization_id, class_template_id)
    references class_templates (organization_id, id) on delete set null (class_template_id),
  add constraint waitlist_enrollment_fk foreign key (organization_id, placed_enrollment_id)
    references enrollments (organization_id, id) on delete set null (placed_enrollment_id);
alter table shift_changes
  add constraint shift_changes_from_fk foreign key (organization_id, from_staff_id)
    references staff_members (organization_id, id) on delete set null (from_staff_id),
  add constraint shift_changes_to_fk foreign key (organization_id, to_staff_id)
    references staff_members (organization_id, id) on delete set null (to_staff_id);
alter table enrollments
  add constraint enrollments_previous_fk foreign key (organization_id, previous_enrollment_id)
    references enrollments (organization_id, id) on delete set null (previous_enrollment_id);
alter table sessions
  add constraint sessions_run_fk foreign key (organization_id, generation_run_id)
    references session_generation_runs (organization_id, id) on delete set null (generation_run_id);
-- Promised in Phase 1: class-template scoped policy sets.
alter table policy_sets
  add constraint policy_sets_template_fk foreign key (organization_id, class_template_id)
    references class_templates (organization_id, id) on delete cascade;
--> statement-breakpoint

-- ─── Visibility helpers ─────────────────────────────────────────────────────
-- SECURITY DEFINER so policies on one table can ask about another without RLS recursion.

-- Groups the signed-in instructor teaches: lead of the group, or on the staff of one of its sessions.
create or replace function app.instructor_template_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select ct.id from class_templates ct
  where ct.organization_id = app.current_org()
    and app.current_staff_member_id() is not null
    and (ct.lead_staff_id = app.current_staff_member_id()
         or exists (select 1 from sessions s join session_staff ss on ss.session_id = s.id
                    where s.class_template_id = ct.id and ss.staff_member_id = app.current_staff_member_id()))
$$;

-- Phase 0 left this empty. Children an instructor may see: in groups they teach that have a session from a week ago
-- to two weeks ahead, or booked into their own private slots in that range.
create or replace function app.instructor_student_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.student_id from enrollments e
  where e.organization_id = app.current_org()
    and e.status in ('trial_booked', 'active', 'frozen', 'cancel_requested')
    and (e.ends_on is null or e.ends_on > app.today() - 7)
    and exists (
      select 1 from sessions s
      left join session_staff ss on ss.session_id = s.id
      join class_templates ct on ct.id = s.class_template_id
      where s.class_template_id = e.class_template_id
        and s.date between app.today() - 7 and app.today() + 14
        and (ss.staff_member_id = app.current_staff_member_id()
             or ct.lead_staff_id = app.current_staff_member_id()))
  union
  select b.student_id from slot_bookings b join private_slots p on p.id = b.slot_id
  where b.organization_id = app.current_org()
    and b.status = 'booked'
    and p.staff_member_id = app.current_staff_member_id()
    and p.date between app.today() - 7 and app.today() + 14
$$;

-- Children of the signed-in parent.
create or replace function app.guardian_student_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id from students s
  where s.organization_id = app.current_org()
    and s.household_id in (select app.guardian_household_ids())
$$;

-- Groups the signed-in parent's children are (or were) in.
create or replace function app.guardian_template_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.class_template_id from enrollments e
  where e.organization_id = app.current_org()
    and e.student_id in (select app.guardian_student_ids())
$$;
--> statement-breakpoint

-- Private slots the signed-in parent's children are booked into, and slots of the signed-in instructor.
create or replace function app.guardian_slot_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select b.slot_id from slot_bookings b
  where b.organization_id = app.current_org() and b.student_id in (select app.guardian_student_ids())
$$;
create or replace function app.instructor_slot_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id from private_slots p
  where p.organization_id = app.current_org() and p.staff_member_id = app.current_staff_member_id()
$$;
--> statement-breakpoint

-- ─── Triggers ───────────────────────────────────────────────────────────────
-- An instructor answers their own pending change and nothing else: status to accepted or declined, with a note.
-- Owners, admins and the worker go through the services, which keep the rest of the lifecycle.
create or replace function app.guard_shift_change() returns trigger
language plpgsql as $$
begin
  -- Only signed-in users are limited; the owner connection (FK cascades, platform plumbing) passes.
  if current_user <> 'authenticated' or app.is_owner_or_admin() then
    return new;
  end if;
  if old.status <> 'pending' or new.status not in ('accepted', 'declined')
     or old.respondent_staff_id is distinct from app.current_staff_member_id()
     or (to_jsonb(new) - array['status', 'responded_at', 'response_note', 'updated_at'])
        is distinct from (to_jsonb(old) - array['status', 'responded_at', 'response_note', 'updated_at']) then
    raise exception 'only the instructor it waits for can answer a pending shift change'
      using errcode = 'insufficient_privilege';
  end if;
  new.responded_at := now();
  return new;
end $$;
create trigger guard_shift_change before update on shift_changes
  for each row execute function app.guard_shift_change();

-- A group's lanes must be lanes of its pool: the composite FK checks it; moving a group to another pool rewrites them.
do $$
declare t text;
begin
  foreach t in array array['terms', 'class_templates', 'sessions', 'enrollments', 'private_slots', 'waitlist_entries',
                           'shift_changes'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['terms', 'hebrew_calendar_overrides', 'class_templates', 'class_template_lanes',
                           'session_staff', 'enrollments', 'private_slots', 'slot_bookings', 'waitlist_entries',
                           'shift_changes'] loop
    execute format('create trigger audit_row after insert or update or delete on %I for each row execute function app.audit_row()', t);
  end loop;
end $$;
-- Sessions are audited on change only: generating a term inserts hundreds of rows that the run report already explains.
create trigger audit_row after update or delete on sessions
  for each row execute function app.audit_row();
--> statement-breakpoint

-- ─── Grants ─────────────────────────────────────────────────────────────────
select app.apply_standard_grants();
-- apply_standard_grants() grants whole tables again; keep the invite token hash unreadable (0003).
revoke select on staff_invites from authenticated;
grant select (id, organization_id, role, email, phone_e164, staff_member_id, expires_at, accepted_at,
              accepted_by, revoked_at, created_by, created_at) on staff_invites to authenticated;
grant execute on all functions in schema app to authenticated, rswim_system;
revoke execute on function app.apply_standard_grants() from public, authenticated, rswim_system;
--> statement-breakpoint

-- ─── Row level security ─────────────────────────────────────────────────────
-- Terms and calendar overrides: every staff member reads, parents read terms; owner/admin write.
create policy terms_select on terms for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_staff()) or (select app.current_app_role()) = 'parent'));
create policy calendar_overrides_select on hebrew_calendar_overrides for select to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_staff()));

-- The schedule: every staff member reads it (instructors cover for each other); parents read their children's groups.
create policy class_templates_select on class_templates for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_staff()) or id in (select app.guardian_template_ids())));
create policy class_template_lanes_select on class_template_lanes for select to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_staff()));
create policy sessions_select on sessions for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_staff()) or class_template_id in (select app.guardian_template_ids())));
create policy session_staff_select on session_staff for select to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_staff()));
create policy generation_runs_select on session_generation_runs for select to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));

do $$
declare t text;
begin
  foreach t in array array['terms', 'hebrew_calendar_overrides', 'class_templates', 'class_template_lanes', 'sessions',
                           'session_staff', 'session_generation_runs', 'enrollments', 'private_slots',
                           'slot_bookings', 'waitlist_entries'] loop
    execute format($f$
      create policy %1$s_write on %1$I for all to authenticated, rswim_system
        using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
        with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))$f$, t);
  end loop;
end $$;

-- Enrollments: owner/admin; parents their own children; instructors the children they teach.
create policy enrollments_select on enrollments for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin())
              or student_id in (select app.guardian_student_ids())
              or (student_id in (select app.instructor_student_ids())
                  and class_template_id in (select app.instructor_template_ids()))));

-- Private slots: owner/admin; an instructor sees their own; parents see slots their children are booked into.
create policy private_slots_select on private_slots for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin())
              or staff_member_id = (select app.current_staff_member_id())
              or id in (select app.guardian_slot_ids())));
create policy slot_bookings_select on slot_bookings for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin())
              or student_id in (select app.guardian_student_ids())
              or slot_id in (select app.instructor_slot_ids())));

-- Waitlist: owner/admin; parents see their children's entries.
create policy waitlist_select on waitlist_entries for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin()) or student_id in (select app.guardian_student_ids())));

-- Shift changes: owner/admin manage; an instructor sees changes that involve them and answers their own
-- (guard_shift_change limits what the answer may touch).
create policy shift_changes_select on shift_changes for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin())
              or (select app.current_staff_member_id()) in (respondent_staff_id, from_staff_id, to_staff_id)));
create policy shift_changes_write on shift_changes for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy shift_changes_answer on shift_changes for update to authenticated
  using (organization_id = (select app.current_org())
         and status = 'pending'
         and respondent_staff_id = (select app.current_staff_member_id()))
  with check (organization_id = (select app.current_org())
              and respondent_staff_id = (select app.current_staff_member_id()));
