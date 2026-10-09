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
  '/auth',
  '/dev',
  '/api/health',
  '/api/webhooks',
  '/offline',
  '/pass',
];

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
  // Signed in with no school at all: open one (a parent without a family is told so on that page too).
  if (!session.role) return '/onboarding';
  return surface ? SURFACE_PATHS[surface] : '/login?error=no_membership';
}

export type RouteDecision = { action: 'next' } | { action: 'redirect'; to: string };

/** The whole access rule for a request, as a pure function (unit tested). */
export function decideRoute(pathname: string, session: Session | null): RouteDecision {
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
    return { action: 'next' };
  if (!session) return { action: 'redirect', to: `/login?next=${encodeURIComponent(pathname)}` };
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
