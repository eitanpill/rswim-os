# The app in the stores (Aqua Swim)

Plan approved by Pit on 13.11.2026 (all 7 recommended decisions). Full plan: https://claude.ai/artifact/8QGXoHo5rQPv54e8F1NeMR
Same gate rule as the SaaS plan (docs/saas/DECISIONS.md): a stage is done when its done-criterion holds and Pit approves.

Decisions: one app for every school and every role, named Aqua Swim (a picker, not an app per school: Apple 4.2.6 and
4.3); developer accounts in the business's name; a thin Capacitor shell around the web app with native push, deep
links and the camera; the school's subscription is sold on the website only (Apple and Google both require their own
billing for business software sold inside an app), while families pay the school for lessons through the school's own
processor; the school directory is public, each school can hide itself.

## Stage 3: one sign-in for everyone (13.11.2026)

- One sign-in (phone code) sends each person to their place by role, as before.
- Someone in more than one school, or with two roles, gets a "Switch" button in the top bar (`/me/schools`). The pick
  is remembered on their sign-in row (`public.switch_school`, which refuses a school they don't belong to) and the
  access-token hook already prefers it, so next time they land there.
- Someone signed in with no place lands on `/start`: paste the link or QR the school sent (only `/join/<slug>` and
  `/invite/<token>` are accepted, `apps/web/src/lib/join-link.ts`), sign in with the number the office knows, or open
  a school (`/onboarding`).
- Dev persona **אסף (מדריך והורה)** (`twoHats`) is an instructor at the demo school and a parent at the second one.

Proof: `packages/db/test/rls/school-switch.test.ts`, `apps/web/src/lib/join-link.test.ts`,
`apps/web/e2e/schools.spec.ts`. Not verified: the token refresh after a switch against real Supabase Auth.
