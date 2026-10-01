import type { OrgRole, Permission } from '@rswim/contracts';

export interface Session {
  userId: string;
  orgId: string | null;
  role: OrgRole | null;
  permissions: Permission[];
  isPlatformAdmin: boolean;
  displayName?: string;
  orgName?: string;
  mode: 'supabase' | 'dev';
}
