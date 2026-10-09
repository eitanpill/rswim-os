/**
 * Local-only login that skips Supabase: pick a demo persona, get a cookie.
 * Enabled with RSWIM_DEV_AUTH=1 (never on a Vercel production deployment), or on the public live demo
 * (RSWIM_DEMO_MODE=1), which runs on fake data and fake providers only (deploy/demo).
 * The personas match the fake seed data (packages/db/src/personas.ts).
 *
 * The cookie holds a persona key. A newcomer who has just opened a school holds `newcomer@<orgId>`: they are that
 * school's owner (the database checks the membership on every statement regardless).
 */
import {
  ACCOUNT_PERSONAS,
  DEMO_ORG,
  DIVE_MANAGER_PERMISSIONS,
  DIVE_ORG,
  DIVE_PERSONAS,
  PERSONAS,
  type AccountPersonaKey,
  type DivePersonaKey,
  type PersonaKey,
} from '@rswim/db/personas';
import { demoProfile } from '@rswim/db/demo-profiles';
import type { Session } from './types';

export const DEV_COOKIE = 'rswim_dev_session';

/** The public live demo: persona sign-in, a demo banner, fake providers only, data reset nightly. */
export function isDemoMode(): boolean {
  return process.env.RSWIM_DEMO_MODE === '1';
}

export function isDevAuthEnabled(): boolean {
  if (isDemoMode()) return true;
  return process.env.RSWIM_DEV_AUTH === '1' && process.env.VERCEL_ENV !== 'production';
}

/** On the live demo the owner wears the first name the demo was seeded with (its profile, or RSWIM_DEMO_OWNER_NAME). */
export function personaName(key: DevKey): string {
  if (key === 'owner' && isDemoMode()) return `${demoProfile().ownerFirstName} (דמו)`;
  if (key in DIVE_PERSONAS) return DIVE_PERSONAS[key as DivePersonaKey].name;
  return key in PERSONAS
    ? PERSONAS[key as PersonaKey].name
    : ACCOUNT_PERSONAS[key as AccountPersonaKey].name;
}

export type DevKey = PersonaKey | AccountPersonaKey | DivePersonaKey;

export const isPersonaKey = (v: unknown): v is DevKey =>
  typeof v === 'string' && (v in PERSONAS || v in ACCOUNT_PERSONAS || v in DIVE_PERSONAS);

export const isDivePersona = (k: DevKey): k is DivePersonaKey => k in DIVE_PERSONAS;

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
  if (isDivePersona(key)) {
    const d = DIVE_PERSONAS[key];
    return {
      userId: d.userId,
      orgId: DIVE_ORG.id,
      role: d.role,
      permissions: key === 'diveManager' ? [...DIVE_MANAGER_PERMISSIONS] : [],
      isPlatformAdmin: false,
      displayName: d.name,
      orgName: DIVE_ORG.name,
      vertical: 'freediving',
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
    displayName: personaName(key),
    orgName: DEMO_ORG.name,
    vertical: 'swim',
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
