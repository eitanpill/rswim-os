# Phase 4 — Billing & Payments

## Goal
Money becomes a ledger the owner can trust. Each month a billing run drafts every household's charges from their
seats under the regulations: proration for mid-month starts and stops, freezes, the cancellation cut-off on the 25th,
sibling discounts, and credits from closures and trials. Before anything is charged, a review screen shows the
difference from last month and flags the mistakes Reut described: a charge without a seat, a seat without a charge,
two standing orders for one family, and amounts that jumped. Approving the run posts the charges and collects them by
standing order or payment link. A failed charge starts dunning. Every payment gets a legal invoice-receipt, with the
wording, ID number, session dates and payment method a reimbursement claim needs.

## Acceptance criteria (from the brief)
1. **Property-based tests on billing rules.** `fast-check` properties over the pure policies, for example:
   - proration never exceeds the monthly price and is monotonic in the remaining sessions;
   - the sibling discount never makes a line negative and never discounts the most expensive child under
     `cheapest_first`;
   - a statement's total equals the sum of its rounded lines;
   - the cancellation cut-off is decided by the Israel date, not UTC;
   - a balance is the sum of the ledger whatever the order of entries, and a reversal brings it back to zero.

   They run alongside 100% branch coverage of `packages/domain/billing/src/policies.ts`.
2. **The pre-run review flags (a) a charge without an enrollment, (b) an enrollment without a charge, (c) a duplicate
   mandate.** Integration tests draft a run over fixtures with each case and read the flags with their reasons. The
   E2E test opens the review screen of the demo seed's run and sees all three, each with a Hebrew reason.
3. **A failed charge triggers the dunning sequence.** A fake Grow webhook reports a failed standing-order charge. The
   payment turns `failed`, a dunning case opens, the update-card message is queued (`billing.dunning_step` for Phase 5
   to send), retries follow `dunning.first_retry_days` and `dunning.retry_interval_days`, and after `dunning.escalate_after_days` the owner gets the case. A
   later successful payment closes the case.
4. **A reimbursement receipt contains the wording, ID, dates and payment method.** A household in Ministry of Defense
   reimbursement mode pays for therapy. The invoice-receipt sent to the (fake) invoicing provider carries the
   profile's wording ("טיפולי הידרותרפיה"), the client's ID number, the session dates and the payment method, and is
   split per month when the profile says so.

## Scope

### 4.1 Database (migrations `0008_billing` + `0009_billing_security`)
- `reimbursement_profiles`: name, kind (ministry_of_defense, insurance, reservists, employer, other), line wording,
  which fields are required, and whether to split per month.
- `household_billing`: payer name, email, encrypted payer ID number, reimbursement profile, and the preferred method.
- `enrollment_freezes` (from, to, reason, status) and `cancellation_requests` (requested at, last charged month, policy
  version).
- `ledger_entries`: append-only. Columns:
  - `household_id`, plus `student_id` and `enrollment_id` when known
  - `type`: charge, discount, credit, payment, refund, write_off, adjustment
  - `amount_agorot`, signed: positive is owed, negative reduces what is owed
  - `period`, `description`, `source`, `billing_run_id`, `policy_version_key`
  - `idempotency_key`, unique
  - `reverses_entry_id`
- `billing_runs` (period, status draft → approved → posted, totals, anomalies) and `billing_run_lines`.
- Collection tables:
  - `standing_orders`: provider mandate per household, status, last failure.
  - `payments`: provider or manual, method, external id, status, attempt, recorded by, proof file.
  - `payment_links`
  - `fiscal_documents`: invoice-receipt or credit note, provider number, PDF URL, the exact lines and fields sent.
  - `dunning_cases`: stage, next action, attempts, a log of steps.
- Grow webhooks reuse `webhook_events` and are de-duplicated by event id.
- RLS:
  - Owner and admin may do everything.
  - The accountant reads money tables.
  - Parents read their own household's ledger, payments, links and documents.
  - The ledger is insert-only for everyone.

### 4.2 Policies (new keys)
- `billing.anomaly_change_bp`: how far an amount may move from last month before it is flagged. Default 3000 (30%).
- `dunning.first_retry_days` = `1`, `dunning.retry_interval_days` = `3`, `dunning.max_retries` = `3`,
  `dunning.escalate_after_days` = `10`, `dunning.pause_enrollment` = `false`. Scalars rather than a list of days,
  because the policy editor edits numbers.
- `receipts.split_per_month` comes from the reimbursement profile, not from policy.

### 4.3 Domain (`@rswim/domain-billing`)
- Pure (`policies.ts`):
  - `billingRulesFrom`
  - `cancellationEffectiveMonth`
  - `prorate`
  - `chargeForSeat`: one month, with sessions, freezes and cancellation as inputs
  - `chargeForSlots`: private, pair, trio and therapy lessons, charged per booked slot in the month
  - `applySiblingDiscount`
  - `statementTotal`
  - `detectAnomalies`
  - `dunningNextStep`
  - `receiptDocument`: lines, wording, ID, dates, method, split per month
  - `balanceOf`
  - `agingBuckets`
- Services:
  - billing run: draft, review, approve, post
  - ledger: post, reverse, credit, write off
  - manual payments, with a cash handover note
  - refunds
  - payment links
  - standing orders: add, cancel, import, duplicates
  - freezes and cancellation requests
  - household statement
  - debts dashboard
  - Grow webhook ingest
  - dunning steps
  - receipts
- Consumers of Phase 3 events: `enrollment.trial_converted` becomes a credit for the offset, and
  `attendance.closure_credits_converted` becomes credits at the lesson's value.

### 4.4 Integrations
- `FakePaymentProvider` (Grow) and `FakeInvoicingProvider` (Green Invoice), with a fake webhook signer.
- Real adapters wait for Pit's accounts. The interfaces in `packages/integrations` stay the contract.

### 4.5 Worker
- Post an approved run.
- Charge households by standing order; send a payment link to households without one.
- Process Grow webhooks.
- Run dunning daily.
- Issue receipts on every successful payment.

### 4.6 Web
- Office:
  - **כספים**: billing runs, the review screen with anomalies and the diff from last month, approve.
  - Debts by age with collection actions.
- Family card: balance and ledger, recording a manual payment, credit or refund, the standing order, billing details
  with reimbursement mode, and freezes and cancellation with the cut-off decision shown.
- Settings: reimbursement profiles.
- Parent: **תשלומים** shows the balance, statements, pay now (payment link) and receipts.

### 4.7 Seed
September and October demo charges, including:
- a household with a duplicate standing order
- a household with a standing order but no seat
- a seat whose household has no mandate
- a reimbursement-mode household
- a family of four children with the sibling discount
- a failed charge with an open dunning case

All of it is fake.

## Out of scope (logged in DECISIONS)
- Real Grow and Green Invoice HTTP adapters. They need accounts and API keys from Pit, and are built against the
  provider docs when those arrive.
- Annual subscriptions and punch cards: the pure early-termination rule ships now, the products ship with Phase 8.
- Statement-of-account PDF: an HTML statement now, PDF with React-PDF in Phase 7 (parent portal).
