import 'server-only';
import { mySchools } from '@rswim/domain-platform';
import { withSignedIn } from '../db';
import type { Session } from './types';

/**
 * True when the signed-in person belongs to more than one school (or holds roles in two): the shells then show a
 * "Switch" button to /me/schools. One small query on the platform database.
 */
export async function canSwitchSchool(session: Session): Promise<boolean> {
  if (!session.orgId) return false;
  return (await withSignedIn((tx) => mySchools(tx))).length > 1;
}
