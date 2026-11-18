import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Aqua Swim in the stores (store launch, stage 5; docs/store/APP.md).
 *
 * The app is a thin shell around the web app: it loads the live site, so every change to a screen reaches the app at
 * once without a store review. What the shell adds is native: links that open the app, the camera and the phone's
 * share sheet, a no-connection screen, and (stage 6) push.
 *
 * `AQUA_APP_URL` picks the site at build time: production by default, staging for test builds.
 */
const siteUrl = process.env.AQUA_APP_URL ?? 'https://app.aqua-swim.co.il';

const config: CapacitorConfig = {
  // Permanent once the app is published: the stores identify the app by it.
  appId: 'il.co.aquaswim.app',
  appName: 'Aqua Swim',
  webDir: 'www',
  // The site recognizes the app by this token (apps/web/src/lib/native-app.ts).
  appendUserAgent: 'AquaSwimApp/1',
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
      '*.tranzila.com',
      '*.payplus.co.il',
    ],
  },
  ios: {
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
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
  },
};

export default config;
