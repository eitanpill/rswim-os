# ADR-0005: Multi-tenancy and row-level security

- Status: Accepted
- Date: 2026-10-01

## Context
R-SWIM is tenant #1; the developer already serves other swim/aquatic businesses. Tenant data (minors, medical notes, ID numbers, bank details) must be isolated by construction, and roles inside a tenant must be enforced in the database, not only in the UI.

## Decision
- **Shared database, shared schema**, `organization_id uuid not null` on every tenant table, with a composite index starting with `organization_id`. FKs between tenant tables include `organization_id` (composite FKs) so a row can never reference another tenant's row.
- **Memberships**: `memberships(user_id, organization_id, role, staff_member_id?, guardian_id?, status)`. Roles: `owner`, `admin`, `instructor`, `escort`, `accountant`, `parent`, `institution_contact`; plus platform `super_admin` in a separate table. Admin capabilities (billing, payroll) are granular permissions on the membership (`permissions text[]`).
- **JWT claims**: a Supabase custom access-token hook adds `org_id` (active org) and `role` for that org. Users with several orgs switch org → token refresh.
- **RLS on every tenant table**, default deny. Helper SQL functions (`security definer`, stable):
  - `app.current_org()`, `app.current_role()`, `app.has_permission(text)`
  - `app.is_staff()`, `app.instructor_student_ids()` (students in sessions assigned to the instructor, from today − 7d to today + 14d), `app.guardian_household_ids()`
- Policy pattern: `using (organization_id = app.current_org() and <role predicate>)`.
  - Owner/admin: all rows in org (sensitive tables also require permission).
  - Instructor: own sessions, students in those sessions, own timesheets and documents.
  - Parent: own household(s), its students, enrollments, ledger, documents.
  - Accountant: read-only finance + payroll exports.
- **Sensitive fields** (ID numbers, medical notes, bank details) are encrypted at the application layer (envelope encryption, per-org data key wrapped by a KMS/master key in env) and stored as `bytea`; reads go through a service that writes `audit_log` (`action = 'sensitive_read'`).
- **Service role** (worker, webhooks) bypasses RLS; all worker queries go through a `withOrg(orgId)` helper that asserts the filter. Lint rule bans the raw service client outside `packages/db/service`.
- **Tests**: `pnpm test:rls` seeds two orgs and one user per role, then asserts for every table that cross-tenant reads/writes return zero rows / fail, and role predicates hold. CI runs it on every PR.

## Consequences
- Every new table needs an RLS policy and a row in the RLS test matrix; a CI check fails if a table in `public` has RLS disabled.
- Per-tenant branding/domains (Phase 10) map host → org before auth.
