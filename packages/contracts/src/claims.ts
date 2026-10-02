import { z } from 'zod';
import { OrgRole, Permission } from './roles';

/**
 * Claims our Supabase access-token hook adds to the JWT (see db migration custom_access_token_hook).
 * `app_role` avoids clashing with Postgres' own `role` claim (`authenticated`).
 */
export const AppClaims = z.object({
  sub: z.uuid(),
  org_id: z.uuid().nullable(),
  app_role: OrgRole.nullable(),
  permissions: z.array(Permission).default([]),
  is_platform_admin: z.boolean().default(false),
});
export type AppClaims = z.infer<typeof AppClaims>;
