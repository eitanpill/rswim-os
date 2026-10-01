/**
 * Local-only login that skips Supabase: pick a demo persona, get a cookie.
 * Enabled only with RSWIM_DEV_AUTH=1 and never on a Vercel production deployment.
 * The personas match the fake seed data (packages/db/src/personas.ts).
 */
import { DEMO_ORG, PERSONAS, type PersonaKey } from '@rswim/db/personas';
import type { Session } from './types';

export const DEV_COOKIE = 'rswim_dev_session';

export function isDevAuthEnabled(): boolean {
  return process.env.RSWIM_DEV_AUTH === '1' && process.env.VERCEL_ENV !== 'production';
}

export const isPersonaKey = (v: unknown): v is PersonaKey => typeof v === 'string' && v in PERSONAS;

export function devSessionFor(key: PersonaKey): Session {
  const p = PERSONAS[key];
  return {
    userId: p.userId,
    orgId: DEMO_ORG.id,
    role: p.role,
    permissions: [],
    isPlatformAdmin: false,
    displayName: p.name,
    orgName: DEMO_ORG.name,
    mode: 'dev',
  };
}

export function readDevCookie(value: string | undefined): Session | null {
  if (!value || !isDevAuthEnabled()) return null;
  return isPersonaKey(value) ? devSessionFor(value) : null;
}
