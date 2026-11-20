-- Lodging (docs/LODGING.md): rooms, beds and stays are the office's (owner and admins: a school's office, a club's
-- manager and front desk) and the tenant's worker. The database keeps a room or a bed from being sold twice.

alter table lodging_stays
  add constraint lodging_stays_lead_fk foreign key (organization_id, lead_id)
    references leads (organization_id, id) on delete set null (lead_id);
--> statement-breakpoint
alter table lodging_settings enable row level security;
--> statement-breakpoint
alter table lodging_rooms enable row level security;
--> statement-breakpoint
alter table lodging_beds enable row level security;
--> statement-breakpoint
alter table lodging_stays enable row level security;
--> statement-breakpoint
grant select, insert, update, delete on lodging_settings, lodging_rooms, lodging_beds, lodging_stays
  to authenticated, rswim_system;
--> statement-breakpoint
create policy lodging_settings_office on lodging_settings for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
--> statement-breakpoint
create policy lodging_rooms_office on lodging_rooms for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
--> statement-breakpoint
create policy lodging_beds_office on lodging_beds for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
--> statement-breakpoint
create policy lodging_stays_office on lodging_stays for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
--> statement-breakpoint
create trigger set_updated_at before update on lodging_settings for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on lodging_rooms for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on lodging_stays for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger audit_row after insert or update or delete on lodging_rooms for each row execute function app.audit_row();
--> statement-breakpoint
create trigger audit_row after insert or update or delete on lodging_stays for each row execute function app.audit_row();
--> statement-breakpoint

-- ─── One guest per room or bed per night ───────────────────────────────────
-- A whole-room stay takes every bed of the room; a bed's stay takes that bed (and so blocks a whole-room stay).
-- Stays lock their room first, so two desks booking the last bed at once cannot both win. Cancelled stays hold nothing.
-- The same rules in TypeScript are stayProblem() and freeOptions() in @rswim/domain-lodging (for messages ahead).
create or replace function app.lodging_stay_check() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  r lodging_rooms;
  b lodging_beds;
begin
  if new.status = 'cancelled' then return new; end if;
  select * into r from lodging_rooms where organization_id = new.organization_id and id = new.room_id;
  if new.bed_id is not null then
    select * into b from lodging_beds where organization_id = new.organization_id and id = new.bed_id;
    if b.room_id is distinct from new.room_id then
      raise exception 'lodging.errors.bedNotInRoom' using errcode = 'RSW01';
    end if;
    if new.guests <> 1 then
      raise exception 'lodging.errors.bedOneGuest' using errcode = 'RSW01';
    end if;
  elsif new.guests > r.max_guests then
    raise exception 'lodging.errors.tooManyGuests' using errcode = 'RSW01';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.room_id::text, 0));
  if exists (
    select 1 from lodging_stays s
    where s.organization_id = new.organization_id and s.room_id = new.room_id and s.id <> new.id
      and s.status <> 'cancelled'
      and daterange(s.check_in, s.check_out) && daterange(new.check_in, new.check_out)
      and (new.bed_id is null or s.bed_id is null or s.bed_id = new.bed_id)
  ) then
    raise exception 'lodging.errors.taken' using errcode = 'RSW01';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger lodging_stay_check before insert or update of room_id, bed_id, guests, check_in, check_out, status
  on lodging_stays for each row execute function app.lodging_stay_check();
--> statement-breakpoint

-- A guest who leaves leaves a room to clean.
create or replace function app.lodging_stay_out() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'checked_out' and old.status is distinct from 'checked_out' then
    update lodging_rooms set housekeeping = 'dirty'
      where organization_id = new.organization_id and id = new.room_id and housekeeping = 'clean';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger lodging_stay_out after update of status on lodging_stays
  for each row execute function app.lodging_stay_out();
