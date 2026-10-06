# Phase 10 — SaaS hardening

## Goal
Make R-SWIM OS sellable to other swim schools without a developer in the loop. A new school signs itself up, starts
from R-SWIM's proven regulations, prices and messages, and appears under its own name, colours and domain. It pays
for a plan that limits what it can grow to. The platform owner sees every school, its usage and its bills.

## Acceptance criterion (the brief gives none for this phase, so this one is ours)
1. **A new swim school signs up, completes onboarding from templates, shows its own brand on its own domain, is held
   to its plan's limits and is billed by the platform.**
   A Playwright test signs in as a new user with no school.
   - The user creates "גלים (דמו)" on the starter plan (14-day trial).
   - The onboarding checklist installs the R-SWIM regulations, the sample catalog (programs and prices) and the
     WhatsApp message set from the template marketplace.
   - The user picks a brand colour and adds the domain `galim.localhost`.
   - The worker verifies the domain (fake DNS), and `galim.localhost/login` shows the school's name and colour.
   - A second venue is refused by the starter plan with a Hebrew reason.
   - The platform admin sees the school with its usage, ends its trial, and runs the platform billing. An invoice is
     issued and charged on the fake payment provider, and a declined charge marks the school as past due with a
     banner for its owner.

## Scope

### 10.1 Plans, subscriptions and limits
- Platform tables (not tenant data, RLS on):
  - `plans`: code, Hebrew/English name, monthly price in agorot, limits on active students, staff and venues,
    features, trial days and grace days.
  - `org_subscriptions`: one per school, holding the plan, status (trialing → active → past_due → suspended, or
    cancelled), trial end, the payment mandate, and when it went past due.
- Limits are enforced in the database. A trigger on `students`, `staff_members` and `venues` refuses an insert over the
  plan's limit (`RSW01`, `platform.errors.limit.*`), so every path is covered: office, portal, GHL sync and workers.
- Features per plan (`copilot`, `transport`, `institutions`, `reports`, `courses`) hide those surfaces for schools
  whose plan lacks them. These are the brief's per-tenant feature flags.
- Pure policies (`packages/domain/platform/src/policies.ts`, 100% coverage):
  - `limitCheck` and `featureEnabled`.
  - `subscriptionAfterCharge` and `subscriptionOnDay` (trial end, grace, suspension).
  - `invoiceFor`, `onboardingChecklist`, `brandPalette`, `normalizeHost` and `templateValidity`.

### 10.2 Self-serve onboarding
- `/onboarding` is for a signed-in user with no school.
- "Create school" (name, address slug, plan) calls `public.create_school()`. It is a security-definer function that
  creates the organization, its settings, the owner membership for the caller and a trialing subscription.
- Then, as the new owner, the ordinary services add the defaults: the default regulations as the first policy
  version, the message templates, and an encryption key when the master key is set.
- `/admin/onboarding` holds a checklist computed from the data, with no stored state: install regulations, add the
  first venue, programs and prices, brand and domain, invite staff. Each item links to the screen that does it.

### 10.3 White-label branding and domains
- `org_settings.branding` holds the display name and a brand hue picked from a fixed palette, so no free-form CSS is
  possible. The app shell and the login page render the school's colours and name.
- `org_domains`: the owner adds a host, and it is stored pending with a verification token. The worker checks a DNS
  TXT record `_rswim.<host>` through an injectable resolver; the fake (`RSWIM_DNS_FAKE=1`) accepts `*.localhost`.
- Before sign-in, `public.branding_for_host(host)` returns only a verified domain's name and hue to the login page.

### 10.4 Platform billing
- `platform_invoices`: one per school and month, idempotent per period. Amounts are in agorot, and the status moves
  from open to paid or failed.
- The worker runs on the 1st at 06:00 and on demand from `/platform`. It issues the month's invoices for schools that
  are past their trial and charges their mandate through `PaymentProvider` (Grow fake). Idempotency key:
  `platform:<org>:<month>`.
- A decline marks the subscription past due. After the plan's grace days the daily job suspends it.
- A past-due owner sees a banner. A suspended school's office is locked to its plan page. Parents, instructors and
  escorts keep working, so children's lessons are never blocked by the school's bill.

### 10.5 Template marketplace
- `templates` (platform-wide): kind `regulations` (a policy set), `catalog` (programs with levels, plus an org-wide
  price list) or `messages` (WhatsApp template bodies). Status moves draft → submitted → published or rejected.
- `template_installs` (tenant): who installed what and when.
- `/admin/templates`: browse published templates and install one through the ordinary services.
  - Regulations become a new policy version.
  - A catalog adds the missing programs by code, plus a draft price list for the owner to review and publish.
  - Messages update matching template bodies, validated by the same variable check.
- An owner can share their own regulations or messages as a template. It goes to the platform admin to approve.
- The seed publishes R-SWIM's regulations, a sample catalog and the message set.

### 10.6 Platform console (`/platform`, platform admins only)
- Schools: plan, status, trial end, usage against limits, last invoice.
- Actions on a school: change its plan, end its trial, suspend or reactivate it, run billing now.
- Template review: approve or reject submitted templates.
- Cross-tenant reads go through security-definer functions that check `platform_admins`. The web app never uses the
  owner connection.

## Out of scope / later
- Real DNS and TLS for custom domains: hosting will do this, for example Vercel domains. Real platform card capture,
  which needs the platform's own Grow account. Logo upload, which needs storage. Usage-based pricing. A school
  leaving with its data exported.
