import { existsSync } from 'node:fs';
import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Aqua Swim in the stores (store launch, stage 5; docs/store/APP.md).
 *
 * The app is a thin shell around the web app: it loads the live site, so every change to a screen reaches the app at
 * once without a store review. What the shell adds is native: links that open the app, the camera and the phone's
 * share sheet, a no-connection screen, and push notifications (stage 6).
 *
 * `AQUA_APP_URL` picks the site at build time: production by default, staging for test builds.
 */
const siteUrl = process.env.AQUA_APP_URL ?? 'https://app.aqua-swim.co.il';

// Push (stage 6): the site asks for notifications only in a build that can take them (`AquaPush` in the user agent,
// apps/web/src/lib/native-app.ts). The iPhone always can; Android only with the Firebase project's
// google-services.json in the build (CI writes it from the GOOGLE_SERVICES_JSON secret), since asking Android for a
// token without it would crash the app. The Capacitor CLI runs from apps/mobile.
const androidPush = existsSync('android/app/google-services.json');
const APP_UA = 'AquaSwimApp/1';
const PUSH_UA = 'AquaPush/1';

const config: CapacitorConfig = {
  // Permanent once the app is published: the stores identify the app by it.
  appId: 'il.co.aquaswim.app',
  appName: 'Aqua Swim',
  webDir: 'www',
  // The site recognizes the app by this token (apps/web/src/lib/native-app.ts).
  appendUserAgent: APP_UA,
  backgroundColor: '#1f7fb8',
  server: {
    url: siteUrl,
    // Shown when the site can't be reached (no reception at the pool).
    errorPath: 'offline.html',
    // Pages that stay inside the app: our own hosts and the payment processors' pages, so a parent who pays a link
    // comes back to the app when the processor returns. Any other link opens in the phone's browser.
    allowNavigation: [
      'aqua-swim.co.il',
      '*.aqua-swim.co.il',
      '*.meshulam.co.il',
      '*.grow.business',
      '*.cardcom.solutions',
      '*.sumit.co.il',
      '*.tranzila.com',
      '*.payplus.co.il',
    ],
  },
  ios: {
    appendUserAgent: `${APP_UA} ${PUSH_UA}`,
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    appendUserAgent: androidPush ? `${APP_UA} ${PUSH_UA}` : APP_UA,
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      // The site hides it once its first page is up (apps/web/src/components/native-bridge.tsx).
      launchAutoHide: true,
      launchShowDuration: 3000,
      backgroundColor: '#1f7fb8',
      showSpinner: false,
    },
    PushNotifications: {
      // A notification that arrives while the app is open still shows (the school's message, not a silent update).
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
