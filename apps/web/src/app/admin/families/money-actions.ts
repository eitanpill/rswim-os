'use server';

import { z } from 'zod';
import { optionalText } from '@rswim/contracts';
import {
  AdjustmentInput,
  addStandingOrder,
  BillingDetailsInput,
  CancellationInput,
  cancelPaymentLink,
  cancelStandingOrder,
  decideFreeze,
  FreezeInput,
  LinkInput,
  ManualPaymentInput,
  postAdjustment,
  recordManualPayment,
  RefundInput,
  refundPayment,
  requestCancellation,
  requestFreeze,
  requestPaymentLink,
  reverseEntry,
  saveBillingDetails,
  StandingOrderInput,
  withdrawCancellation,
} from '@rswim/domain-billing';
import type { FormState } from '@/lib/form-state';
import { runForm, shekelFields } from '@/lib/forms';

const page = (householdId: string) => ({ revalidate: `/admin/families/${householdId}` });
const amount = shekelFields('amountAgorot');
const byId = z.object({ id: z.uuid() });

export async function recordPaymentAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    ManualPaymentInput,
    (tx, ctx, i) => recordManualPayment(tx, ctx, i),
    page(householdId),
    amount,
  );
}

export async function adjustmentAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    AdjustmentInput,
    (tx, ctx, i) => postAdjustment(tx, ctx, i),
    page(householdId),
    amount,
  );
}

export async function reverseEntryAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid(), note: optionalText(300) }),
    (tx, ctx, { id, note }) => reverseEntry(tx, ctx, id, note ?? null),
    page(householdId),
  );
}

export async function refundAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    RefundInput,
    (tx, ctx, i) => refundPayment(tx, ctx, i),
    page(householdId),
    amount,
  );
}

export async function addMandateAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    StandingOrderInput,
    (tx, ctx, i) => addStandingOrder(tx, ctx, i),
    page(householdId),
    amount,
  );
}

export async function cancelMandateAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    byId,
    (tx, ctx, { id }) => cancelStandingOrder(tx, ctx, id),
    page(householdId),
  );
}

export async function requestLinkAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    LinkInput,
    (tx, ctx, i) => requestPaymentLink(tx, ctx, i),
    page(householdId),
    amount,
  );
}

export async function cancelLinkAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(fd, byId, (tx, _ctx, { id }) => cancelPaymentLink(tx, id), page(householdId));
}

export async function saveBillingDetailsAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    BillingDetailsInput,
    (tx, ctx, i) => saveBillingDetails(tx, ctx, i),
    page(householdId),
  );
}

export async function requestFreezeAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(fd, FreezeInput, (tx, ctx, i) => requestFreeze(tx, ctx, i), {
    ...page(householdId),
    errorField: (path) => String(path[0] ?? 'toDate'),
  });
}

export async function cancelFreezeAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    byId,
    (tx, ctx, { id }) => decideFreeze(tx, ctx, id, 'cancelled'),
    page(householdId),
  );
}

export async function requestCancellationAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    CancellationInput,
    (tx, ctx, i) => requestCancellation(tx, ctx, i),
    page(householdId),
  );
}

export async function withdrawCancellationAction(householdId: string, _: FormState, fd: FormData) {
  return runForm(
    fd,
    byId,
    (tx, ctx, { id }) => withdrawCancellation(tx, ctx, id),
    page(householdId),
  );
}
