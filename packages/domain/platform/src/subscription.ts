/**
 * SaaS stage 3: what a school's owner does with the subscription herself (save a card, change the plan, cancel,
 * renew, the invoice details), and the intake of the processor's card callback. The owner's changes go through
 * security-definer functions that check she is the owner (migration 0058); the callback is platform plumbing.
 */
import { z } from 'zod';
import { eq, schema, sql, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import type { CardSetupEvent } from '@rswim/integrations';
import { lastDayOnCancel, planChangeCheck } from './policies';
import { mySubscription, myUsage, planFacts, subFacts } from './services';

const { plans, platformCardSetups } = schema;

/** Opens a visit to the processor's card page for the current school (owner only, by RLS). Returns its id. */
export async function openCardSetup(tx: Tx, ctx: ServiceContext & { userId: string }) {
  if (!(await mySubscription(tx))) throw new DomainError('platform.errors.noSubscription');
  const [row] = await tx
    .insert(platformCardSetups)
    .values({ organizationId: ctx.orgId, createdBy: ctx.userId })
    .returning({ id: platformCardSetups.id });
  return (row as { id: string }).id;
}

/** Records where the processor's page is (its id), for support. */
export async function noteCardSetupExternalId(tx: Tx, setupId: string, externalId: string) {
  await tx.execute(
    sql`update platform_card_setups set external_id = ${externalId} where id = ${setupId} and status = 'open'`,
  );
}

/** The setup the owner is looking at (her school's only, by RLS), or null. */
export async function cardSetup(tx: Tx, setupId: string) {
  const [row] = await tx
    .select()
    .from(platformCardSetups)
    .where(eq(platformCardSetups.id, setupId));
  return row ?? null;
}

/**
 * The processor's verified callback (platform plumbing): saves the card on the setup's school and, when that school
 * owes money, asks the worker to charge it again. A redelivery changes nothing. Returns the school's id.
 */
export async function completeCardSetup(tx: Tx, event: CardSetupEvent): Promise<string> {
  const ok = event.type === 'card.saved' && !!event.mandateId && !!event.cardLast4;
  const { rows } = await tx.execute<{ org: string }>(
    sql`select public.complete_card_setup(${event.reference}::uuid, ${ok}, ${event.mandateId ?? null},
                                          ${event.cardLast4 ?? null}, ${event.failureReason ?? null}) org`,
  );
  return (rows[0] as { org: string }).org;
}

export const PlanChangeInput = z.object({ planCode: z.string().min(1).max(40) });

/** The owner moves to another plan now; the new price applies from the next invoice. */
export async function changeMyPlan(tx: Tx, raw: z.input<typeof PlanChangeInput>) {
  const { planCode } = PlanChangeInput.parse(raw);
  const [plan] = await tx.select().from(plans).where(eq(plans.code, planCode));
  if (!plan || !plan.active) throw new DomainError('platform.errors.plan');
  const check = planChangeCheck(await myUsage(tx), planFacts(plan));
  if (!check.ok) throw new DomainError(check.code, check.params);
  await tx.execute(sql`select public.owner_change_plan(${planCode})`);
}

/**
 * The owner cancels: the school is served to the end of its trial or of the month already paid, then the
 * subscription ends and nothing more is charged. Returns that last day.
 */
export async function cancelMySubscription(tx: Tx, today: string): Promise<string> {
  const s = await mySubscription(tx);
  if (!s) throw new DomainError('platform.errors.noSubscription');
  const last = lastDayOnCancel(subFacts(s.sub), today);
  await tx.execute(sql`select public.owner_subscription_action('cancel', ${last}::date)`);
  return last;
}

/** Undoes a cancellation that has not ended yet. */
export async function keepMySubscription(tx: Tx) {
  await tx.execute(sql`select public.owner_subscription_action('keep')`);
}

/** Renews a cancelled subscription from today; the worker bills the rest of the month. */
export async function renewMySubscription(tx: Tx) {
  await tx.execute(sql`select public.owner_subscription_action('renew')`);
}

export const BillingDetailsInput = z.object({
  billingName: z
    .string()
    .trim()
    .max(120, 'platform.errors.billingName')
    .refine((v) => v === '' || v.length >= 2, 'platform.errors.billingName'),
  billingTaxId: z
    .string()
    .trim()
    .regex(/^(\d{5,9})?$/, 'platform.errors.billingTaxId'),
  billingEmail: z.union([z.literal(''), z.email('platform.errors.billingEmail')]),
});
export type BillingDetailsInput = z.input<typeof BillingDetailsInput>;

/** Who the tax invoices are made out to (empty fields fall back to the school's name). */
export async function saveBillingDetails(tx: Tx, raw: BillingDetailsInput) {
  const i = BillingDetailsInput.parse(raw);
  await tx.execute(
    sql`select public.owner_billing_details(${i.billingName}, ${i.billingTaxId}, ${i.billingEmail})`,
  );
}
