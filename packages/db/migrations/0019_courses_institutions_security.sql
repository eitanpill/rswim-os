-- Phase 8 security layer for course and camp cohorts and for institutions (contracts, invoices, payments).

-- ─── FKs drizzle cannot express (composite with SET NULL on one column) ─────
alter table class_templates
  add constraint class_templates_cohort_fk foreign key (organization_id, cohort_id)
    references cohorts (organization_id, id) on delete set null (cohort_id);
create index class_templates_cohort on class_templates (cohort_id) where cohort_id is not null;
--> statement-breakpoint

-- ─── Triggers ───────────────────────────────────────────────────────────────
-- A payment is a fact: only the worker may add the receipt it printed, nothing else changes.
create or replace function app.guard_institution_payment() returns trigger
language plpgsql as $$
begin
  if (new.invoice_id, new.amount_agorot, new.paid_on, new.method, coalesce(new.reference, ''))
     is distinct from (old.invoice_id, old.amount_agorot, old.paid_on, old.method, coalesce(old.reference, '')) then
    raise exception 'institution payments are append-only' using errcode = '55000';
  end if;
  return new;
end $$;

create trigger guard_institution_payment before update on institution_payments
  for each row execute function app.guard_institution_payment();
create trigger forbid_delete before delete on institution_payments
  for each row execute function app.forbid_mutation();
create trigger audit_row after insert or update or delete on institution_payments
  for each row execute function app.audit_row();
create trigger audit_row after insert or update or delete on cohort_staff
  for each row execute function app.audit_row();
create trigger audit_row after insert or update or delete on institution_contract_groups
  for each row execute function app.audit_row();

do $$
declare t text;
begin
  foreach t in array array['cohorts', 'institutions', 'institution_contracts', 'institution_invoices'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
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
-- Cohorts: the office manages them; every staff member reads them (instructors and counselors see their camp week).
create policy cohorts_office on cohorts for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy cohorts_read on cohorts for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_staff()));

create policy cohort_staff_office on cohort_staff for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy cohort_staff_read on cohort_staff for select to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_staff()));

-- Institutions: the office manages them; whoever may read billing (the accountant) reads them.
do $$
declare t text;
begin
  foreach t in array array['institutions', 'institution_contracts', 'institution_contract_groups',
                           'institution_invoices'] loop
    execute format($p$create policy %1$s_office on %1$I for all to authenticated, rswim_system
      using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
      with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))$p$, t);
    execute format($p$create policy %1$s_read on %1$I for select to authenticated
      using (organization_id = (select app.current_org()) and (select app.has_permission('billing.read')))$p$, t);
  end loop;
end $$;

-- Payments: the office records them, the worker adds the receipt, nobody deletes.
create policy institution_payments_select on institution_payments for select to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and ((select app.is_owner_or_admin()) or (select app.has_permission('billing.read'))));
create policy institution_payments_insert on institution_payments for insert to authenticated, rswim_system
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
create policy institution_payments_receipt on institution_payments for update to rswim_system
  using (organization_id = (select app.current_org()))
  with check (organization_id = (select app.current_org()));
