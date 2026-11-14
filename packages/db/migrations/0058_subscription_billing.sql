-- SaaS stage 3: a school's subscription paid by its owner's own card (saved at the platform's processor without a
-- charge), billed monthly with a prorated first month after the trial, retried on decline, with a tax invoice per
-- payment (Morning) and self-service plan change and cancellation.

-- ─── The subscription ───────────────────────────────────────────────────────
alter table org_subscriptions
  add column card_last4 text,
  add column card_saved_at timestamptz,
  -- The last day the school is served; the next morning it is cancelled. Null = renews.
  add column cancels_on date,
  -- Who the tax invoice is made out to (defaults: the school's name, the owner's email).
  add column billing_name text,
  add column billing_tax_id text,
  add column billing_email text,
  add constraint org_subscriptions_card_last4_check check (card_last4 ~ '^\d{4}$'),
  add constraint org_subscriptions_billing_name_check check (char_length(billing_name) between 2 and 120),
  add constraint org_subscriptions_billing_tax_id_check check (billing_tax_id ~ '^\d{5,9}$'),
  add constraint org_subscriptions_billing_email_check check (billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
--> statement-breakpoint

-- How the platform retries a declined charge: every N days, at most M attempts (configuration, not code).
alter table plans
  add column retry_every_days smallint not null default 3,
  add column max_charge_attempts smallint not null default 4,
  add constraint plans_retry_check check (retry_every_days between 1 and 30 and max_charge_attempts between 1 and 10);
--> statement-breakpoint

-- ─── The platform's invoices ────────────────────────────────────────────────
alter table platform_invoices
  -- The first day the invoice covers (the day after the trial for a prorated first month; else the 1st).
  add column covers_from date,
  add column last_attempt_on date,
  -- The tax invoice-receipt issued for the payment.
  add column document_id text,
  add column document_number text,
  add column document_url text;
update platform_invoices set covers_from = period where covers_from is null;
alter table platform_invoices alter column covers_from set not null;
alter table platform_invoices
  add constraint platform_invoices_covers_check
    check (covers_from >= period and covers_from < (period + interval '1 month')::date);
--> statement-breakpoint

-- ─── Saving a card ──────────────────────────────────────────────────────────
-- One visit to the processor's card page. The callback finds the school by this row's id (the processor echoes it),
-- so a card can only ever land on the school whose owner opened the page.
create table platform_card_setups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  status text not null default 'open',
  external_id text,
  failure_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint platform_card_setups_status_check check (status in ('open', 'saved', 'failed'))
);
create index platform_card_setups_org on platform_card_setups (organization_id, created_at desc);
alter table platform_card_setups enable row level security;
create trigger audit_row after insert or update or delete on platform_card_setups
  for each row execute function app.audit_row();
--> statement-breakpoint

