'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CheckoutMethod } from '@rswim/contracts';
import { householdMoney } from '@rswim/domain-billing';
import { toDomainError } from '@rswim/domain-core';
import { withSession } from '@/lib/db';
import type { FormState } from '@/lib/form-state';
import { payNow } from '@/lib/payments';
import { myHousehold } from './family';

/**
 * The family pays what it owes, or sets up a standing order, in one tap: the balance is read as the parent (their own
 * household only), then the school's processor page opens for the method they chose.
 */
export async function familyPayAction(_: FormState, fd: FormData): Promise<FormState> {
  const t = await getTranslations();
  const fail = (code: string) => ({
    ok: false,
    errors: {},
    message: t(t.has(code) ? code : 'forms.errors.invalid'),
  });
  const method = CheckoutMethod.safeParse(fd.get('method'));
  if (!method.success) return fail('payments.errors.methodNotSupported');
  const mandateOnly = fd.get('purpose') === 'mandate';
  const me = await withSession(async (tx, ctx) => {
    const family = await myHousehold(tx);
    if (!family) return null;
    const money = await householdMoney(tx, family.household.id);
    return { ctx, householdId: family.household.id, balance: money.balance };
  });
  if (!me || !me.ctx.userId) return fail('payments.errors.notOpen');
  if (!mandateOnly && me.balance <= 0) return fail('payments.errors.nothingToPay');
  let to: string;
  try {
    to = await payNow(
      { orgId: me.ctx.orgId, userId: me.ctx.userId },
      mandateOnly
        ? {
            purpose: 'mandate',
            householdId: me.householdId,
            amountAgorot: 0,
            description: t('payments.family.mandateDescription'),
          }
        : {
            purpose: 'household',
            householdId: me.householdId,
            amountAgorot: me.balance,
            description: t('payments.family.balanceDescription'),
          },
      mandateOnly ? 'standing_order' : method.data,
    );
  } catch (e) {
    const de = toDomainError(e);
    if (!de) throw e;
    return fail(de.code);
  }
  redirect(to);
}
