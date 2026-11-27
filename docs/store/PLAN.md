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

## Stage 4: finding a school (13.11.2026)
- **The school search** `/schools`, open before sign-in: by name or city, swim schools or freediving clubs
  (`public.school_directory`). Each school opens its page `/join/<slug>`. A school can opt out of the search on
  `/admin/join`; its own link keeps working.
- **A swim school's page** `/join/<slug>`: what the school is, sign in with a phone, then a short form (the parent,
  up to four children, join or trial first, a note). The request lands on the office's `/admin/join` ("משפחות
  חדשות"); asking again while it is open updates it. A freediving club's page is unchanged (divers join directly).
- **The office** accepts (a family with the children is opened, or the known family is used when the phone is
  already on file, and the parent gets the app) or declines. The same screen shows the school's link and a QR sign
  to print for the pool, and how the school shows in the search.
- **"We found you"**: someone signed in whose phone the school already has on a family nobody holds yet sees
  "מצאנו אותך ב…" on `/start` and joins that family in one tap (`public.claim_by_phone`).
- Any phone number can now open an account (sign-in creates it); someone with no school lands on `/start`.
- Dev personas: **דנה (הורה מחפשת בית ספר)** asks to join, **מיכל (הורה שבית הספר מכיר)** is found by phone.
- Limit: for a school with its own database, "we found you" works only after the person asked that school to join
  (their sign-in row reaches its database then). Shared schools, the default, work fully.

## Stage 5: the app shell (18.11.2026)
- `apps/mobile`: one Capacitor project for iPhone and Android that loads the site (`docs/store/APP.md`): links that
  open the app on our hosts (`/.well-known` files on the site), the camera and gallery from the existing upload
  buttons, the share sheet (first on the school's join link), the app's own no-connection screen, and the payment
  processors' pages kept inside the app.
- In the app, `/` opens sign-in rather than the marketing page with prices (`decideRoute`, user agent `AquaSwimApp`).
- CI builds an Android APK and an iPhone simulator build on every change (`.github/workflows/mobile.yml`).
- Icon: Pit picked a swimmer in the waves (`apps/mobile/assets/options/d-swimmer.svg`).
- Waiting on Pit: the App ID and app records in both
  stores, then the first install on his phones (Xcode on the Mac for the iPhone, the CI APK for Android).
- Not verified yet: anything on a real device or simulator (no Mac or Android SDK here); link verification needs the
  store identities in the web app's environment.

## Stage 6: push notifications (25.11.2026)
- The store app takes push notifications; a family's message goes to the app first and by WhatsApp only when no phone
  took it. Details and the one-time setup (Firebase, Apple's push key) in `docs/store/APP.md`.
- Proof: `packages/db/test/rls/push-devices.test.ts`, `packages/integrations/test/push.test.ts`, the push test in
  `packages/domain/comms/test/services.test.ts`, `apps/mobile/test/config.test.ts`.
- Not yet: staff and owner messages still go by WhatsApp (they are addressed by phone, not by guardian); a family
  that turned WhatsApp off is still blocked when the message is queued; push needs a WhatsApp provider configured for
  the school (the dispatcher runs per school only then).

## Stage 8, first part: deleting your account (14.11.2026)
- `/me/account` ("החשבון שלי"), one tap from every screen (the name under the school's name in the header, or the
  avatar on the freediving screens). It says what goes (the sign-in, every membership, join requests not yet
  accepted) and what the school keeps (the family's file, lessons, payments and receipts: the school's records, and
  the ledger is append-only). The person types "מחיקה" to confirm; then `/goodbye`.
- `public.delete_my_account()` (migration 0062) runs on each school's own database first and on the platform's last.
  The only owner of an active school is refused (`public.my_sole_owned_schools()`) until another owner exists.
- Google Play's "web link for deletion requests": the same page on the web (sign in, then delete).
- Not verified: deleting from `auth.users` by SQL on a real Supabase project (no project yet).

## Stage 8, second part: no subscription in the app (27.11.2026)
- The platform's subscription is sold and managed on the website only (Apple 3.1.1 and Google Play's payments
  policy require their own billing for software sold inside an app). In the store app (`AquaSwimApp` in the user
  agent) the middleware sends `/signup`, `/onboarding`, `/billing/*`, `/admin/plan` and `/dive/plan` home
  (`hiddenInApp` in `lib/auth/routing.ts`), and the screens drop every way there: the trial banner (price, card,
  plan), the past-due and cancelling banners, the plan tile on "more", the plan link on the connections screen and the
  club owner's screen, "create a business" on sign-in and "open a school" on `/start`. A suspended office sees a plain
  notice instead of the plan page. Nothing points to the website for buying.
- What families and divers pay their own school (lessons, dives, stays) stays in the app: a physical service paid to
  the business (Apple 3.1.3(e)).
- Proof: `apps/web/src/lib/auth/routing.test.ts` ("the store app").

## Reviewer demo accounts (to set up with the Supabase project)
Apple and Google sign in with an account we give them. Sign-in is by phone code, so:
1. In Supabase, Authentication → Phone: add test numbers with fixed codes (no SMS is sent), e.g. an owner number and
   a parent number. The numbers and codes go into App Store Connect's and Play Console's review notes, never into
   the repository.
2. A review school opened through `/onboarding` from templates, filled with invented families, not listed in the
   search (`/admin/join`), with the test owner as its owner and the test parent on one of its families (the office
   adds the phone; "we found you" connects it).
3. Before each submission: sign in with both numbers on a real phone and walk the review path.
