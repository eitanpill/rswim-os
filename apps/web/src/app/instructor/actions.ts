'use server';

import { z } from 'zod';
import type { Tx } from '@rswim/db';
import { DomainError } from '@rswim/domain-core';
import { answerTimesheet, TimesheetAnswer } from '@rswim/domain-payroll';
import {
  AnswerInput,
  answerShiftChange,
  answerSubstituteOffer,
  OfferAnswer,
} from '@rswim/domain-scheduling';
import { myStaffId } from '@rswim/domain-staff';
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

async function ownStaffId(tx: Tx) {
  const id = await myStaffId(tx);
  if (!id) throw new DomainError('common.errors.forbidden');
  return id;
}

/** The instructor confirms their month, or says what is wrong with it. */
export async function answerTimesheetAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    TimesheetAnswer,
    async (tx, ctx, input) => answerTimesheet(tx, ctx, await ownStaffId(tx), input),
    { revalidate: '/instructor/hours', success: 'instructor.hours.answered' },
  );
}

/** The instructor takes or passes on a lesson offered to them; the first to take it gets it. */
export async function answerOfferAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    OfferAnswer,
    async (tx, ctx, input) => answerSubstituteOffer(tx, ctx, await ownStaffId(tx), input),
    { redirectTo: (r) => `/instructor/swaps?answered=${r}` },
  );
}
