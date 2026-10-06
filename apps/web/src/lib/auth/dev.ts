/**
 * Local-only login that skips Supabase: pick a demo persona, get a cookie.
 * Enabled only with RSWIM_DEV_AUTH=1 and never on a Vercel production deployment.
 * The personas match the fake seed data (packages/db/src/personas.ts).
 *
 * The cookie holds a persona key. A newcomer who has just opened a school holds `newcomer@<orgId>`: they are that
 * school's owner (the database checks the membership on every statement regardless).
 */
import {
  ACCOUNT_PERSONAS,
  DEMO_ORG,
  PERSONAS,
  type AccountPersonaKey,
  type PersonaKey,
} from '@rswim/db/personas';
import type { Session } from './types';

export const DEV_COOKIE = 'rswim_dev_session';

export function isDevAuthEnabled(): boolean {
  return process.env.RSWIM_DEV_AUTH === '1' && process.env.VERCEL_ENV !== 'production';
}

export type DevKey = PersonaKey | AccountPersonaKey;

export const isPersonaKey = (v: unknown): v is DevKey =>
  typeof v === 'string' && (v in PERSONAS || v in ACCOUNT_PERSONAS);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function devSessionFor(key: DevKey, orgId?: string): Session {
  if (key === 'newcomer' || key === 'platform') {
    const p = ACCOUNT_PERSONAS[key];
    const owner = key === 'newcomer' && orgId !== undefined;
    return {
      userId: p.userId,
      orgId: owner ? orgId : null,
      role: owner ? 'owner' : null,
      permissions: [],
      isPlatformAdmin: key === 'platform',
      displayName: p.name,
      mode: 'dev',
    };
  }
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

/** The cookie value for a persona, optionally inside a school it just opened. */
export const devCookieValue = (key: DevKey, orgId?: string) => (orgId ? `${key}@${orgId}` : key);

export function readDevCookie(value: string | undefined): Session | null {
  if (!value || !isDevAuthEnabled()) return null;
  const [key, orgId] = value.split('@');
  if (!isPersonaKey(key)) return null;
  if (orgId !== undefined && (key !== 'newcomer' || !UUID.test(orgId))) return null;
  return devSessionFor(key, orgId);
}
