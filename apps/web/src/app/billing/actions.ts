'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import {
  BillingDetailsInput,
  cancelMySubscription,
  cardSetup,
  changeMyPlan,
  keepMySubscription,
  PlanChangeInput,
  renewMySubscription,
  saveBillingDetails,
  todayIL,
} from '@rswim/domain-platform';
import { withControlPlane } from '@/lib/db';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';
import { sandboxCardAnswer, startCardSetup } from '@/lib/platform-card';

/** Only a path on this site, so a crafted link cannot send the owner elsewhere after the card page. */
const safeBack = (v: FormDataEntryValue | null) => {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') ? s : '/billing';
};

const REFRESH = ['/billing', '/admin/plan'];

/** Sends the owner to the processor's card page (the card is saved there, not charged). */
export async function startCardAction(_: FormState, fd: FormData): Promise<FormState> {
  const url = await startCardSetup(safeBack(fd.get('back')));
  if (!url) {
    const t = await getTranslations('platform.billing.card');
    return { ok: false, errors: {}, message: t('notConfigured') };
  }
  redirect(url);
}

const SandboxAnswer = z.object({
  setup: z.uuid(),
  answer: z.enum(['approve', 'approveFail', 'decline']),
});

/** The demo card page's buttons: the demo processor calls back exactly as a real one would. */
export async function sandboxCardAction(_: FormState, fd: FormData): Promise<FormState> {
  const back = safeBack(fd.get('back'));
  const parsed = SandboxAnswer.safeParse({ setup: fd.get('setup'), answer: fd.get('answer') });
  const t = await getTranslations('platform.errors');
  if (!parsed.success) return { ok: false, errors: {}, message: t('cardSetup') };
  const { setup, answer } = parsed.data;
  // The owner's own setup only (RLS), still open.
  const row = await withControlPlane((tx) => cardSetup(tx, setup));
  if (!row || row.status !== 'open') return { ok: false, errors: {}, message: t('cardSetup') };
  const ok = await sandboxCardAnswer(setup, answer !== 'decline', answer === 'approveFail');
  if (!ok) return { ok: false, errors: {}, message: t('cardSetup') };
  redirect(
    `${back}${back.includes('?') ? '&' : '?'}card=${answer === 'decline' ? 'failed' : 'saved'}`,
  );
}

export async function changePlanAction(_: FormState, fd: FormData): Promise<FormState> {
  return runForm(fd, PlanChangeInput, (tx, _ctx, d) => changeMyPlan(tx, d), {
    scope: 'control',
    revalidate: REFRESH,
    success: 'platform.billing.change.done',
  });
}

const Nothing = z.object({});

export async function cancelSubscriptionAction(_: FormState, fd: FormData): Promise<FormState> {
  return runForm(fd, Nothing, async (tx) => cancelMySubscription(tx, await todayIL(tx)), {
    scope: 'control',
    revalidate: REFRESH,
  });
}

export async function keepSubscriptionAction(_: FormState, fd: FormData): Promise<FormState> {
  return runForm(fd, Nothing, (tx) => keepMySubscription(tx), {
    scope: 'control',
    revalidate: REFRESH,
    success: 'platform.billing.cancel.kept',
  });
}

export async function renewSubscriptionAction(_: FormState, fd: FormData): Promise<FormState> {
  return runForm(fd, Nothing, (tx) => renewMySubscription(tx), {
    scope: 'control',
    revalidate: REFRESH,
    success: 'platform.billing.cancel.renewed',
  });
}

export async function billingDetailsAction(_: FormState, fd: FormData): Promise<FormState> {
  return runForm(fd, BillingDetailsInput, (tx, _ctx, d) => saveBillingDetails(tx, d), {
    scope: 'control',
    revalidate: REFRESH,
    success: 'platform.billing.details.saved',
  });
}
