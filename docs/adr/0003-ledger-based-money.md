# ADR-0003: Append-only ledger for money

- Status: Accepted
- Date: 2026-10-01

## Context
The owner's words: "many people who shouldn't have paid were charged, and many who should pay didn't." Credits, partial refunds via Bit, cash collected by staff, prepaid balances and closure credits are all tracked by memory today. We need balances that are always explainable and auditable.

## Decision
- One table `ledger_entries` per tenant, **append-only** (no UPDATE/DELETE; enforced by trigger and RLS).
- Columns: `id, organization_id, household_id, student_id?, enrollment_id?, entry_type, amount_agorot (signed int), period (date, first of month)?, occurred_at, source_type, source_id, policy_version_id?, reverses_entry_id?, memo, created_by`.
- Sign convention: **positive = household owes more (debit), negative = household owes less (credit)**. Balance = `sum(amount_agorot)`; > 0 means debt, < 0 means credit on account.
- `entry_type`: `charge`, `discount`, `proration_adjustment`, `payment`, `refund`, `credit_note`, `closure_credit`, `goodwill_credit`, `write_off`, `opening_balance`, `reversal`, `transfer` (between households, e.g. institution-paid).
- Corrections are a `reversal` entry pointing at the original plus a new correct entry.
- Money type: `Agorot` branded integer in `packages/money`; all arithmetic in integers; percentage discounts round half-up to the agora, rule documented in POLICIES.md.
- `payments` and `documents_fiscal` (receipts, credit notes) reference ledger entries; a payment creates exactly one `payment` entry; a refund creates one `refund` entry.
- Balances, debts aging and statements are **views**, never stored. A nightly job snapshots balances for reporting only.
- Every charge entry stores the `policy_version_id` and a JSON `explanation` (inputs + rule path) to answer "why was I charged?".

## Consequences
- No "edit balance" button anywhere. Opening balances at go-live are `opening_balance` entries.
- Billing runs are reproducible: re-running a month computes a diff against existing entries and only posts adjustments.
