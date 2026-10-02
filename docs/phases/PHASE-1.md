# Phase 1 — Core Data

## Goal
The owner can describe the business in the system: venues with their pools, lanes, gender windows, entry rules and
closures; programs and levels; versioned price lists and policy sets; staff with certifications, skills, availability
and pay rules; families. Guardians are linked to GoHighLevel contacts, both ways, without duplicates.

## Acceptance criteria (from the brief)
1. **The owner can configure Har Homa with gender windows and two price lists effective on different dates.**
   Proof: a Playwright test on the mobile project signs in as the owner and, through the UI only, creates the venue,
   a pool with lanes, a women/girls window on Monday and a men/boys window on Wednesday, then two price lists
   (one from 1 Sep, one from 1 Jan). The venue page shows both windows; the price check shows ₪330 for a September
   date and the new price for a January date. Unit tests cover the resolver's date and scope rules.
2. **GHL contacts are imported and linked without duplicates.**
   Proof: an integration test imports a recorded fixture of fake GHL contacts (duplicates by phone inside GHL,
   contacts that match existing guardians by phone, local phone formats, contacts without a phone) twice. The first run
   links or creates exactly one guardian per person; the second run changes nothing. A guardian edited in R-SWIM OS is
   pushed back to GHL once (outbox), and a GHL webhook update reaches the guardian without echoing back.

## Scope

### 1.1 Contracts
- `PolicyRules` Zod schema for the known keys in `docs/POLICIES.md` (all optional, so a scope sets only what it
  overrides), plus enums for program kinds, gender restrictions, venue statuses, employment types, pay bases.

### 1.2 Database (migration `0002_core_data` + `0003_core_data_security`)
- Venues: `venues`, `venue_contracts`, `pools`, `lanes`, `venue_operating_windows` + `operating_window_lanes`,
  `venue_closures`. Entry rules (companions, extra-child fee, father escort in women's hours) are venue-scope policy keys.
- Catalog: `programs`, `levels`.
- Configuration: `policy_sets`, `price_lists`, `price_items`.
- Staff: `certifications`, `staff_skills` (array on `staff_members`), `availability_rules`,
  `availability_exceptions`, `pay_rules`, `staff_invites` + `app.accept_invite()`.
- People: `students.level_id`, `students.preferred_staff_id`, `student_relations`; GHL fields on guardians.
- Integrations: `import_runs` (one row per GHL import with counts and the per-contact report).
- RLS for every new table (owner/admin write; instructors read venues/programs/levels and their own staff data;
  accountant reads pay rules with `payroll.read`; parents read nothing new), with rows added to the isolation suite.

### 1.3 Domain (pure, 100% branch coverage)
- `@rswim/domain-config`: `resolvePolicy()` (scope precedence `class_template > venue_program > program > venue > org`,
  effective dates, deep merge, contributing ids) and `resolvePrice()` (most specific active list on a date).
- `@rswim/domain-venues`: window validation (end after start, no overlap on shared lanes), weekday helpers.
- `@rswim/domain-crm`: `planContactImport()` (tag → field mapping, phone normalisation, dedupe by GHL id then
  phone, merge duplicates within GHL), `contactFromGuardian()` and loop-safe sync decisions.

### 1.4 Services, worker, integrations
- Services write rows + outbox events in one transaction (`people.guardian_upserted`, `crm.import_requested`).
- `GhlClient` behind `CrmProvider`: an HTTP adapter for LeadConnector API v2 and an in-memory fake for tests and
  local runs. Webhook route `/api/webhooks/ghl` stores events idempotently in `webhook_events`.
- Worker functions: `crm-push-guardian` (OS → GHL), `crm-apply-webhook` (GHL → OS), `crm-import-contacts`.

### 1.5 Admin UI (Hebrew, mobile-first)
- More → Settings hub. Venues (list, detail with pools/lanes, weekly windows, closures, contracts, entry rules),
  programs & levels, price lists (versions, items, "check a price on a date"), policies (form editor for known keys,
  new version from a date), staff (profile, certifications, skills, availability, pay rules, invite), families
  (search, household 360 basics: guardians and students), GHL (import, last run report).
- The web app reads and writes through Drizzle as the signed-in user (`asUser`), so RLS applies to every screen.

### 1.6 Seed and docs
- Demo seed gains fake venues (including a Har Homa-style venue with gender windows), programs, levels, two price
  list versions, an org policy set, staff details and a fake GHL fixture. Demo script in `docs/demos/PHASE-1.md`.

## Out of scope
Class templates, sessions and the Group Board (Phase 2); enrollment, attendance and makeups (Phase 3); billing and
discount application (Phase 4); GHL opportunities, tags and messaging (Phase 5); running against the real GHL
account (needs an API token from the owner, and the repo never holds real client data).

## Risks
- The GHL HTTP adapter follows the public LeadConnector v2 docs but is only exercised against recorded fake fixtures
  until a token for a test sub-account exists.
- Staff invite acceptance needs a hosted Supabase project for the sign-up half; the database half is tested.
