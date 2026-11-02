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
import {
  addAvailabilityException,
  addAvailabilityRule,
  AvailabilityExceptionInput,
  AvailabilityRuleInput,
  deleteAvailabilityException,
  deleteAvailabilityRule,
  myStaffId,
} from '@rswim/domain-staff';
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

// ─── My profile: the instructor keeps their own availability current (RLS limits them to their own rows) ──────

const ProfileId = z.object({ id: z.uuid() });
const profileDone = { revalidate: '/instructor/profile', success: 'instructor.profile.saved' };

export async function addMyAvailabilityAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    AvailabilityRuleInput,
    async (tx, ctx, input) => addAvailabilityRule(tx, ctx, await ownStaffId(tx), input),
    profileDone,
  );
}

export async function deleteMyAvailabilityAction(_: FormState, fd: FormData) {
  return runForm(fd, ProfileId, (tx, _ctx, { id }) => deleteAvailabilityRule(tx, id), profileDone);
}

export async function addMyExceptionAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    AvailabilityExceptionInput,
    async (tx, ctx, input) => addAvailabilityException(tx, ctx, await ownStaffId(tx), input),
    profileDone,
  );
}

export async function deleteMyExceptionAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    ProfileId,
    (tx, _ctx, { id }) => deleteAvailabilityException(tx, id),
    profileDone,
  );
}
