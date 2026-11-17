-- SaaS stage 5: a business brings its data in from a file (Excel, CSV or a Google sheet).
--
-- import_runs (until now only the GHL contacts import) also holds a file import: the uploaded table while the owner
-- maps its columns (status draft), what was created when it was saved, and when it was taken back (undone). The table
-- is cleared of the file's rows once it is saved or abandoned; only counts and the report stay.

alter table import_runs add column file_name text;--> statement-breakpoint
alter table import_runs add column source jsonb;--> statement-breakpoint
alter table import_runs add column mapping jsonb not null default '{}';--> statement-breakpoint
alter table import_runs add column created jsonb not null default '{}';--> statement-breakpoint
alter table import_runs add column committed_at timestamptz;--> statement-breakpoint
alter table import_runs add column undone_at timestamptz;--> statement-breakpoint
alter table import_runs drop constraint import_runs_status_check;--> statement-breakpoint
alter table import_runs add constraint import_runs_status_check
  check (status in ('draft', 'running', 'succeeded', 'failed', 'undone'));--> statement-breakpoint

-- A family's balance from its old system is one ledger entry with source 'import'.
alter table ledger_entries drop constraint ledger_entries_source_check;--> statement-breakpoint
alter table ledger_entries add constraint ledger_entries_source_check
  check (source in ('billing_run', 'manual', 'trial_offset', 'closure_credit', 'payment', 'refund', 'reversal', 'import'));--> statement-breakpoint

-- The ledger stays append-only, with one exception: taking an import back removes the families it created, and an
-- opening balance it brought in goes with its family (and only then: the family row is already gone when the cascade
-- reaches the entry). Any other entry still blocks the family's removal, so a family with real activity stays.
create or replace function app.guard_ledger_entry() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and app.org_deleted(old.organization_id) then
    return old;
  end if;
  if tg_op = 'DELETE' and old.source = 'import'
     and not exists (select 1 from households h where h.id = old.household_id) then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;--> statement-breakpoint
drop trigger ledger_entries_append_only on ledger_entries;--> statement-breakpoint
create trigger ledger_entries_append_only before update or delete on ledger_entries
  for each row execute function app.guard_ledger_entry();--> statement-breakpoint

-- The office asks imported families to sign a new standing order: a WhatsApp template with their personal link.
alter table automation_rules drop constraint automation_rules_template_check;--> statement-breakpoint
alter table message_templates drop constraint message_templates_key_check;--> statement-breakpoint
alter table messages drop constraint messages_template_check;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_template_check" CHECK (template_key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'transport_left_school', 'transport_arrived_pool', 'transport_left_pool', 'transport_dropped_off', 'venue_migration', 'venue_migration_reverted', 'bot_handoff', 'dive_reminder', 'mandate_request', 'free_text'));--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_key_check" CHECK (key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'transport_left_school', 'transport_arrived_pool', 'transport_left_pool', 'transport_dropped_off', 'venue_migration', 'venue_migration_reverted', 'bot_handoff', 'dive_reminder', 'mandate_request', 'free_text'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_check" CHECK (template_key in ('trial_confirmation', 'private_confirmation', 'enrollment_welcome', 'lesson_reminder', 'absence_received', 'absence_received_no_makeup', 'makeup_confirmed', 'instructor_change', 'closure_notice', 'reopening_makeups', 'last_call_makeups', 'payment_link', 'payment_failed', 'receipt_ready', 'progress_card', 'freeze_approved', 'cancellation_confirmed', 'holiday_schedule', 'transport_left_school', 'transport_arrived_pool', 'transport_left_pool', 'transport_dropped_off', 'venue_migration', 'venue_migration_reverted', 'bot_handoff', 'dive_reminder', 'mandate_request', 'free_text'));
-- Taking an import back removes only what nobody has used since: a row is "in use" when any other table points at it
-- (a booking, a lesson, a payment, a message...), except the tables the caller names (the import's own rows).
-- Security definer so rows the office cannot read still count; it answers only yes or no for one id of its own org.
create or replace function app.referenced_elsewhere(target regclass, row_id uuid, ignore text[] default '{}')
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r record;
  hit boolean;
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    cross join lateral unnest(c.conkey, c.confkey) as k(child, parent)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.child
    join pg_attribute p on p.attrelid = c.confrelid and p.attnum = k.parent
    where c.contype = 'f' and c.confrelid = target and p.attname = 'id'
      and not (c.conrelid::regclass::text = any (ignore))
  loop
    execute format('select exists (select 1 from %s where %I = $1 and organization_id = $2)', r.tbl, r.col)
      into hit using row_id, app.definer_org();
    if hit then return true; end if;
  end loop;
  return false;
end $$;--> statement-breakpoint
revoke all on function app.referenced_elsewhere(regclass, uuid, text[]) from public;--> statement-breakpoint
grant execute on function app.referenced_elsewhere(regclass, uuid, text[]) to authenticated, rswim_system;
