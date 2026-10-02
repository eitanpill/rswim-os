'use server';

import { z } from 'zod';
import { requiredText } from '@rswim/contracts';
import {
  BookMakeupInput,
  bookMakeup,
  cancelMakeupBooking,
  GoodwillInput,
  issueGoodwillCredit,
  voidCredit,
} from '@rswim/domain-attendance';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PATH = '/admin/makeups';

export async function goodwillCreditAction(_: FormState, fd: FormData) {
  return runForm(fd, GoodwillInput, (tx, ctx, input) => issueGoodwillCredit(tx, ctx, input), {
    revalidate: PATH,
    success: 'attendance.makeups.goodwillIssued',
  });
}

export async function voidCreditAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid(), note: requiredText(300) }),
    (tx, ctx, { id, note }) => voidCredit(tx, ctx, id, note),
    { revalidate: PATH },
  );
}

/** Books a credit into a lesson; soft rules need the office's note (kept with the booking). */
export async function bookMakeupAction(_: FormState, fd: FormData) {
  return runForm(fd, BookMakeupInput, (tx, ctx, input) => bookMakeup(tx, ctx, input), {
    redirectTo: () => `${PATH}?booked=1`,
  });
}

export async function cancelMakeupAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid() }),
    (tx, ctx, { id }) => cancelMakeupBooking(tx, ctx, id),
    { revalidate: PATH },
  );
}
