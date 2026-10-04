'use server';

import { z } from 'zod';
import { BillingPeriod } from '@rswim/contracts';
import {
  addAdjustment,
  AdjustmentInput,
  approvePayrollRun,
  deleteAdjustment,
  draftPayrollRun,
  recordSickDay,
  resolveTimesheet,
  ResolveInput,
  SickDayInput,
} from '@rswim/domain-payroll';
import {
  cancelSubstituteRequest,
  requestSubstitute,
  SubstituteRequestInput,
} from '@rswim/domain-scheduling';
import {
  ApplicantInput,
  ApplicantStageInput,
  createApplicant,
  updateApplicantStage,
} from '@rswim/domain-staff';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const Id = z.object({ id: z.uuid() });
const PAYROLL = '/admin/staff/payroll';
const TIMESHEETS = '/admin/staff/timesheets';
const SUBSTITUTES = '/admin/staff/substitutes';
const RECRUITING = '/admin/staff/recruiting';

export async function draftPayrollAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ period: BillingPeriod }),
    (tx, ctx, { period }) => draftPayrollRun(tx, ctx, period),
    { revalidate: PAYROLL, success: 'staffops.payroll.drafted' },
  );
}

export async function approvePayrollAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, ctx, { id }) => approvePayrollRun(tx, ctx, id), {
    revalidate: PAYROLL,
    success: 'staffops.payroll.approvedOk',
  });
}

export async function addAdjustmentAction(_: FormState, fd: FormData) {
  return runForm(fd, AdjustmentInput, (tx, ctx, input) => addAdjustment(tx, ctx, input), {
    revalidate: PAYROLL,
    success: 'staffops.payroll.adjustmentAdded',
  });
}

export async function deleteAdjustmentAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => deleteAdjustment(tx, id), {
    revalidate: PAYROLL,
  });
}

export async function recordSickDayAction(_: FormState, fd: FormData) {
  return runForm(fd, SickDayInput, (tx, ctx, input) => recordSickDay(tx, ctx, input), {
    revalidate: PAYROLL,
    success: 'staffops.payroll.sickRecorded',
  });
}

export async function resolveTimesheetAction(_: FormState, fd: FormData) {
  return runForm(fd, ResolveInput, (tx, ctx, input) => resolveTimesheet(tx, ctx, input), {
    revalidate: [TIMESHEETS, PAYROLL],
    success: 'staffops.timesheets.resolved',
  });
}

export async function requestSubstituteAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    SubstituteRequestInput,
    (tx, ctx, input) => requestSubstitute(tx, ctx, input),
    {
      revalidate: SUBSTITUTES,
      success: (r, tr) => tr('staffops.substitutes.requested', { n: r.offered }),
    },
  );
}

export async function cancelSubstituteAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => cancelSubstituteRequest(tx, id), {
    revalidate: SUBSTITUTES,
  });
}

export async function createApplicantAction(_: FormState, fd: FormData) {
  return runForm(fd, ApplicantInput, (tx, ctx, input) => createApplicant(tx, ctx, input), {
    revalidate: RECRUITING,
    success: 'staffops.recruiting.added',
  });
}

export async function updateApplicantAction(_: FormState, fd: FormData) {
  return runForm(fd, ApplicantStageInput, (tx, _ctx, input) => updateApplicantStage(tx, input), {
    revalidate: RECRUITING,
    success: 'staffops.recruiting.updated',
  });
}
