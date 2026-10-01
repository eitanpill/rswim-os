import { z } from 'zod';

/** Roles inside a tenant (ADR-0005). Platform super-admins live in a separate table. */
export const ORG_ROLES = [
  'owner',
  'admin',
  'instructor',
  'escort',
  'accountant',
  'parent',
  'institution_contact',
] as const;
export const OrgRole = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof OrgRole>;

/** Granular capabilities an admin membership can be granted. Owners implicitly hold all. */
export const PERMISSIONS = [
  'billing.read',
  'billing.write',
  'payroll.read',
  'payroll.write',
  'settings.write',
  'sensitive.read',
  'audit.read',
] as const;
export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;

export const STAFF_ROLES: readonly OrgRole[] = [
  'owner',
  'admin',
  'instructor',
  'escort',
  'accountant',
];

/** App surfaces (route groups) and which roles may enter them. */
export const SURFACES = {
  admin: ['owner', 'admin'],
  instructor: ['instructor', 'owner', 'admin'],
  transport: ['escort', 'owner', 'admin'],
  accountant: ['accountant', 'owner'],
  parent: ['parent'],
} as const satisfies Record<string, readonly OrgRole[]>;
export type Surface = keyof typeof SURFACES;

export function canEnterSurface(role: OrgRole, surface: Surface): boolean {
  return (SURFACES[surface] as readonly OrgRole[]).includes(role);
}

export function hasPermission(
  role: OrgRole,
  permissions: readonly Permission[],
  needed: Permission,
): boolean {
  return role === 'owner' || permissions.includes(needed);
}

/** Where a user lands after login. */
export function homeSurface(role: OrgRole): Surface | null {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'admin';
    case 'instructor':
      return 'instructor';
    case 'escort':
      return 'transport';
    case 'accountant':
      return 'accountant';
    case 'parent':
      return 'parent';
    case 'institution_contact':
      return null; // institution portal arrives in a later phase
  }
}
