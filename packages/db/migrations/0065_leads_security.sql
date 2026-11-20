-- WhatsApp track, stage 1: who may see and change leads, and the triggers that move them along.
-- Leads are the office's (owner and admins: the front desk and the club manager) and the tenant's worker.

alter table leads
  add constraint leads_household_fk foreign key (organization_id, household_id)
    references households (organization_id, id) on delete set null (household_id),
  add constraint leads_diver_fk foreign key (organization_id, diver_id)
    references dive_divers (organization_id, id) on delete set null (diver_id),
  add constraint leads_join_request_fk foreign key (organization_id, join_request_id)
    references join_requests (organization_id, id) on delete set null (join_request_id);
--> statement-breakpoint
alter table inbound_messages
  add constraint inbound_messages_lead_fk foreign key (organization_id, lead_id)
    references leads (organization_id, id) on delete set null (lead_id);
--> statement-breakpoint
alter table leads enable row level security;
--> statement-breakpoint
grant select, insert, update, delete on leads to authenticated, rswim_system;
--> statement-breakpoint
create policy leads_office on leads for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
--> statement-breakpoint
create trigger set_updated_at before update on leads for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger audit_row after insert or update or delete on leads for each row execute function app.audit_row();
--> statement-breakpoint

-- ─── Moving a lead along ────────────────────────────────────────────────────
-- A stage only moves forward (new < talking < trial_booked < joined); a lost lead comes back when it acts again.
-- The same rule in TypeScript is leadStageAfter() in @rswim/domain-crm (the WhatsApp path).
create or replace function app.lead_stage_rank(p_stage text) returns int
language sql immutable as $$
  select case p_stage when 'new' then 1 when 'talking' then 2 when 'trial_booked' then 3 when 'joined' then 4
                      else 0 end
$$;
--> statement-breakpoint

-- Opens or moves the lead of one phone. It runs with its caller's rights: the triggers below are security definer
-- (a family's own sign-in sends a join request, and only the office may read leads), anyone else meets RLS.
create or replace function app.touch_lead(
  p_org uuid, p_phone text, p_name text, p_source text, p_stage text,
  p_household uuid default null, p_diver uuid default null, p_join_request uuid default null,
  p_create boolean default true
) returns uuid
language plpgsql set search_path = public, pg_temp as $$
declare
  l leads;
begin
  if p_phone is null then return null; end if;
  select * into l from leads where organization_id = p_org and phone_e164 = p_phone for update;
  if l.id is null then
    if not p_create then return null; end if;
    insert into leads (organization_id, name, phone_e164, source, stage, household_id, diver_id, join_request_id)
      values (p_org, p_name, p_phone, p_source, p_stage, p_household, p_diver, p_join_request)
      returning * into l;
    return l.id;
  end if;
  update leads set
    name = coalesce(leads.name, p_name),
    household_id = coalesce(p_household, leads.household_id),
    diver_id = coalesce(p_diver, leads.diver_id),
    join_request_id = coalesce(p_join_request, leads.join_request_id),
    stage = case when leads.stage = 'lost' or app.lead_stage_rank(p_stage) > app.lead_stage_rank(leads.stage)
                 then p_stage else leads.stage end,
    lost_reason = case when leads.stage = 'lost' then null else leads.lost_reason end,
    stage_changed_at = case when leads.stage = 'lost' or app.lead_stage_rank(p_stage) > app.lead_stage_rank(leads.stage)
                            then now() else leads.stage_changed_at end
  where id = l.id;
  return l.id;
end $$;
--> statement-breakpoint

-- A join request (the app's link, QR or search) opens the lead or brings it back; accepting it makes a customer.
create or replace function app.lead_from_join_request() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform app.touch_lead(new.organization_id, new.phone_e164, new.first_name || ' ' || new.last_name, 'join_link',
                           case when new.kind = 'trial' then 'talking' else 'new' end, null, null, new.id);
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform app.touch_lead(new.organization_id, new.phone_e164, new.first_name || ' ' || new.last_name, 'join_link',
                           'joined', (select household_id from guardians where id = new.guardian_id), null, new.id);
  end if;
  return null;
end $$;
--> statement-breakpoint
create trigger lead_from_join_request after insert or update of status on join_requests
  for each row execute function app.lead_from_join_request();
--> statement-breakpoint

-- A family the office opens with a lead's phone: the lead is linked to it (not a customer until a trial or a group).
create or replace function app.lead_from_guardian() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.touch_lead(new.organization_id, new.phone_e164, null, 'other', 'talking', new.household_id, null, null,
                         false);
  return null;
end $$;
--> statement-breakpoint
create trigger lead_from_guardian after insert or update of phone_e164 on guardians
  for each row execute function app.lead_from_guardian();
--> statement-breakpoint

-- A trial lesson booked for the family's child, and a child placed in a group, move the family's lead.
create or replace function app.lead_from_enrollment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g record;
  target text := case when new.status = 'active' then 'joined'
                      when new.status = 'trial_booked' then 'trial_booked' end;
begin
  if target is null then return null; end if;
  for g in select gu.phone_e164, gu.household_id from guardians gu join students s on s.household_id = gu.household_id
           where s.id = new.student_id and gu.organization_id = new.organization_id and gu.phone_e164 is not null loop
    perform app.touch_lead(new.organization_id, g.phone_e164, null, 'other', target, g.household_id, null, null, false);
  end loop;
  return null;
end $$;
--> statement-breakpoint
create trigger lead_from_enrollment after insert or update of status on enrollments
  for each row execute function app.lead_from_enrollment();
--> statement-breakpoint

-- A diver on the club's books with a lead's phone has joined.
create or replace function app.lead_from_diver() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.touch_lead(new.organization_id, new.phone_e164, new.first_name || ' ' || new.last_name, 'other',
                         'joined', null, new.id, null, false);
  return null;
end $$;
--> statement-breakpoint
create trigger lead_from_diver after insert or update of phone_e164 on dive_divers
  for each row execute function app.lead_from_diver();
