# The store app (apps/mobile)

Aqua Swim in the App Store and Google Play is a thin [Capacitor](https://capacitorjs.com) shell around the web app
(store launch, stage 5). It loads the live site, so a change to any screen reaches the app at once, with no store
review. What the shell adds is native.

| What | How |
|---|---|
| The site it loads | `AQUA_APP_URL` at build time; production (`https://app.aqua-swim.co.il`) by default, staging for test builds |
| The site knows it's the app | the webview's user agent ends with `AquaSwimApp/1` (`apps/web/src/lib/native-app.ts`). The app opens on sign-in instead of the marketing page with prices; stage 8 hides the subscription screens the same way |
| Links open the app | Universal Links (iPhone, `ios/App/App/App.entitlements`) and App Links (Android, `AndroidManifest.xml`) for `app.`, `staging.` and every `*.aqua-swim.co.il`. The site serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` from `RSWIM_IOS_APP_IDS` and `RSWIM_ANDROID_CERT_SHA256`; until those are set, both files are empty and links open in the browser. The page follows the link (`components/native-bridge.tsx`, plugin `@capacitor/app`) whether the app was running or not |
| Camera and files | the site's upload buttons (certification cards, signed forms) open the camera or the gallery. iPhone asks with the texts in `Info.plist`, Android with the `CAMERA` permission |
| Share | `components/share-button.tsx`: the phone's share sheet in the app (`@capacitor/share`), the browser's where it has one, WhatsApp otherwise. First used on the school's join link (`/admin/join`) |
| No reception | `www/offline.html`, the app's own screen when the site can't be reached; "try again" goes back to the site. The instructors' offline attendance keeps working as before (service worker) |
| Paying | the processors' pages (Grow, Cardcom, Tranzila, PayPlus) stay inside the app (`allowNavigation`), so the parent comes back to the app after paying. Other links open in the phone's browser |
| Icon and splash | `assets/options/*.svg` holds the three options; `pnpm --filter @rswim/mobile icons <option>` then `pnpm --filter @rswim/mobile assets` writes every size. Option `a-waves` is in place until Pit picks |
| Identity | bundle id / package `il.co.aquaswim.app` (permanent once published), iPhone only (no iPad build), Android API 36 |

## Building

```
pnpm --filter @rswim/mobile sync          # writes www/site.js, copies the shell and plugins into ios/ and android/
pnpm --filter @rswim/mobile open:ios      # Xcode (on a Mac): pick the team, run on a phone or archive for TestFlight
pnpm --filter @rswim/mobile open:android  # Android Studio: run on a phone, or Build > Generate Signed Bundle
```
`AQUA_APP_URL=https://staging.aqua-swim.co.il pnpm --filter @rswim/mobile sync` for a build that loads staging.

`.github/workflows/mobile.yml` builds both on every change under `apps/mobile` and on every merge to main: an Android
debug APK (downloadable from the run for 14 days) and an iPhone simulator build, both loading staging, unsigned.
Signed builds to TestFlight and Google Play internal testing join once the store keys are in the repository's
secrets (next section).

## Setting up the stores (once)

Apple (App Store Connect, the organization account):
1. Certificates, Identifiers & Profiles → Identifiers → **+** → App IDs → App: bundle id `il.co.aquaswim.app`,
   capability **Associated Domains** on.
2. App Store Connect → Apps → **+** New App: iOS, name Aqua Swim, Hebrew primary language, bundle id from step 1.
3. The web app's environment: `RSWIM_IOS_APP_IDS=<Team ID>.il.co.aquaswim.app` (the Team ID is on the Membership page).
4. For builds from CI: Users and Access → Integrations → App Store Connect API → a key with the App Manager role. The
   key file goes into the repository's secrets, never into chat.

Google (Play Console, the organization account):
1. Create app: Aqua Swim, Hebrew, App, Free.
2. The first build is uploaded by hand (a signed AAB from Android Studio) to Internal testing; Play App Signing then
   holds the app's key.
3. Setup → App signing: copy both SHA-256 fingerprints (app signing key and upload key) into the web app's
   `RSWIM_ANDROID_CERT_SHA256` (comma-separated).
4. For builds from CI: a Google Cloud service account with release rights in Play Console; its JSON key goes into the
   repository's secrets.
