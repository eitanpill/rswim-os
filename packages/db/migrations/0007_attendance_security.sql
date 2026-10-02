-- Phase 3 security layer: FKs drizzle cannot express, visibility helpers, the seat check, triggers, grants and RLS
-- for trials, forms, attendance, absence notices, makeup credits and bookings, progress and closure events.

-- ─── FKs with SET NULL on one column of a composite key ─────────────────────
alter table closure_events
  add constraint closure_events_venue_fk foreign key (organization_id, venue_id)
    references venues (organization_id, id) on delete cascade,
  add constraint closure_events_venue_closure_fk foreign key (organization_id, venue_closure_id)
    references venue_closures (organization_id, id) on delete set null (venue_closure_id);
alter table sessions
  add constraint sessions_closure_event_fk foreign key (organization_id, closure_event_id)
    references closure_events (organization_id, id) on delete set null (closure_event_id);
alter table trials
  add constraint trials_enrollment_fk foreign key (organization_id, enrollment_id)
    references enrollments (organization_id, id) on delete set null (enrollment_id),
  add constraint trials_level_fk foreign key (organization_id, recommended_level_id)
    references levels (organization_id, id) on delete set null (recommended_level_id),
  add constraint trials_recommended_template_fk foreign key (organization_id, recommended_template_id)
    references class_templates (organization_id, id) on delete set null (recommended_template_id),
  add constraint trials_converted_fk foreign key (organization_id, converted_enrollment_id)
    references enrollments (organization_id, id) on delete set null (converted_enrollment_id);
alter table makeup_credits
  add constraint makeup_credits_source_session_fk foreign key (organization_id, source_session_id)
    references sessions (organization_id, id) on delete set null (source_session_id);
alter table absence_notices
  add constraint absence_notices_credit_fk foreign key (organization_id, credit_id)
    references makeup_credits (organization_id, id) on delete set null (credit_id);
alter table progress_marks
  add constraint progress_marks_level_fk foreign key (organization_id, level_id)
    references levels (organization_id, id) on delete cascade,
  add constraint progress_marks_session_fk foreign key (organization_id, session_id)
    references sessions (organization_id, id) on delete set null (session_id),
  add constraint progress_marks_staff_fk foreign key (organization_id, staff_member_id)
    references staff_members (organization_id, id) on delete set null (staff_member_id);
--> statement-breakpoint

-- ─── Visibility helpers ─────────────────────────────────────────────────────
-- Sessions the signed-in instructor teaches: on the session's staff, or lead of its group.
create or replace function app.instructor_session_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id from sessions s join class_templates ct on ct.id = s.class_template_id
  where s.organization_id = app.current_org()
    and app.current_staff_member_id() is not null
    and (ct.lead_staff_id = app.current_staff_member_id()
         or exists (select 1 from session_staff ss
                    where ss.session_id = s.id and ss.staff_member_id = app.current_staff_member_id()))
$$;

-- Phase 2's set plus makeup guests booked into sessions the instructor teaches in the same range.
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
  union
  select mb.student_id from makeup_bookings mb join sessions s on s.id = mb.session_id
  where mb.organization_id = app.current_org()
    and mb.status <> 'cancelled'
    and s.date between app.today() - 7 and app.today() + 14
    and s.id in (select app.instructor_session_ids())
$$;

-- Groups the signed-in parent's children are (or were) in, and groups they are booked into for a makeup.
create or replace function app.guardian_template_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.class_template_id from enrollments e
  where e.organization_id = app.current_org()
    and e.student_id in (select app.guardian_student_ids())
  union
  select s.class_template_id from makeup_bookings b join sessions s on s.id = b.session_id
  where b.organization_id = app.current_org()
    and b.student_id in (select app.guardian_student_ids())
$$;
--> statement-breakpoint

-- ─── Seats ──────────────────────────────────────────────────────────────────
-- The caller's organization from inside a SECURITY DEFINER function, where current_user is the function owner and
-- app.current_org() cannot tell the worker apart. The role setting still names the caller's role.
create or replace function app.definer_org() returns uuid
language sql stable as $$
  select case when current_setting('role', true) = 'rswim_system'
    then nullif(current_setting('app.org_id', true), '')::uuid
    else (app.current_membership()).organization_id end
