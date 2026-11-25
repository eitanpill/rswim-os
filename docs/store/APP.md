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
| Push notifications | stage 6, below |
| Icon and splash | `assets/options/*.svg` holds the nine options; `pnpm --filter @rswim/mobile icons <option>` then `pnpm --filter @rswim/mobile assets` writes every size. Pit picked `d-swimmer`, a swimmer in the waves (18.11.2026); options 4 to 9 came in a second round |
| Identity | bundle id / package `il.co.aquaswim.app` (permanent once published), iPhone only (no iPad build), Android API 36 |

## Push notifications (stage 6)

A family's message goes to the app on their phone first and by WhatsApp only when no phone took it (cheaper than
WhatsApp, and it works outside WhatsApp's 24-hour window without an approved template). Quiet hours and Shabbat hold
it the same way.

- The app asks for permission on a signed-in person's own screens only (`asksForPush` in `lib/native-app.ts`), then
  registers its token on every page load in the current school (`/api/push` → `public.register_push_device`, table
  `push_devices`, migration 0079). A phone belongs to whoever signed in on it last; signing out forgets it (httpOnly
  cookie `aqua_push`); deleting the account removes the person's phones.
- The worker's dispatcher (`dispatchDue` in `@rswim/domain-comms`) looks up the guardian's people's phones, sends
  through `pushProvider()` (`apps/worker/src/providers.ts`), marks the message `channel = 'push'`, and forgets a token
  the platform calls dead. Tapping a notification opens the app.
- Only builds that can take push ask: the app adds `AquaPush/1` to its user agent on the iPhone always, and on Android
  only when `android/app/google-services.json` is in the build (without it, Android crashes when asked for a token).

Setting it up (once):
1. Firebase (console.firebase.google.com): add a project (the Google Cloud project of the Play service account is
   fine), then Add app → Android, package `il.co.aquaswim.app`, and download `google-services.json`. Its whole content
   goes into the repository secret `GOOGLE_SERVICES_JSON` (CI writes the file before building).
2. Firebase → Project settings → Service accounts → Generate new private key. The whole JSON goes into the worker's
   environment as `FCM_SERVICE_ACCOUNT_JSON` (Railway), never chat or the repository.
3. Apple Developer → Certificates, Identifiers & Profiles → Keys → **+** → Apple Push Notifications service (APNs).
   Download the .p8 once. The worker gets `APNS_KEY_P8` (the file's whole text) and `APNS_KEY_ID`; the team is
   6ZNNQLACFA. Identifiers → `il.co.aquaswim.app` → tick Push Notifications (CI's cloud signing then adds it to the
   profile).
4. Local demos and CI: `RSWIM_PUSH_FAKE=1` on the worker. With nothing set, families get WhatsApp as before.

Not verified yet: a real notification on a real phone (needs the keys above and a TestFlight / internal testing build).

## Building

```
pnpm --filter @rswim/mobile sync          # writes www/site.js, copies the shell and plugins into ios/ and android/
pnpm --filter @rswim/mobile open:ios      # Xcode (optional, on a Mac): run on a phone from a cable
pnpm --filter @rswim/mobile open:android  # Android Studio: run on a phone, or Build > Generate Signed Bundle
```
`AQUA_APP_URL=https://staging.aqua-swim.co.il pnpm --filter @rswim/mobile sync` for a build that loads staging.

`.github/workflows/mobile.yml` builds both on every change under `apps/mobile` and on every merge to main: an Android
debug APK (downloadable from the run for 14 days) and an iPhone simulator build, both loading staging, unsigned.
On main (and from Actions → Mobile app → Run workflow) the `testflight` job archives the iPhone app on GitHub's Mac,
signs it with Xcode's cloud signing through the App Store Connect key, and uploads it to TestFlight with the run number
as build number. Nobody needs Xcode or a Mac (Pit has no room for Xcode, 19.11.2026). Without the key's secrets the job
is skipped. TestFlight builds load staging for now; the store build switches `AQUA_APP_URL` to production. The `play` job does the
same for Google Play (below): a signed bundle with the run number as version code, sent to internal testing.

## Setting up the stores (once)

Apple (App Store Connect, the organization account):
1. Certificates, Identifiers & Profiles → Identifiers → **+** → App IDs → App: bundle id `il.co.aquaswim.app`,
   capability **Associated Domains** on. Done 18.11.2026.
2. App Store Connect → Apps → **+** New App: iOS, name Aqua Swim, Hebrew primary language, bundle id from step 1.
3. The web app's environment: `RSWIM_IOS_APP_IDS=6ZNNQLACFA.il.co.aquaswim.app` (Team ID 6ZNNQLACFA, also set as the Xcode project's team). Done for staging 18.11.2026.
4. For builds from CI: Users and Access → Integrations → App Store Connect API → Team Keys → **+**, role **Admin**
   (cloud signing creates the distribution certificate itself). Repository secrets, never chat: `APPSTORE_ISSUER_ID`,
   `APPSTORE_KEY_ID`, `APPSTORE_P8` (the whole .p8 file). Then install TestFlight on the iPhone; App Store Connect →
   the app → TestFlight → Internal Testing → add yourself as a tester.

Google (Play Console, the organization account):
1. Create app: Aqua Swim, Hebrew, App, Free.
2. The upload key: a keystore made once (25.11.2026, alias `upload`, upload-key SHA-256
   `44:6F:9F:13:D8:10:70:39:2A:BB:51:9F:80:13:A2:B4:8A:EF:73:4D:F5:83:1E:05:FD:67:E7:77:22:53:11:68`). It lives only in
   the repository's secrets: `ANDROID_KEYSTORE_B64` (the .jks file in base64) and `ANDROID_KEYSTORE_PASSWORD`. Lost, it
   is replaced through Play Console (App integrity → request upload key reset); the app's own key stays with Google.
3. With those secrets, every merge to main that touches `apps/mobile` (or a push to a `play/*` branch, or Actions →
   Mobile app → Run workflow) builds the signed bundle in the `play` job; download `aqua-swim-android-store-<n>` from
   the run. The first bundle is uploaded by hand: Play Console → Test and release → Testing → Internal testing →
   Create new release (accept Play App Signing), then add the testers' emails.
4. Setup → App signing: copy both SHA-256 fingerprints (app signing key and upload key) into the web app's
   `RSWIM_ANDROID_CERT_SHA256` (comma-separated), so links open the app.
5. For uploads from CI: Google Cloud console → the project linked to Play Console → IAM → Service accounts → create
   one, Keys → Add key → JSON. Play Console → Users and permissions → Invite new users → the service account's email,
   app Aqua Swim, permission "Release apps to testing tracks". The JSON file's whole content goes into the repository
   secret `PLAY_SERVICE_ACCOUNT_JSON`, never chat. From then on each run lands in internal testing as a draft release
   (Play takes drafts only until the app is first published); "Review release" → "Start rollout" sends it to testers.
