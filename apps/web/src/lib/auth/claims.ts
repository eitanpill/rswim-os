import { AppClaims } from '@rswim/contracts';
import type { Session } from './types';

/** Turns verified JWT claims (from our access-token hook) into a session. */
export function sessionFromClaims(claims: unknown): Session | null {
  const parsed = AppClaims.safeParse(claims);
  if (!parsed.success) return null;
  const c = parsed.data;
  return {
    userId: c.sub,
    orgId: c.org_id,
    role: c.app_role,
    permissions: c.permissions,
    isPlatformAdmin: c.is_platform_admin,
    mode: 'supabase',
  };
}
