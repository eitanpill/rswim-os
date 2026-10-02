# Status

| Phase | State | Notes |
|---|---|---|
| 0 Foundations | **Done**, merged | All three acceptance criteria pass |
| 1 Core data | **Done**, merged (PR #2) | Both acceptance criteria pass |
| 2 Scheduling engine | **Done**, PR from `phase-2` | All three acceptance criteria pass (see below) |
| 3–10 | Not started | |

## Phase 2 acceptance criteria

| Criterion | Proof | Result |
|---|---|---|
| Generating a term skips Chol HaMoed | `apps/web/e2e/scheduling.spec.ts` AC1 (UI only): a 20.9–10.10.2026 course term is generated and the report lists 28.9 and 30.9 as חול המועד (and 21.9 as יום כיפור). Service level: `packages/domain/scheduling/test/services.test.ts`, plus the run report, re-run idempotency, venue closures and calendar overrides | Pass |
| Dragging a girl into a boys-only window is blocked with a clear Hebrew reason | `scheduling.spec.ts` AC2 on desktop (real drag and drop) and on a phone ("move to"): the sheet says "‹name› בת, והבריכה בשעה הזו פתוחה רק לגברים ובנים" and offers no confirm; nothing moves. Service level: the same refusal from `placeStudent`, and the pure rule in `policies.test.ts` | Pass |
| Instructor shift changes require acceptance | `scheduling.spec.ts` AC3: the owner asks to move a group to Noa, the group keeps its instructor, Noa accepts in the instructor app, the owner sees it accepted. Service level: only the respondent can answer (RLS + trigger, forged updates refused), the worker applies an accepted change, `scheduling.staff_changed` is emitted only then, unanswered changes escalate | Pass |

Totals on 2026-10-02: 282 unit/integration tests + 16 browser tests, all green. `lint`, `typecheck`, `format:check`
clean. Coverage stays 100% on the pure policy modules, now including `domain-scheduling` policies and `calendar`.

## Phase 1 acceptance criteria

| Criterion | Proof | Result |
|---|---|---|
| The owner configures Har Homa with gender windows and two price lists effective on different dates | `apps/web/e2e/core-setup.spec.ts` (Pixel 7, UI only): venue, pool with 4 lanes, women/girls Monday and men/boys Wednesday windows, an overlapping window refused, a 1 Sep list at ₪330 published and locked, a 1 Jan version at ₪350, price check answers ₪330 on 15.10.2026 and ₪350 on 15.1.2027. Same path at service level in `packages/domain/settings/test/services.test.ts` | Pass |
| GHL contacts are imported and linked without duplicates | `packages/domain/crm/test/import.test.ts`: a fake 14-contact fixture imported twice (second run changes nothing), duplicates inside GHL reported, phone formats normalised, OS edits pushed once, GHL webhook updates applied without echo. `webhook.test.ts`: webhook stored once per id, routed by location | Pass |

Totals on 2026-10-02: 230 unit/integration tests + 12 browser tests, all green. `lint`, `typecheck`, `format:check`
clean. Coverage stays 100% on the pure policy modules (`contracts`, `domain-settings`, `domain-venues`,
`domain-staff`, `domain-crm` policies, `integrations`).

## Phase 0 acceptance criteria (for reference)

| Criterion | Proof | Result |
|---|---|---|
| Three role-based shells render RTL on mobile | `apps/web/e2e/shells.spec.ts` (Pixel 7 Chromium): `dir="rtl"`, `lang="he"`, no sideways overflow, bottom nav starts on the right, 44px targets, screenshot baselines | 11 / 11 pass |
| RLS proves tenant & role isolation | `packages/db/test/rls/isolation.test.ts`: two orgs × 7 roles over every tenant table, forged org claim, suspended member, worker scope, sensitive columns, audit, access-token hook | 38 / 38 pass |
| Outbox delivers a test event exactly once | `packages/domain/core/test/outbox.test.ts`: crash after send then redelivery → one effect; idempotent emit; rollback emits nothing; dead-letter after max attempts | 9 / 9 pass |

Totals on 2026-10-01: 107 unit/integration tests + 11 browser tests, all green. `lint`, `typecheck`, `format:check` and `build` clean.
Coverage is 100% (statements and branches) on `money`, `contracts`, `calendar` and `domain-core`.

## Not verified yet
- Against a real LeadYourWay (GHL) location: the HTTP client follows the public API v2 description and is tested
  with a fake. Connecting needs a private integration token (`GHL_API_TOKEN`) and the location id from Pit, and the
  webhook needs `GHL_WEBHOOK_PUBLIC_KEY`.
- Against a real Supabase project: the access-token hook, SMS OTP and password sign-in are tested at the SQL and unit level, and the shells via the local demo login, but no hosted Supabase project exists yet.
- The Inngest worker has not run against Inngest Cloud or the Inngest dev server; relay and consumer logic is tested directly.

## Next
Phase 3: lead → trial → enrollment flow, attendance (instructor PWA, offline), absence notices and makeups.
