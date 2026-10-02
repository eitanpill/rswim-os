'use server';

import { AnswerInput, answerShiftChange } from '@rswim/domain-scheduling';
import { z } from 'zod';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/** The instructor accepts or declines a change to their shift; the worker applies an accepted one. */
export async function answerShiftChangeAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    AnswerInput.extend({ id: z.uuid() }),
    (tx, ctx, { id, ...answer }) => answerShiftChange(tx, ctx, id, answer),
    // The answered card leaves the list, so the confirmation is shown on the page itself.
    { redirectTo: () => '/instructor?answered=1' },
  );
}
