# ADR-0004: Versioned policy engine

- Status: Accepted
- Date: 2026-10-01

## Context
Every rule differs by venue/program and changes over time: cancellation cut-off (25th), notice windows (12h groups, 24h privates), makeup limits (1/month, same month), late threshold (10 min), sibling discount (10% or flat ₪30), summer-course exceptions, pension threshold (3 or 6 months). Hard-coding any of these guarantees bugs.

## Decision
- **`policy_sets`**: `id, organization_id, scope_type (org|venue|program|venue_program|class_template), scope_id?, effective_from, effective_to?, version, rules jsonb, created_by, notes`. `rules` is validated by a Zod schema (`PolicyRules`) in `packages/contracts`, versioned with a `schema_version` field.
- **Resolution**: for a given (org, venue, program, class_template, date) the engine picks the most specific scope active on that date, then deep-merges up the chain: `class_template > venue_program > program > venue > org`. The resolved object carries the list of contributing `policy_set` ids.
- **Pure functions** in `packages/domain/*/policies.ts`, each `(input, resolvedPolicy) => { decision, explanation }`:
  - `classifyAbsenceNotice()`, `canEarnMakeup()`, `canBookMakeup()`, `makeupExpiry()`
  - `attendanceStatusForArrival()` (late threshold)
  - `cancellationEffectiveMonth()` (cut-off day)
  - `chargeForMonth()`, `prorate()`, `applyDiscounts()`, `trialOffset()`
  - `closureTreatment()` (school vs external)
  - `payForSession()`, `pensionEligibility()`
- **Explainability**: every persisted decision stores `policy_version_id` (the resolved set hash + ids) and `explanation` JSON.
- **Overrides**: an owner override is a separate record (`policy_overrides`: who, why, attachment, decision) — never a mutation of the policy. Default enforcement is strict with logged override (DECISIONS.md #3).
- Price lists follow the same pattern (`price_lists` with scope + effective dates, `price_items`).
- 100% branch coverage on all policy functions; property-based tests for billing and proration.

## Consequences
- Changing a policy never rewrites history; past decisions still point to the version they used.
- Admin UI needs a policy editor with a "what changes" preview; Phase 1 ships a form-based editor for the known keys only.
