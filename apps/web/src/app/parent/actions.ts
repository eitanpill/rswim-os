'use server';

import { z } from 'zod';
import {
  AbsenceInput,
  BookMakeupInput,
  bookMakeup,
  cancelMakeupBooking,
  reportAbsence,
  withdrawNotice,
} from '@rswim/domain-attendance';
import { SubmissionInput, submitForm } from '@rswim/domain-enrollment';
import { answersFrom } from '@/lib/answers';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PATHS = ['/parent', '/parent/schedule'];

/** The family reports an absence; the regulations decide on the credit right after (never the family). */
export async function parentAbsenceAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    AbsenceInput.pick({ sessionId: true, studentId: true }),
    (tx, ctx, input) => reportAbsence(tx, ctx, input),
    { revalidate: PATHS, success: 'parent.schedule.reported' },
  );
}

export async function parentWithdrawAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({ id: z.uuid() }), (tx, ctx, { id }) => withdrawNotice(tx, ctx, id), {
    revalidate: PATHS,
  });
}

export async function parentBookMakeupAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    BookMakeupInput.pick({ creditId: true, sessionId: true }),
    (tx, ctx, input) => bookMakeup(tx, ctx, input),
    { redirectTo: () => '/parent/schedule?booked=1' },
  );
}

export async function parentCancelMakeupAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid() }),
    (tx, ctx, { id }) => cancelMakeupBooking(tx, ctx, id),
    {
      revalidate: PATHS,
    },
  );
}

export async function parentAcceptFormAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    SubmissionInput.omit({ channel: true, guardianId: true }),
    (tx, ctx, input) => submitForm(tx, ctx, { ...input, channel: 'parent_portal' }),
    { revalidate: ['/parent', '/parent/documents'], success: 'parent.documents.accepted' },
    answersFrom,
  );
}
