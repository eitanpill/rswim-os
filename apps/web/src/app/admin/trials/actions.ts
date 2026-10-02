'use server';

import { z } from 'zod';
import {
  bookTrial,
  cancelTrial,
  ConvertInput,
  convertTrial,
  recordTrialVerdict,
  TrialInput,
  VerdictInput,
} from '@rswim/domain-enrollment';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PATH = '/admin/trials';

export async function bookTrialAction(_: FormState, fd: FormData) {
  return runForm(fd, TrialInput, (tx, ctx, input) => bookTrial(tx, ctx, input), {
    revalidate: PATH,
    success: 'enrollment.trials.bookedOk',
  });
}

export async function cancelTrialAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({ id: z.uuid() }), (tx, ctx, { id }) => cancelTrial(tx, ctx, id), {
    revalidate: PATH,
  });
}

export async function trialVerdictAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    VerdictInput.and(z.object({ id: z.uuid() })),
    (tx, ctx, { id, ...verdict }) => recordTrialVerdict(tx, ctx, id, verdict),
    { revalidate: [PATH, '/instructor'] },
  );
}

/** Converts a trial into a seat; the trial-fee offset is shown as the regulations decided it. */
export async function convertTrialAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    ConvertInput.extend({ id: z.uuid() }),
    (tx, ctx, { id, ...input }) => convertTrial(tx, ctx, id, input),
    {
      revalidate: PATH,
      success: (r, tr) =>
        `${tr('enrollment.trials.converted')} · ${tr(r.offset.explanation.code, {
          ...r.offset.explanation.params,
          ...('amount' in r.offset.explanation.params
            ? { amount: (Number(r.offset.explanation.params.amount) / 100).toString() }
            : {}),
        })}`,
    },
  );
}
