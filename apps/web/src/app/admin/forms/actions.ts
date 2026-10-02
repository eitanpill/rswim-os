'use server';

import { z } from 'zod';
import {
  createFormVersion,
  FormTemplateInput,
  publishFormVersion,
  SubmissionInput,
  submitForm,
} from '@rswim/domain-enrollment';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';
import { answersFrom } from '@/lib/answers';

const PATH = '/admin/forms';

export async function createFormVersionAction(_: FormState, fd: FormData) {
  // The service parses again, so the questions go back as the lines the owner typed.
  return runForm(
    fd,
    FormTemplateInput,
    (tx, ctx, input) =>
      createFormVersion(tx, ctx, {
        ...input,
        questions: input.questions.map((q) => q.he).join('\n'),
      }),
    {
      revalidate: PATH,
      success: 'enrollment.forms.draftSaved',
    },
  );
}

export async function publishFormAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid() }),
    (tx, ctx, { id }) => publishFormVersion(tx, ctx, id),
    { revalidate: PATH },
  );
}

/** The office records an acceptance given on paper or by phone, with the "yes" answers ticked. */
export async function recordAcceptanceAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    SubmissionInput,
    (tx, ctx, input) => submitForm(tx, ctx, input),
    {
      revalidate: `/admin/families/${String(fd.get('householdId'))}`,
      success: 'enrollment.forms.recorded',
    },
    answersFrom,
  );
}