-- The owner (only the owner: the card pays the business's bill) reads and opens them; nobody signed in completes one.
-- The processor's verified callback completes it as platform plumbing.
create policy platform_card_setups_read on platform_card_setups for select to authenticated
  using ((organization_id = (select app.current_org()) and (select app.is_owner()))
         or (select app.is_platform_admin()));
create policy platform_card_setups_open on platform_card_setups for insert to authenticated
  with check (organization_id = (select app.current_org()) and (select app.is_owner())
              and status = 'open' and created_by = (select app.current_user_id()));
-- The owner notes the processor's id for the visit she opened (that column only, while it is open).
create policy platform_card_setups_note on platform_card_setups for update to authenticated
  using (organization_id = (select app.current_org()) and (select app.is_owner()) and status = 'open')
  with check (organization_id = (select app.current_org()) and status = 'open');
grant select, insert on platform_card_setups to authenticated;
grant update (external_id) on platform_card_setups to authenticated;
--> statement-breakpoint

-- ─── The owner's own changes ────────────────────────────────────────────────
create or replace function app.assert_owner_subscription() returns org_subscriptions
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s org_subscriptions;
begin
  if not app.is_owner() then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  select * into s from org_subscriptions where organization_id = app.current_org();
  if s.organization_id is null then
    raise exception 'platform.errors.noSubscription' using errcode = 'RSW01';
  end if;
  return s;
end $$;
--> statement-breakpoint

-- A plan change takes effect now; the new price applies from the next invoice. The size check (a downgrade below
-- what the school uses) runs in the service and again in the limits trigger on every insert.
create or replace function public.owner_change_plan(p_plan text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s org_subscriptions;
begin
  s := app.assert_owner_subscription();
  if s.status in ('suspended', 'cancelled') then
    raise exception 'platform.errors.renewFirst' using errcode = 'RSW01';
  end if;
  if not exists (select 1 from plans where code = p_plan and active) then
    raise exception 'platform.errors.plan' using errcode = 'RSW01';
  end if;
  update org_subscriptions set plan_code = p_plan where organization_id = s.organization_id;
end $$;
--> statement-breakpoint

-- Cancel (served to p_last_day, then cancelled), keep (undo a cancellation), or renew a cancelled subscription
-- (active again from today; the worker bills the rest of the month).
create or replace function public.owner_subscription_action(p_action text, p_last_day date default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s org_subscriptions;
  today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  s := app.assert_owner_subscription();
  if p_action = 'cancel' then
    if s.status in ('cancelled', 'suspended') then
      raise exception 'platform.errors.notCancellable' using errcode = 'RSW01';
    end if;
    if p_last_day is null or p_last_day < today then
      raise exception 'platform.errors.period' using errcode = 'RSW01';
    end if;
    update org_subscriptions set cancels_on = p_last_day where organization_id = s.organization_id;
  elsif p_action = 'keep' then
    update org_subscriptions set cancels_on = null where organization_id = s.organization_id;
  elsif p_action = 'renew' then
    if s.status <> 'cancelled' then
      raise exception 'platform.errors.notCancelled' using errcode = 'RSW01';
    end if;
    update org_subscriptions set status = 'active', cancels_on = null, past_due_since = null
      where organization_id = s.organization_id;
    insert into outbox (organization_id, event_type, payload, idempotency_key)
      values (s.organization_id, 'platform.billing_due',
              jsonb_build_object('period', date_trunc('month', today)::date, 'from', today,
                                 'requestedBy', app.current_user_id()),
              format('platform.billing_due:%s:renew:%s', s.organization_id,
                     (extract(epoch from clock_timestamp()) * 1000)::bigint));
  else
    raise exception 'common.errors.invalid' using errcode = 'RSW01';
  end if;
end $$;
--> statement-breakpoint

create or replace function public.owner_billing_details(p_name text, p_tax_id text, p_email text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s org_subscriptions;
begin
  s := app.assert_owner_subscription();
  update org_subscriptions
    set billing_name = nullif(btrim(p_name), ''),
        billing_tax_id = nullif(btrim(p_tax_id), ''),
        billing_email = nullif(btrim(lower(p_email)), '')
    where organization_id = s.organization_id;
end $$;
--> statement-breakpoint

-- The processor's verified callback: the card lands on the setup's school (never another), and a school that owes
-- money is charged again right away.
create or replace function public.complete_card_setup(
  p_setup uuid, p_ok boolean, p_mandate text, p_last4 text, p_reason text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cs platform_card_setups;
  owed date;
begin
  select * into cs from platform_card_setups where id = p_setup for update;
  if cs.id is null then raise exception 'platform.errors.cardSetup' using errcode = 'RSW01'; end if;
  if cs.status <> 'open' then return cs.organization_id; end if; -- a redelivery
  if not p_ok then
    update platform_card_setups set status = 'failed', failure_reason = left(p_reason, 200), completed_at = now()
      where id = cs.id;
    return cs.organization_id;
  end if;
  update platform_card_setups set status = 'saved', completed_at = now() where id = cs.id;
  update org_subscriptions
    set mandate_id = p_mandate, card_last4 = p_last4, card_saved_at = now()
    where organization_id = cs.organization_id;
  select period into owed from platform_invoices
    where organization_id = cs.organization_id and status in ('failed', 'open')
    order by period desc limit 1;
  if owed is not null then
    insert into outbox (organization_id, event_type, payload, idempotency_key)
      values (cs.organization_id, 'platform.billing_due',
              jsonb_build_object('period', owed, 'reason', 'cardSaved'),
              format('platform.billing_due:%s:card:%s', cs.organization_id, cs.id));
  end if;
  return cs.organization_id;
end $$;
--> statement-breakpoint

revoke execute on function app.assert_owner_subscription() from public, anon;
revoke execute on function public.owner_change_plan(text) from public, anon;
revoke execute on function public.owner_subscription_action(text, date) from public, anon;
revoke execute on function public.owner_billing_details(text, text, text) from public, anon;
revoke execute on function public.complete_card_setup(uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function app.assert_owner_subscription() to authenticated;
grant execute on function public.owner_change_plan(text) to authenticated;
grant execute on function public.owner_subscription_action(text, date) to authenticated;
grant execute on function public.owner_billing_details(text, text, text) to authenticated;
