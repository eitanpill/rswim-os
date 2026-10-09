import type { OrgRole, Permission } from '@rswim/contracts';

export interface Session {
  userId: string;
  orgId: string | null;
  role: OrgRole | null;
  permissions: Permission[];
  isPlatformAdmin: boolean;
  displayName?: string;
  orgName?: string;
  /** The school's kind: a freediving club's people land in /dive. */
  vertical?: 'swim' | 'freediving';
  mode: 'supabase' | 'dev';
}
