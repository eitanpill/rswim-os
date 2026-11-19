/**
 * The store app (store launch, stage 5) is a Capacitor shell that loads this site. It appends this token to the
 * webview's user agent (`apps/mobile/capacitor.config.ts`, `appendUserAgent`), so the server can tell the app from a
 * browser: the app opens on sign-in rather than the marketing page with prices, and stage 8 hides the subscription
 * screens there (the stores require their own billing for software sold inside an app).
 */
export const NATIVE_APP_TOKEN = 'AquaSwimApp';

export function isNativeApp(userAgent: string | null | undefined): boolean {
  return !!userAgent && userAgent.includes(NATIVE_APP_TOKEN);
}

/** The store app's identity, from the environment, for the files that let links open the app (`/.well-known`). */
export interface AppLinkIdentity {
  /** Apple: `<Team ID>.<bundle id>`, e.g. `ABCDE12345.il.co.aquaswim.app`. */
  iosAppIds: string[];
  /** Google: the app's package name. */
  androidPackage: string;
  /** Google: the SHA-256 fingerprints of the signing certificates (Play app signing + upload key). */
  androidFingerprints: string[];
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function appLinkIdentity(
  env: Record<string, string | undefined> = process.env,
): AppLinkIdentity {
  return {
    iosAppIds: list(env.RSWIM_IOS_APP_IDS),
    androidPackage: env.RSWIM_ANDROID_PACKAGE?.trim() || 'il.co.aquaswim.app',
    androidFingerprints: list(env.RSWIM_ANDROID_CERT_SHA256),
  };
}

/**
 * Paths a link may open in the app: everything a person opens (join links, payment links, links in WhatsApp
 * messages, every screen), never the plumbing (API routes, webhooks, build files, these files themselves).
 */
const EXCLUDED = ['/api/*', '/_next/*', '/.well-known/*', '/dev/*', '/auth/*'];

export function appleAppSiteAssociation(id: AppLinkIdentity) {
  return {
    applinks: {
      details: id.iosAppIds.length
        ? [
            {
              appIDs: id.iosAppIds,
              components: [...EXCLUDED.map((p) => ({ '/': p, exclude: true })), { '/': '/*' }],
            },
          ]
        : [],
    },
  };
}

export function assetLinks(id: AppLinkIdentity) {
  if (!id.androidFingerprints.length) return [];
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: id.androidPackage,
        sha256_cert_fingerprints: id.androidFingerprints,
      },
    },
  ];
}

/**
 * Where to go inside the app for a link that opened it: the link's path on our own hosts (the platform's, a school's
 * subdomain, or the host the app is showing now). Anything else stays out (null), so a stray link can't steer the app.
 */
export function appLinkTarget(link: string, currentHost: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const h = url.hostname.toLowerCase();
  const ours =
    h === 'aqua-swim.co.il' || h.endsWith('.aqua-swim.co.il') || url.host === currentHost;
  if (!ours) return null;
  return url.host === currentHost ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}
