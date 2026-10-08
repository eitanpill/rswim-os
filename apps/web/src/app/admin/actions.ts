'use server';

import { z } from 'zod';
import { dismissInsight, refreshInsights, todayIL } from '@rswim/domain-reports';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/** Sets an insight aside until the snooze date (it comes back then if still true). */
export async function dismissInsightAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({ id: z.uuid() }), dismissInsight, {
    revalidate: '/admin',
    success: 'insights.dismissed',
  });
}

/** Runs the insights check now (the worker runs it every morning). */
export async function refreshInsightsAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({}),
    async (tx, ctx) => {
      await refreshInsights(tx, ctx, await todayIL(tx));
    },
    { revalidate: '/admin', success: 'insights.refreshed' },
  );
}
