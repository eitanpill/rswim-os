import { canEnterSurface, homeSurface, type Surface } from '@rswim/contracts';
import type { Session } from './types';

export const SURFACE_PATHS: Record<Surface, string> = {
  admin: '/admin',
  instructor: '/instructor',
  transport: '/transport',
  accountant: '/accountant',
  parent: '/parent',
  dive: '/dive',
};

// Webhooks authenticate by signature, not by session; a companion pass by its own signature (lib/pass.ts).
export const PUBLIC_PREFIXES = [
  '/login',
  // A new business owner creates an account (the landing page at `/` is public too, for visitors only).
  '/signup',
  '/auth',
  '/dev',
  '/api/health',
  '/api/webhooks',
  '/offline',
  '/pass',
  // A business's payment page: the long random token in the link is the customer's only key (docs/PAYMENTS.md).
  '/pay',
  // A school's join link: anyone may read it; joining needs a sign-in (the page sends visitors to it).
  '/join',
  // A personal invite a business's bot sent on WhatsApp: the page shows the business; joining needs the invited phone.
  '/i',
  // The app's school search (store launch, stage 4): open before sign-in, like a store listing.
  '/schools',
  // Shown right after someone deleted their account (they are signed out by then).
  '/goodbye',
  // The privacy policy: Meta (WhatsApp) and the app stores link to it, so it opens without a sign-in.
  '/privacy',
  // The files that let links open the store app (lib/native-app.ts).
  '/.well-known',
];

/**
 * Screens the store app never shows (store launch, stage 8): the subscription's prices, opening a business on a plan,
 * and paying for or changing the subscription. Apple and Google require their own billing for software sold inside an
 * app, so the platform's subscription is sold and managed on the website only, and the app neither shows it nor
 * points to it. Everything a school's own customers pay the school (lessons, dives, stays) stays in the app.
 */
export const APP_HIDDEN_PREFIXES = [
  '/signup',
  '/onboarding',
  '/billing',
  '/admin/plan',
  '/dive/plan',
];

export function hiddenInApp(pathname: string): boolean {
  return APP_HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function surfaceForPath(pathname: string): Surface | 'platform' | null {
  if (pathname === '/platform' || pathname.startsWith('/platform/')) return 'platform';
  for (const [surface, prefix] of Object.entries(SURFACE_PATHS) as [Surface, string][]) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return surface;
  }
  return null;
}

export function homePath(session: Session): string {
  if (session.isPlatformAdmin && !session.role) return '/platform';
  const surface = session.role ? homeSurface(session.role, session.vertical) : null;
  // Signed in with no school at all: the front door (a school's link, the phone the office knows, or opening a school).
  if (!session.role) return '/start';
  return surface ? SURFACE_PATHS[surface] : '/login?error=no_membership';
}

export type RouteDecision = { action: 'next' } | { action: 'redirect'; to: string };

/**
 * The whole access rule for a request, as a pure function (unit tested). `nativeApp`: the request comes from the
 * store app, which opens on sign-in rather than the marketing page (that page shows the subscription's prices).
 */
export function decideRoute(
  pathname: string,
  session: Session | null,
  opts: { nativeApp?: boolean } = {},
): RouteDecision {
  if (opts.nativeApp && hiddenInApp(pathname))
    return { action: 'redirect', to: session ? homePath(session) : '/login' };
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
    return { action: 'next' };
  if (!session) {
    if (pathname === '/')
      return opts.nativeApp ? { action: 'redirect', to: '/login' } : { action: 'next' };
    return { action: 'redirect', to: `/login?next=${encodeURIComponent(pathname)}` };
  }
  if (pathname === '/') return { action: 'redirect', to: homePath(session) };

  const surface = surfaceForPath(pathname);
  if (surface === null) return { action: 'next' };
  if (surface === 'platform')
    return session.isPlatformAdmin
      ? { action: 'next' }
      : { action: 'redirect', to: homePath(session) };
  const wrongVertical =
    session.vertical !== undefined && (session.vertical === 'freediving') !== (surface === 'dive');
  if (session.role && canEnterSurface(session.role, surface) && !wrongVertical)
    return { action: 'next' };
  return { action: 'redirect', to: homePath(session) };
}
