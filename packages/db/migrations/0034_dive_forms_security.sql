-- Freediving forms: the club's health declaration, liability waiver and insurance, signed by the diver (online or on
-- the desk's tablet). The database fills in everything that must not come from the signer: the hash of the exact
-- text, the time, who recorded it, whether a health answer waits for the club's clearance and until when the
-- signature counts. The diver's file follows the signatures (waiver date, medical and insurance expiry).

-- ─── Helpers ────────────────────────────────────────────────────────────────
-- The club's paperwork rules in force today (rules.paperwork), with the defaults of DEFAULT_DIVE_RULES.
create or replace function app.dive_paperwork_months(org uuid, what text) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select (r.rules -> 'paperwork' ->> what)::int from dive_rule_sets r
    where r.organization_id = org and r.effective_from <= app.today()
    order by r.effective_from desc limit 1), 12)
$$;
--> statement-breakpoint

-- ─── Templates: a published version is frozen ───────────────────────────────
create or replace function app.guard_dive_form_template() returns trigger
language plpgsql as $$
begin
  if old.published_at is not null and not app.org_deleted(old.organization_id) then
    raise exception 'dive.errors.formLocked' using errcode = 'RSW01';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger guard_dive_form_template before update or delete on dive_form_templates
  for each row execute function app.guard_dive_form_template();
--> statement-breakpoint

-- ─── Signing ────────────────────────────────────────────────────────────────
-- Security invoker on purpose: it tells the signer's session apart from seeding (app.is_system, current_user).
create or replace function app.dive_form_signature_fill() returns trigger
language plpgsql as $$
declare
  tpl dive_form_templates;
  q jsonb;
  a text;
  flagged boolean := false;
  signed_day date;
begin
  select * into tpl from dive_form_templates
    where id = new.template_id and organization_id = new.organization_id;
  if tpl.id is null or tpl.published_at is null then
    raise exception 'dive.errors.formNotPublished' using errcode = 'RSW01';
  end if;
  new.kind := tpl.kind;
  new.text_hash := encode(sha256(convert_to(tpl.title || E'\n\n' || tpl.body, 'UTF8')), 'hex');
  -- Signed now, by the signed-in person. (Only seeding and migrations, outside a user session, may backdate.)
  if current_user in ('authenticated', 'rswim_system') or new.signed_at is null then
    new.signed_at := now();
    new.recorded_by := app.current_user_id();
  end if;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;
  if app.is_customer() then
    new.channel := 'online';
  end if;
  if length(btrim(coalesce(new.signer_name, ''))) < 2 then
    raise exception 'dive.errors.signerName' using errcode = 'RSW01';
  end if;
  if jsonb_typeof(new.signature) <> 'array' or jsonb_array_length(new.signature) = 0
     or pg_column_size(new.signature) > 200000 then
    raise exception 'dive.errors.signatureMissing' using errcode = 'RSW01';
  end if;

  -- Every question answered yes or no; a "yes" on a flagged question waits for the club.
  for q in select * from jsonb_array_elements(tpl.questions) loop
    a := new.answers ->> (q ->> 'code');
    if a is null or a not in ('yes', 'no') then
      raise exception 'dive.errors.formIncomplete' using errcode = 'RSW01';
    end if;
    if a = 'yes' and coalesce((q ->> 'flag')::boolean, false) then flagged := true; end if;
  end loop;
  new.review := case when flagged then 'pending' else 'none' end;

  signed_day := (new.signed_at at time zone 'Asia/Jerusalem')::date;
  if tpl.kind = 'health' then
    new.valid_until := (signed_day + make_interval(months => app.dive_paperwork_months(new.organization_id, 'medical_valid_months')))::date;
    new.insurer := null;
    new.policy_number := null;
  elsif tpl.kind = 'waiver' then
    new.valid_until := (signed_day + make_interval(months => app.dive_paperwork_months(new.organization_id, 'waiver_valid_months')))::date;
    new.insurer := null;
    new.policy_number := null;
    new.file_id := null;
  else
    if new.valid_until is null or new.valid_until < signed_day then
      raise exception 'dive.errors.insuranceExpired' using errcode = 'RSW01';
    end if;
    if length(btrim(coalesce(new.insurer, ''))) = 0 or length(btrim(coalesce(new.policy_number, ''))) = 0 then
      raise exception 'dive.errors.formIncomplete' using errcode = 'RSW01';
    end if;
  end if;
  return new;
end $$;