$$;

-- Free seats in a group session: capacity − children holding a seat that day (trials included) + those of them who
-- sent an absence notice − makeup guests. SECURITY DEFINER so a parent learns the number, never who sits there.
create or replace function app.session_free_seats(p_session uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (
    select s.id, s.date, s.class_template_id, ct.capacity
    from sessions s join class_templates ct on ct.id = s.class_template_id
    where s.id = p_session and s.organization_id = app.definer_org()
  ), seats as (
    select e.student_id from enrollments e, s
    where e.class_template_id = s.class_template_id
      and e.status in ('trial_booked', 'active', 'frozen', 'cancel_requested')
      and e.starts_on <= s.date and (e.ends_on is null or e.ends_on > s.date)
  )
  select s.capacity
       - (select count(distinct student_id) from seats)::int
       + (select count(*) from absence_notices n
          where n.session_id = s.id and n.status <> 'withdrawn'
            and n.student_id in (select student_id from seats))::int
       - (select count(*) from makeup_bookings b
          where b.session_id = s.id and b.status in ('booked', 'attended'))::int
  from s
$$;

-- The marketplace's facts for scheduled group sessions in a date range: what the group admits, its window, the
-- lead's gender and the free seats. No people. Any member of the organization may ask (parents book makeups).
create or replace function app.makeup_session_facts(p_from date, p_to date)
returns table (
  session_id uuid, date date, starts_at timestamptz, ends_at timestamptz, class_template_id uuid,
  template_name text, program_id uuid, venue_id uuid, venue_name text, admitted_gender text,
  age_min_months smallint, age_max_months smallint, level_min_ordinal smallint, level_max_ordinal smallint,
  window_restriction text, lead_gender text, free_seats integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.date, s.starts_at, s.ends_at, ct.id, ct.name, ct.program_id, ct.venue_id, v.name,
         ct.admitted_gender, ct.age_min_months, ct.age_max_months, lmin.ordinal, lmax.ordinal,
         (select w.gender_restriction from venue_operating_windows w
          where w.pool_id = ct.pool_id and w.weekday = ct.weekday
            and w.starts_at <= ct.starts_at
            and ct.starts_at + make_interval(mins => ct.duration_min) <= w.ends_at
            and w.effective_from <= s.date and (w.effective_to is null or w.effective_to > s.date)
            and not exists (select 1 from class_template_lanes l
                            where l.class_template_id = ct.id
                              and not exists (select 1 from operating_window_lanes owl
                                              where owl.window_id = w.id and owl.lane_id = l.lane_id))
          order by w.starts_at limit 1),
         coalesce((select sm.gender from session_staff ss join staff_members sm on sm.id = ss.staff_member_id
                   where ss.session_id = s.id and ss.role = 'lead'),
                  (select sm.gender from staff_members sm where sm.id = ct.lead_staff_id)),
         app.session_free_seats(s.id)
  from sessions s
  join class_templates ct on ct.id = s.class_template_id
  join venues v on v.id = ct.venue_id
  left join levels lmin on lmin.id = ct.level_min_id
  left join levels lmax on lmax.id = ct.level_max_id
  where s.organization_id = app.definer_org()
    and s.status = 'scheduled'
    and s.date between p_from and p_to
    and s.starts_at > now()
    and ct.status = 'active'
  order by s.starts_at
$$;
--> statement-breakpoint

-- ─── Triggers ───────────────────────────────────────────────────────────────
-- Raised for rule breaks a user can cause; the services turn the message (an i18n code) into a DomainError.
-- SQLSTATE RSW01 is ours.

-- A parent's notice is received now and waits for the worker to classify it: they set none of the outcome.
create or replace function app.guard_absence_notice() returns trigger
language plpgsql as $$
begin
  if current_user <> 'authenticated' or app.is_owner_or_admin() then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'only the office changes an absence notice' using errcode = 'insufficient_privilege';
  end if;
  new.received_at := now();
  new.channel := 'parent_portal';
  new.status := 'pending';
  new.minutes_before := null;
  new.classification := null;
  new.decision := null;
  new.policy_version_key := null;
  new.credit_id := null;
  new.processed_at := null;
  new.reported_by := app.current_user_id();
  return new;
end $$;
create trigger guard_absence_notice before insert or update on absence_notices
  for each row execute function app.guard_absence_notice();

-- A makeup booking takes a seat: lock the session so two families cannot take the last one, and check the credit.
-- The trigger runs as the caller (to know who books); the checks read past RLS in check_makeup_target.
create or replace function app.check_makeup_target(p_org uuid, p_session uuid, p_credit uuid, p_student uuid,
                                                   p_privileged boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s record;
  c record;
begin
  -- (Session first, then credit: one lock order everywhere.)
  select * into s from sessions where id = p_session and organization_id = p_org for update;
  select * into c from makeup_credits where id = p_credit and organization_id = p_org for update;
  if c.student_id is distinct from p_student then
    raise exception 'attendance.errors.creditNotYours' using errcode = 'RSW01';
  end if;
  if c.status <> 'open' then
    raise exception 'attendance.errors.creditNotOpen' using errcode = 'RSW01';
  end if;
  if s.status is distinct from 'scheduled' then
    raise exception 'attendance.errors.sessionNotScheduled' using errcode = 'RSW01';
  end if;
  if s.date > c.expires_on then
    raise exception 'attendance.errors.afterExpiry' using errcode = 'RSW01';
  end if;
  if not p_privileged and s.starts_at <= now() then
    raise exception 'attendance.errors.sessionStarted' using errcode = 'RSW01';
  end if;
  if coalesce(app.session_free_seats(s.id), 0) <= 0 then
    raise exception 'attendance.errors.noSeat' using errcode = 'RSW01';
  end if;
end $$;

create or replace function app.session_started(p_session uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select starts_at <= now() from sessions where id = p_session), true)
$$;

create or replace function app.check_makeup_booking() returns trigger
language plpgsql as $$
declare
  privileged boolean := current_user <> 'authenticated' or app.is_owner_or_admin();
begin
  if tg_op = 'UPDATE' then
    if privileged then return new; end if;
    if old.status <> 'booked' or new.status <> 'cancelled' or app.session_started(old.session_id)
       or (to_jsonb(new) - array['status', 'cancelled_at', 'updated_at'])
          is distinct from (to_jsonb(old) - array['status', 'cancelled_at', 'updated_at']) then
      raise exception 'attendance.errors.cannotCancelBooking' using errcode = 'RSW01';
    end if;
    new.cancelled_at := now();
    return new;
  end if;
  if new.status <> 'booked' then
    raise exception 'attendance.errors.bookingStatus' using errcode = 'RSW01';
  end if;
  perform app.check_makeup_target(new.organization_id, new.session_id, new.credit_id, new.student_id, privileged);
  if not privileged then
    new.booked_by := app.current_user_id();
    new.override_note := null;
  end if;
  return new;
end $$;
create trigger check_makeup_booking before insert or update on makeup_bookings
  for each row execute function app.check_makeup_booking();

-- The credit follows its booking: booked, used (attended or missed), or open again when the booking is cancelled.
create or replace function app.sync_makeup_credit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then return null; end if;
  update makeup_credits set status = case new.status
      when 'booked' then 'booked'
      when 'cancelled' then case when expires_on >= app.today() then 'open' else 'expired' end
      else 'used' end
  where id = new.credit_id and status in ('open', 'booked', 'used');
  return null;
end $$;
create trigger sync_makeup_credit after insert or update on makeup_bookings
  for each row execute function app.sync_makeup_credit();

-- A mark on the lineup settles the guest's booking and the trial.
create or replace function app.sync_attendance() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update makeup_bookings set status = case when new.status = 'absent' then 'missed' else 'attended' end
  where session_id = new.session_id and student_id = new.student_id and status in ('booked', 'attended', 'missed');
  update trials set status = case when new.status = 'absent' then 'no_show' else 'attended' end
  where session_id = new.session_id and student_id = new.student_id and status in ('booked', 'attended', 'no_show');
  return null;
end $$;
create trigger sync_attendance after insert or update of status on attendance
  for each row execute function app.sync_attendance();

-- An instructor gives the trial verdict and nothing else.
create or replace function app.guard_trial() returns trigger
language plpgsql as $$
begin
  if current_user <> 'authenticated' or app.is_owner_or_admin() then
    return new;
  end if;
  if (to_jsonb(new) - array['status', 'outcome', 'recommended_level_id', 'recommended_template_id', 'verdict_note',
                            'verdict_by', 'verdict_at', 'offer_valid_until', 'updated_at'])
     is distinct from (to_jsonb(old) - array['status', 'outcome', 'recommended_level_id', 'recommended_template_id',
                                             'verdict_note', 'verdict_by', 'verdict_at', 'offer_valid_until',
                                             'updated_at'])
     or new.status not in ('attended', 'no_show') then
    raise exception 'attendance.errors.verdictOnly' using errcode = 'RSW01';
  end if;
  new.verdict_by := app.current_user_id();
  new.verdict_at := now();
  return new;
end $$;
create trigger guard_trial before update on trials
  for each row execute function app.guard_trial();

-- Once the trial happened (or did not), its one-day seat is done.
create or replace function app.sync_trial_seat() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status in ('attended', 'no_show') and new.enrollment_id is not null then
    update enrollments set status = 'trial_done' where id = new.enrollment_id and status = 'trial_booked';
  elsif new.status = 'cancelled' and new.enrollment_id is not null then
    delete from enrollments where id = new.enrollment_id and status = 'trial_booked';
  end if;
  return null;
end $$;
create trigger sync_trial_seat after update of status on trials
  for each row execute function app.sync_trial_seat();

-- A published form version is what families signed: frozen, and kept for as long as the organization exists.
create or replace function app.guard_form_template() returns trigger
language plpgsql as $$
begin
  if old.published_at is not null and not app.org_deleted(old.organization_id) then
    raise exception 'settings.errors.versionLocked' using errcode = 'RSW01';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger guard_form_template before update or delete on form_templates
  for each row execute function app.guard_form_template();

create or replace function app.forbid_mutation_unless_org_deleted() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and app.org_deleted(old.organization_id) then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;
create trigger form_submissions_append_only before update or delete on form_submissions
  for each row execute function app.forbid_mutation_unless_org_deleted();

do $$
declare t text;
begin
  foreach t in array array['closure_events', 'trials', 'form_templates', 'attendance', 'makeup_credits',
                           'absence_notices', 'makeup_bookings'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['closure_events', 'trials', 'form_templates', 'form_submissions', 'attendance',
                           'makeup_credits', 'absence_notices', 'makeup_bookings', 'progress_marks'] loop
    execute format('create trigger audit_row after insert or update or delete on %I for each row execute function app.audit_row()', t);
  end loop;
end $$;
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
-- The regulations as configuration are readable by every member (parents accept them; instructors apply the late
-- threshold), and so is the catalog of programs and levels. Prices stay with owner/admin/accountant.
create policy policy_sets_members on policy_sets for select to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.current_app_role()) is not null);
create policy programs_members on programs for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.current_app_role()) = 'parent');
create policy levels_members on levels for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.current_app_role()) = 'parent');

