'use server';

import { z } from 'zod';
import {
  askCopilot,
  confirmCopilotAction,
  dismissCopilotAction,
  undoCopilotAction,
} from '@rswim/domain-copilot';
import { todayIL } from '@rswim/domain-scheduling';
import { copilotModel } from '@/lib/copilot';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PAGE = '/admin/copilot';
const WithId = z.object({ id: z.uuid() });

export async function askCopilotAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ prompt: z.string().trim().min(1, 'forms.errors.required').max(2000) }),
    async (tx, ctx, { prompt }) => askCopilot(tx, ctx, copilotModel(await todayIL(tx)), prompt),
    { revalidate: PAGE },
  );
}

/** Runs the proposal through its service; a refusal by the rules is stored on the card with its reason. */
export async function confirmCopilotActionAction(_: FormState, fd: FormData) {
  return runForm(fd, WithId, (tx, ctx, { id }) => confirmCopilotAction(tx, ctx, id), {
    revalidate: PAGE,
    success: (r, tr) => (r.status === 'failed' ? tr(r.code, r.params) : tr('copilot.confirmed')),
  });
}

export async function dismissCopilotActionAction(_: FormState, fd: FormData) {
  return runForm(fd, WithId, (tx, ctx, { id }) => dismissCopilotAction(tx, ctx, id), {
    revalidate: PAGE,
  });
}

export async function undoCopilotActionAction(_: FormState, fd: FormData) {
  return runForm(fd, WithId, (tx, ctx, { id }) => undoCopilotAction(tx, ctx, id), {
    revalidate: PAGE,
    success: 'copilot.undone',
  });
}
