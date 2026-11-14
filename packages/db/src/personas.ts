/**
 * Fixed ids for the fake demo tenant, shared by the seed script and the local dev login.
 * Every name and number here is invented.
 */
import type { OrgRole } from '@rswim/contracts';

export const DEMO_ORG = {
  id: '00000000-0000-4000-8000-00000000a001',
  slug: 'rswim-demo',
  name: 'R-SWIM (דמו)',
  city: 'גוש עציון',
  about: 'בית ספר לשחייה לילדים ולמבוגרים, קבוצות ושיעורים פרטיים (דמו).',
} as const;

export const SECOND_ORG = {
  id: '00000000-0000-4000-8000-00000000b001',
  slug: 'demo-pool',
  name: 'בריכת הדגמה',
  city: 'ירושלים',
  about: 'בריכה שכונתית עם חוגי שחייה אחר הצהריים (דמו).',
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
 * Demo accounts without a school role: someone about to open a new swim school (no membership yet), the platform's
 * own admin (sees every school in /platform), and someone about to join the Eilat club through its link.
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
  /** Someone who found the Eilat club's join link: signs in, joins as a diver, uploads a card, signs the forms. */
  diveNewcomer: {
    userId: '00000000-0000-4000-8000-000000000203',
    name: 'נועם (דמו, צולל חדש)',
    phone: '+972500000203',
  },
  /**
   * Someone with two hats (store launch, stage 3): an instructor at the demo school and a parent at the second one.
   * Picks which school they are working in from the app's school switcher.
   */
  twoHats: {
    userId: '00000000-0000-4000-8000-000000000204',
    name: 'אסף (דמו, מדריך והורה)',
    phone: '+972500000204',
  },
  /**
   * A parent who found a swim school in the app's search (store launch, stage 4): asks to join, and the office
   * accepts. Belongs to no school at first.
   */
  familyNewcomer: {
    userId: '00000000-0000-4000-8000-000000000205',
    name: 'דנה (דמו, הורה מחפשת בית ספר)',
    phone: '+972500000205',
  },
  /**
   * A parent the second school already has on file (the office typed her phone): the app finds her by it and she
   * joins her family in one tap.
   */
  knownParent: {
    userId: '00000000-0000-4000-8000-000000000206',
    name: 'מיכל (דמו, הורה שבית הספר מכיר)',
    phone: '+972500000206',
  },
} as const;

export type AccountPersonaKey = keyof typeof ACCOUNT_PERSONAS;

/** The two-hats persona's role in each of its schools (the seed creates exactly these memberships). */
export const TWO_HATS_ROLES = {
  [DEMO_ORG.id]: 'instructor',
  [SECOND_ORG.id]: 'parent',
} as const satisfies Record<string, OrgRole>;

/** The freediving club demo tenant (an Eilat club, all invented). */
export const DIVE_ORG = {
  id: '00000000-0000-4000-8000-00000000c001',
  slug: 'eilat-deep-blue',
  name: 'כחול עמוק אילת (דמו)',
  city: 'אילת',
  about: 'מועדון צלילה חופשית: קורסים, אימוני עומק ויציאות לים (דמו).',
} as const;

/** A second, smaller club on a trial, so the platform console shows a network. */
export const DIVE_ORG_2 = {
  id: '00000000-0000-4000-8000-00000000c002',
  slug: 'haifa-free-waves',
  name: 'גלים חופשיים חיפה (דמו)',
  city: 'חיפה',
  about: null,
} as const;

/**
 * The club's people: the owner, the operations manager, the front desk, an instructor and a customer. The manager
 * and the front desk are both admins; the manager also holds settings, billing and payroll.
 */
export const DIVE_PERSONAS = {
  diveOwner: {
    userId: '00000000-0000-4000-8000-000000000301',
    role: 'owner',
    name: 'אורי (דמו)',
    email: 'owner@eilat.dive.test',
  },
  diveManager: {
    userId: '00000000-0000-4000-8000-000000000302',
    role: 'admin',
    name: 'מאיה (דמו)',
    email: 'manager@eilat.dive.test',
  },
  diveOffice: {
    userId: '00000000-0000-4000-8000-000000000303',
    role: 'admin',
    name: 'שני (דמו)',
    email: 'office@eilat.dive.test',
  },
  diveInstructor: {
    userId: '00000000-0000-4000-8000-000000000304',
    role: 'instructor',
    name: 'יואב (דמו)',
    email: 'instructor@eilat.dive.test',
  },
  diveCustomer: {
    userId: '00000000-0000-4000-8000-000000000305',
    role: 'parent',
    name: 'דנה (דמו)',
    phone: '+972500000305',
  },
} as const satisfies Record<string, Persona>;

export type DivePersonaKey = keyof typeof DIVE_PERSONAS;

/** What the manager holds on top of the front desk. */
export const DIVE_MANAGER_PERMISSIONS = [
  'billing.read',
  'billing.write',
  'payroll.read',
  'settings.write',
] as const;
