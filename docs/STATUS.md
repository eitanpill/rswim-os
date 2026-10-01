# Status

| Phase | State | Notes |
|---|---|---|
| 0 Foundations | **Done locally**, waiting for a GitHub repo to push | All three acceptance criteria pass (see below) |
| 1–10 | Not started | |

## Phase 0 acceptance criteria

| Criterion | Proof | Result |
|---|---|---|
| Three role-based shells render RTL on mobile | `apps/web/e2e/shells.spec.ts` (Pixel 7 Chromium): `dir="rtl"`, `lang="he"`, no sideways overflow, bottom nav starts on the right, 44px targets, screenshot baselines | 11 / 11 pass |
| RLS proves tenant & role isolation | `packages/db/test/rls/isolation.test.ts`: two orgs × 7 roles over every tenant table, forged org claim, suspended member, worker scope, sensitive columns, audit, access-token hook | 38 / 38 pass |
| Outbox delivers a test event exactly once | `packages/domain/core/test/outbox.test.ts`: crash after send then redelivery → one effect; idempotent emit; rollback emits nothing; dead-letter after max attempts | 9 / 9 pass |

Totals on 2026-10-01: 107 unit/integration tests + 11 browser tests, all green. `lint`, `typecheck`, `format:check` and `build` clean.
Coverage is 100% (statements and branches) on `money`, `contracts`, `calendar` and `domain-core`.

## Not verified yet
- Against a real Supabase project: the access-token hook, SMS OTP and password sign-in are tested at the SQL and unit level, and the shells via the local demo login, but no hosted Supabase project exists yet.
- The Inngest worker has not run against Inngest Cloud or the Inngest dev server; relay and consumer logic is tested directly.
- GitHub Actions CI is written but has not run (no remote repository yet).

## Next
Phase 1: venues, programs, levels, versioned price lists and policy sets, staff profiles + invites, households/guardians/students CRUD, GHL contact import.