-- After signing, only the club's medical review of a pending health declaration may change: by the office, once.
create or replace function app.guard_dive_form_signature() returns trigger
language plpgsql as $$
declare keep dive_form_signatures;
begin
  if tg_op = 'DELETE' then
    if app.org_deleted(old.organization_id) then return old; end if;
    raise exception 'dive_form_signatures is append-only' using errcode = 'insufficient_privilege';
  end if;
  if not app.is_owner_or_admin() then
    raise exception 'common.errors.forbidden' using errcode = 'RSW01';
  end if;
  if old.review <> 'pending' or new.review not in ('cleared', 'refused') then
    raise exception 'dive.errors.reviewNotPending' using errcode = 'RSW01';
  end if;
  keep := old;
  keep.review := new.review;
  keep.review_note := nullif(btrim(coalesce(new.review_note, '')), '');
  keep.file_id := coalesce(new.file_id, old.file_id);
  keep.reviewed_by := app.current_user_id();
  keep.reviewed_at := now();
  return keep;
end $$;

-- The diver's file follows their signatures: the latest waiver's day, the furthest medical that counts (clean or
-- cleared by the club) and the latest insurance policy's end. Only the touched kind is recomputed, so dates the desk
-- typed in before forms existed stay until a form replaces them.
create or replace function app.dive_form_apply() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'waiver' then
    update dive_divers set waiver_signed_on = (
      select max((s.signed_at at time zone 'Asia/Jerusalem')::date) from dive_form_signatures s
      where s.diver_id = new.diver_id and s.kind = 'waiver')
    where id = new.diver_id;
  elsif new.kind = 'health' and new.review in ('none', 'cleared') then
    update dive_divers set medical_expires_on = greatest(medical_expires_on, new.valid_until)
    where id = new.diver_id;
  elsif new.kind = 'insurance' then
    update dive_divers set insurance_expires_on = new.valid_until where id = new.diver_id;
  end if;
  return new;
end $$;

create trigger dive_form_signature_fill before insert on dive_form_signatures
  for each row execute function app.dive_form_signature_fill();
create trigger guard_dive_form_signature before update or delete on dive_form_signatures
  for each row execute function app.guard_dive_form_signature();
create trigger dive_form_apply after insert or update on dive_form_signatures
  for each row execute function app.dive_form_apply();
--> statement-breakpoint

-- A customer's paperwork dates now come only from signed forms; they still edit their own contact details.
create or replace function app.guard_dive_diver() returns trigger
language plpgsql as $$
declare keep dive_divers;
begin
  if current_user = 'authenticated' and app.is_customer() then
    keep := old;
    keep.emergency_name := new.emergency_name;
    keep.emergency_phone := new.emergency_phone;
    keep.phone_e164 := new.phone_e164;
    keep.email := new.email;
    keep.updated_at := now();
    return keep;
  end if;
  return new;
end $$;
--> statement-breakpoint

create trigger set_updated_at before update on dive_form_templates
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on dive_form_templates
  for each row execute function app.audit_row();
create trigger audit_row after insert or update or delete on dive_form_signatures
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
alter table dive_form_templates enable row level security;
alter table dive_form_signatures enable row level security;

-- Templates: the whole staff reads them; the owner and the manager (settings) write them; a customer reads the
-- published ones.
create policy dive_form_templates_staff_read on dive_form_templates for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin()) or (select app.is_instructor())));
create policy dive_form_templates_write on dive_form_templates for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.has_permission('settings.write')))
  with check (organization_id = (select app.current_org()) and (select app.has_permission('settings.write')));
create policy dive_form_templates_customer_read on dive_form_templates for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_customer()) and published_at is not null);

-- Signatures: the office records (desk signing) and reviews; instructors read (safety); a customer signs and reads
-- only their own.
create policy dive_form_signatures_office on dive_form_signatures for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy dive_form_signatures_instructor_read on dive_form_signatures for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_instructor()));
create policy dive_form_signatures_customer_read on dive_form_signatures for select to authenticated
  using (organization_id = (select app.current_org()) and diver_id in (select app.dive_my_diver_ids()));
create policy dive_form_signatures_customer_sign on dive_form_signatures for insert to authenticated
  with check (organization_id = (select app.current_org()) and diver_id in (select app.dive_my_diver_ids()));

-- Files: a customer uploads their own documents (insurance policy, doctor's note, certification card) and sees only
-- what they uploaded. Staff keep their existing access.
create policy files_customer_own on files for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_customer())
         and created_by = (select app.current_user_id()));
create policy files_customer_upload on files for insert to authenticated
  with check (organization_id = (select app.current_org()) and (select app.is_customer())
              and created_by = (select app.current_user_id()) and purpose like 'dive\_%');
