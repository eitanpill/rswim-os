/**
 * Fixed ids for the fake demo tenant, shared by the seed script and the local dev login.
 * Every name and number here is invented.
 */
import type { OrgRole } from '@rswim/contracts';

export const DEMO_ORG = {
  id: '00000000-0000-4000-8000-00000000a001',
  slug: 'rswim-demo',
  name: 'R-SWIM (דמו)',
} as const;

export const SECOND_ORG = {
  id: '00000000-0000-4000-8000-00000000b001',
  slug: 'demo-pool',
  name: 'בריכת הדגמה',
} as const;

export interface Persona {
  userId: string;
  role: OrgRole;
  name: string;
  email?: string;
  phone?: string;
}

export const PERSONAS = {
  owner: {
    userId: '00000000-0000-4000-8000-000000000101',
    role: 'owner',
    name: 'רעות (דמו)',
    email: 'owner@demo.rswim.test',
  },
  admin: {
    userId: '00000000-0000-4000-8000-000000000102',
    role: 'admin',
    name: 'שרון (דמו)',
    email: 'admin@demo.rswim.test',
  },
  instructor: {
    userId: '00000000-0000-4000-8000-000000000103',
    role: 'instructor',
    name: 'נועה (דמו)',
    email: 'instructor@demo.rswim.test',
  },
  escort: {
    userId: '00000000-0000-4000-8000-000000000104',
    role: 'escort',
    name: 'דני (דמו)',
    email: 'escort@demo.rswim.test',
  },
  accountant: {
    userId: '00000000-0000-4000-8000-000000000105',
    role: 'accountant',
    name: 'רו״ח (דמו)',
    email: 'accountant@demo.rswim.test',
  },
  parent: {
    userId: '00000000-0000-4000-8000-000000000106',
    role: 'parent',
    name: 'מיכל כהן (דמו)',
    phone: '+972500000106',
  },
} as const satisfies Record<string, Persona>;

export type PersonaKey = keyof typeof PERSONAS;

/**
 * Phase 10 demo accounts without a school role: someone about to open a new swim school (no membership yet), and
 * the platform's own admin (sees every school in /platform).
 */
export const ACCOUNT_PERSONAS = {
  newcomer: {
    userId: '00000000-0000-4000-8000-000000000201',
    name: 'גל (דמו, בית ספר חדש)',
    email: 'newcomer@demo.rswim.test',
  },
  platform: {
    userId: '00000000-0000-4000-8000-000000000202',
    name: 'מנהל/ת הפלטפורמה (דמו)',
    email: 'platform@demo.rswim.test',
  },
} as const;

export type AccountPersonaKey = keyof typeof ACCOUNT_PERSONAS;
