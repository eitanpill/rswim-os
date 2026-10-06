import 'server-only';
import { redirect } from 'next/navigation';
import type { PlanFeature } from '@rswim/contracts';
import { hasFeature } from '@rswim/domain-platform';
import { withSession } from './db';

/** Guards a surface the school's plan may not include: without it, the office lands on its plan page. */
export async function requireFeature(feature: PlanFeature): Promise<void> {
  if (!(await withSession((tx) => hasFeature(tx, feature)))) {
    redirect(`/admin/plan?feature=${feature}`);
  }
}