-- Owner/admin manage every Phase 3 table.
do $$
declare t text;
begin
  foreach t in array array['closure_events', 'trials', 'form_templates', 'form_submissions', 'attendance',
                           'makeup_credits', 'absence_notices', 'makeup_bookings', 'progress_marks'] loop
    execute format($f$
      create policy %1$s_write on %1$I for all to authenticated, rswim_system
        using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
        with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))$f$, t);
  end loop;
end $$;

-- Closure events: every staff member reads them (instructors see why their lesson is cancelled).
create policy closure_events_select on closure_events for select to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_staff()));

-- Forms: members read published versions; families read and add their own household's acceptances.
create policy form_templates_select on form_templates for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin())
              or (published_at is not null and (select app.current_app_role()) is not null)));
create policy form_submissions_select on form_submissions for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and household_id in (select app.guardian_household_ids()));
create policy form_submissions_parent_insert on form_submissions for insert to authenticated
  with check (organization_id = (select app.current_org())
              and household_id in (select app.guardian_household_ids())
              and (student_id is null or student_id in (select app.guardian_student_ids()))
              and channel = 'parent_portal'
              and recorded_by = (select app.current_user_id()));

-- Attendance: the instructor of the session reads and marks it; parents read their children's marks.
create policy attendance_select on attendance for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and (session_id in (select app.instructor_session_ids())
              or student_id in (select app.guardian_student_ids())));
