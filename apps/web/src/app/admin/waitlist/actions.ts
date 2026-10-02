'use server';

import { z } from 'zod';
import { requiredDate } from '@rswim/contracts';
import {
  addToWaitlist,
  placeFromWaitlist,
  WaitlistInput,
  withdrawFromWaitlist,
} from '@rswim/domain-scheduling';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PATH = '/admin/waitlist';

export async function addToWaitlistAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    WaitlistInput,
    (tx, ctx, input) => addToWaitlist(tx, ctx, input),
    { revalidate: PATH },
    (raw) => ({
      preferredWeekdays: [],
      ...raw,
    }),
  );
}

export async function withdrawAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid() }),
    (tx, _ctx, { id }) => withdrawFromWaitlist(tx, id),
    {
      revalidate: PATH,
    },
  );
}

export async function placeFromWaitlistAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid(), toTemplateId: z.uuid(), onDate: requiredDate() }),
    (tx, ctx, { id, ...input }) => placeFromWaitlist(tx, ctx, id, input),
    { revalidate: PATH },
  );
}
