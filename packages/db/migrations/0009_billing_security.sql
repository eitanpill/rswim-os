-- Phase 4 security layer: FKs drizzle cannot express, the data-key accessor, the append-only ledger, frozen posted
-- runs, triggers, grants and RLS for the money tables.

-- ─── FKs with SET NULL on one column of a composite key ─────────────────────
alter table household_billing
  add constraint household_billing_profile_fk foreign key (organization_id, reimbursement_profile_id)
    references reimbursement_profiles (organization_id, id) on delete set null (reimbursement_profile_id);
alter table enrollment_freezes
  add constraint enrollment_freezes_file_fk foreign key (organization_id, file_id)
    references files (organization_id, id) on delete set null (file_id);
alter table billing_run_lines
  add constraint billing_run_lines_student_fk foreign key (organization_id, student_id)
    references students (organization_id, id) on delete set null (student_id),
  add constraint billing_run_lines_enrollment_fk foreign key (organization_id, enrollment_id)
    references enrollments (organization_id, id) on delete set null (enrollment_id),
  add constraint billing_run_lines_applies_to_fk foreign key (organization_id, applies_to_line_id)
    references billing_run_lines (organization_id, id) on delete set null (applies_to_line_id);
alter table payment_links
  add constraint payment_links_run_fk foreign key (organization_id, billing_run_id)
    references billing_runs (organization_id, id) on delete set null (billing_run_id);
alter table payments
  add constraint payments_run_fk foreign key (organization_id, billing_run_id)
    references billing_runs (organization_id, id) on delete set null (billing_run_id),
  add constraint payments_standing_order_fk foreign key (organization_id, standing_order_id)
    references standing_orders (organization_id, id) on delete set null (standing_order_id),
  add constraint payments_link_fk foreign key (organization_id, payment_link_id)
    references payment_links (organization_id, id) on delete set null (payment_link_id),
  add constraint payments_refund_of_fk foreign key (organization_id, refund_of_payment_id)
    references payments (organization_id, id) on delete set null (refund_of_payment_id),
  add constraint payments_staff_fk foreign key (organization_id, received_by_staff_id)
    references staff_members (organization_id, id) on delete set null (received_by_staff_id),
  add constraint payments_proof_fk foreign key (organization_id, proof_file_id)
    references files (organization_id, id) on delete set null (proof_file_id);
alter table fiscal_documents
  add constraint fiscal_documents_payment_fk foreign key (organization_id, payment_id)
    references payments (organization_id, id) on delete set null (payment_id);
alter table dunning_cases
  add constraint dunning_cases_payment_fk foreign key (organization_id, payment_id)
    references payments (organization_id, id) on delete set null (payment_id);
--> statement-breakpoint

-- ─── The org's wrapped data key ─────────────────────────────────────────────
-- org_keys stays out of reach of signed-in users (infrastructure table). The office and the tenant's worker get the
-- wrapped key of their own organization only; unwrapping it needs RSWIM_MASTER_KEY, which only the server has.
create or replace function app.wrapped_dek() returns bytea
language sql stable security definer set search_path = public, pg_temp as $$
  select k.wrapped_dek from org_keys k
  where k.organization_id = app.definer_org()
    and (current_setting('role', true) = 'rswim_system'
         or coalesce((app.current_membership()).role in ('owner', 'admin'), false))
$$;
--> statement-breakpoint

-- ─── Triggers ───────────────────────────────────────────────────────────────
-- The ledger is append-only: corrections are new entries (ADR-0003, convention 7).
create trigger ledger_entries_append_only before update or delete on ledger_entries
  for each row execute function app.forbid_mutation_unless_org_deleted();

-- A posted run is history: it cannot be reopened, and its lines are frozen. A discarded run stays as it was.
create or replace function app.guard_billing_run() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and not app.org_deleted(old.organization_id) then
      raise exception 'billing.errors.runLocked' using errcode = 'RSW01';
    end if;
    return old;
  end if;
  if old.status <> 'draft' then
    raise exception 'billing.errors.runLocked' using errcode = 'RSW01';
  end if;
  return new;
end $$;
create trigger guard_billing_run before update or delete on billing_runs
  for each row execute function app.guard_billing_run();

create or replace function app.guard_billing_run_line() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  run_id uuid := case when tg_op = 'INSERT' then new.billing_run_id else old.billing_run_id end;
  st text;
begin
  select status into st from billing_runs where id = run_id;
  if st is not null and st <> 'draft' then
    raise exception 'billing.errors.runLocked' using errcode = 'RSW01';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger guard_billing_run_line before insert or update or delete on billing_run_lines
  for each row execute function app.guard_billing_run_line();

do $$
declare t text;
begin
  foreach t in array array['reimbursement_profiles', 'household_billing', 'enrollment_freezes',
                           'cancellation_requests', 'billing_runs', 'standing_orders', 'payment_links', 'payments',
                           'fiscal_documents', 'dunning_cases'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['reimbursement_profiles', 'household_billing', 'enrollment_freezes',
                           'cancellation_requests', 'billing_runs', 'standing_orders', 'payment_links', 'payments',
                           'ledger_entries', 'fiscal_documents', 'dunning_cases'] loop
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
-- Owner/admin (and the tenant's worker) manage every money table; the ledger's append-only trigger still applies.
-- The accountant reads them all. Families read their own household's money and their children's freezes and
-- cancellations; nobody else (instructors, escorts) sees money.
do $$
declare t text;
begin
  foreach t in array array['reimbursement_profiles', 'household_billing', 'enrollment_freezes',
                           'cancellation_requests', 'billing_runs', 'billing_run_lines', 'standing_orders',
                           'payment_links', 'payments', 'ledger_entries', 'fiscal_documents', 'dunning_cases'] loop
    execute format($f$
      create policy %1$s_write on %1$I for all to authenticated, rswim_system
        using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
        with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))$f$, t);
    execute format($f$
      create policy %1$s_accountant on %1$I for select to authenticated
        using (organization_id = (select app.current_org()) and (select app.current_app_role()) = 'accountant')$f$, t);
  end loop;
  foreach t in array array['household_billing', 'standing_orders', 'payment_links', 'payments', 'ledger_entries',
                           'fiscal_documents'] loop
    execute format($f$
      create policy %1$s_family on %1$I for select to authenticated
        using (organization_id = (select app.current_org())
               and household_id in (select app.guardian_household_ids()))$f$, t);
  end loop;
end $$;

create policy enrollment_freezes_family on enrollment_freezes for select to authenticated
  using (organization_id = (select app.current_org())
         and enrollment_id in (select e.id from enrollments e
                               where e.student_id in (select app.guardian_student_ids())));
create policy cancellation_requests_family on cancellation_requests for select to authenticated
  using (organization_id = (select app.current_org())
         and enrollment_id in (select e.id from enrollments e
                               where e.student_id in (select app.guardian_student_ids())));