create policy attendance_instructor_insert on attendance for insert to authenticated
  with check (organization_id = (select app.current_org())
              and session_id in (select app.instructor_session_ids())
              and student_id in (select app.instructor_student_ids()));
create policy attendance_instructor_update on attendance for update to authenticated
  using (organization_id = (select app.current_org()) and session_id in (select app.instructor_session_ids()))
  with check (organization_id = (select app.current_org()) and session_id in (select app.instructor_session_ids()));

-- Absence notices: the session's instructor reads them; parents read and send them for their own children in their
-- children's groups (guard_absence_notice sets the time and leaves the outcome to the worker).
create policy absence_notices_select on absence_notices for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and (session_id in (select app.instructor_session_ids())
              or student_id in (select app.guardian_student_ids())));
create policy absence_notices_parent_insert on absence_notices for insert to authenticated
  with check (organization_id = (select app.current_org())
              and student_id in (select app.guardian_student_ids())
              and session_id in (select s.id from sessions s
                                 where s.class_template_id in (select app.guardian_template_ids())));

-- Credits: parents read their children's; instructors read those of children they teach. Only the office and the
-- worker issue them.
create policy makeup_credits_select on makeup_credits for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and (student_id in (select app.guardian_student_ids())
              or student_id in (select app.instructor_student_ids())));

