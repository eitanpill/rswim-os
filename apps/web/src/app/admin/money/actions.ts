'use server';

import { z } from 'zod';
import { BillingPeriod, optionalText } from '@rswim/contracts';
import {
  decideFreeze,
  discardRun,
  draftRun,
  markHandedOver,
  postRun,
  writeOffCase,
} from '@rswim/domain-billing';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PATH = '/admin/money';

/** Drafts (or redrafts) a month and opens its review screen. */
export async function draftRunAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ period: BillingPeriod }),
    (tx, ctx, { period }) => draftRun(tx, ctx, period),
    { redirectTo: (r) => `${PATH}/runs/${r.runId}` },
  );
}

export async function postRunAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({ id: z.uuid() }), (tx, ctx, { id }) => postRun(tx, ctx, id), {
    revalidate: [`${PATH}/runs`, PATH],
    success: 'money.review.approved',
  });
}

export async function discardRunAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({ id: z.uuid() }), (tx, _ctx, { id }) => discardRun(tx, id), {
    redirectTo: () => `${PATH}/runs`,
  });
}

export async function writeOffAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid(), note: optionalText(300) }),
    (tx, ctx, { id, note }) => writeOffCase(tx, ctx, id, note ?? null),
    { revalidate: PATH, success: 'money.overview.writtenOff' },
  );
}

export async function handOverAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({ id: z.uuid() }), (tx, _ctx, { id }) => markHandedOver(tx, [id]), {
    revalidate: `${PATH}/cash`,
  });
}

export async function decideFreezeAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid(), decision: z.enum(['approved', 'rejected']) }),
    (tx, ctx, { id, decision }) => decideFreeze(tx, ctx, id, decision),
    { revalidate: `${PATH}/freezes` },
  );
}
