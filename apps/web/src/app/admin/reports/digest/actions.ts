'use server';

import { z } from 'zod';
import { buildWeeklyDigest, sundayOf, todayIL } from '@rswim/domain-reports';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/** Builds this week's digest now (the worker does it every Sunday morning). */
export async function buildDigestAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({}),
    async (tx, ctx) => {
      await buildWeeklyDigest(tx, ctx, sundayOf(await todayIL(tx)));
    },
    { revalidate: '/admin/reports/digest', success: 'reports.digest.built' },
  );
}