-- Bookings: parents read, book and cancel their children's (check_makeup_booking enforces credit, seat and time);
-- instructors read the guests of their sessions.
create policy makeup_bookings_select on makeup_bookings for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and (student_id in (select app.guardian_student_ids())
              or session_id in (select app.instructor_session_ids())));
create policy makeup_bookings_parent_insert on makeup_bookings for insert to authenticated
  with check (organization_id = (select app.current_org())
              and student_id in (select app.guardian_student_ids()));
create policy makeup_bookings_parent_update on makeup_bookings for update to authenticated
  using (organization_id = (select app.current_org()) and student_id in (select app.guardian_student_ids()))
  with check (organization_id = (select app.current_org()) and student_id in (select app.guardian_student_ids()));

-- Trials: parents read their children's; the session's instructor reads them and records the verdict (guard_trial).
create policy trials_select on trials for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and (student_id in (select app.guardian_student_ids())
              or session_id in (select app.instructor_session_ids())));
create policy trials_instructor_verdict on trials for update to authenticated
  using (organization_id = (select app.current_org()) and session_id in (select app.instructor_session_ids()))
  with check (organization_id = (select app.current_org()) and session_id in (select app.instructor_session_ids()));

-- Progress: instructors tick skills for the children they teach; parents read their children's.
create policy progress_marks_select on progress_marks for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and (student_id in (select app.guardian_student_ids())
              or student_id in (select app.instructor_student_ids())));
create policy progress_marks_instructor on progress_marks for all to authenticated
  using (organization_id = (select app.current_org()) and student_id in (select app.instructor_student_ids()))
  with check (organization_id = (select app.current_org())
              and student_id in (select app.instructor_student_ids())
              and staff_member_id = (select app.current_staff_member_id()));
