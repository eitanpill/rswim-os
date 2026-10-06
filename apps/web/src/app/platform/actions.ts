'use server';

import { z } from 'zod';
import {
  billingPeriod,
  requestBilling,
  reviewTemplate,
  SchoolUpdateInput,
  updateSchool,
} from '@rswim/domain-platform';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';
import { todayIL } from '@/lib/options';

export async function updateSchoolAction(_: FormState, fd: FormData) {
  return runForm(fd, SchoolUpdateInput, (tx, _ctx, input) => updateSchool(tx, input, todayIL()), {
    scope: 'platform',
    revalidate: '/platform',
  });
}

const BillingInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'platform.errors.period'),
});

export async function requestBillingAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    BillingInput,
    (tx, _ctx, { month }) => requestBilling(tx, billingPeriod(`${month}-01`)),
    {
      scope: 'platform',
      revalidate: '/platform',
      success: (n, tr) => tr('platform.console.billingQueued', { count: n }),
    },
  );
}

const Review = z.object({ id: z.uuid(), decision: z.enum(['published', 'rejected']) });

export async function reviewTemplateAction(_: FormState, fd: FormData) {
  return runForm(fd, Review, (tx, ctx, { id, decision }) => reviewTemplate(tx, ctx, id, decision), {
    scope: 'platform',
    revalidate: '/platform/templates',
  });
}
