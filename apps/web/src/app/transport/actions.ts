'use server';

import { MarkInput, markRider, recordStage, StageInput } from '@rswim/domain-transport';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/** The escort's taps. The database stamps who and when, and allows only today's runs of their own routes. */
export async function escortStageAction(_: FormState, fd: FormData) {
  return runForm(fd, StageInput, (tx, ctx, input) => recordStage(tx, ctx, input), {
    revalidate: '/transport',
  });
}

export async function escortMarkAction(_: FormState, fd: FormData) {
  return runForm(fd, MarkInput, (tx, ctx, input) => markRider(tx, ctx, input), {
    revalidate: '/transport',
  });
}
