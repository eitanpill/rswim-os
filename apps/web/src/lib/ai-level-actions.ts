'use server';

import { z } from 'zod';
import { AiLevel } from '@rswim/contracts';
import { setAiLevel } from '@rswim/domain-copilot';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/** The owner picks how strong a model answers for the business; the brain's settings are hers alone (RLS). */
export async function setAiLevelAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ level: AiLevel }),
    (tx, ctx, { level }) => setAiLevel(tx, ctx, level),
    {
      revalidate: ['/admin/connections', '/dive/connections', '/admin/brain', '/admin/copilot'],
      success: 'aiLevel.saved',
    },
  );
}
