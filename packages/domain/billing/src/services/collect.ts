/**
 * The worker's side of collecting (side effects only here, convention 6): charge a posted run through each family's
 * standing order or send a payment link, run the daily dunning steps, refund through the provider and cancel
 * mandates there. Every provider call carries an idempotency key derived from our row, so a retried job repeats
 * nothing.
 */
import { and, eq, inArray, lte, or, isNull, schema, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import type { ChargeResult, PaymentProvider } from '@rswim/integrations';
import { agorot } from '@rswim/money';
import { dunningNextStep } from '../policies';
import { appendCaseLog, closeCaseIfPaid } from './dunning';
import { balanceOfHousehold } from './ledger';
import {
  chargeableMandate,
  createPendingPayment,
  failPayment,
  requestPaymentLink,
  settlePayment,
} from './payments';
import { runTotalsByHousehold } from './runs';
import { orgBillingRules, todayIL } from './shared';

const { billingRuns, dunningCases, paymentLinks, payments } = schema;

const providerCtx = (ctx: ServiceContext, idempotencyKey: string) => ({
  organizationId: ctx.orgId,
  idempotencyKey,
});

/** Applies what the provider answered for a charge (at once, or later from its webhook). */
export async function applyChargeResult(
  tx: Tx,
  ctx: ServiceContext,
  paymentId: string,
  result: ChargeResult,
) {
  if (result.status === 'succeeded') {
    await settlePayment(tx, ctx, paymentId, { externalId: result.externalPaymentId });
  } else if (result.status === 'failed') {
    await failPayment(tx, ctx, paymentId, {
      reason: result.failureReason ?? 'failed',
      externalId: result.externalPaymentId,
    });
  } else {
    await tx
      .update(payments)
      .set({ externalId: result.externalPaymentId })
      .where(eq(payments.id, paymentId));
  }
  return result.status;
}

/** Charges a household's mandate (a run's share, or a dunning retry). */
export async function chargeMandate(
  tx: Tx,
  ctx: ServiceContext,
  provider: PaymentProvider,
  input: {
    householdId: string;
    amountAgorot: number;
    idempotencyKey: string;
    description: string;
    billingRunId?: string | null;
    attempt?: number;
  },
) {
  const mandate = await chargeableMandate(tx, input.householdId);
  if (!mandate) throw new DomainError('billing.errors.noMandate');
  const payment = await createPendingPayment(tx, ctx, {
    householdId: input.householdId,
    amountAgorot: input.amountAgorot,
    method: 'standing_order',
    idempotencyKey: input.idempotencyKey,
    billingRunId: input.billingRunId,
    standingOrderId: mandate.id,
    attempt: input.attempt,
    note: input.description,
  });
  if (payment.status !== 'pending' || payment.externalId) {
    return { paymentId: payment.id, status: payment.status };
  }
  const result = await provider.chargeStandingOrder(providerCtx(ctx, payment.idempotencyKey), {
    mandateId: mandate.mandateId,
    amount: agorot(input.amountAgorot),
    description: input.description,
  });
  return { paymentId: payment.id, status: await applyChargeResult(tx, ctx, payment.id, result) };
}

/** Creates an open link at the provider (once) and announces it for Phase 5 to send. */
export async function createLinkAtProvider(
  tx: Tx,
  ctx: ServiceContext,
  provider: PaymentProvider,
  linkId: string,
) {
  const [link] = await tx.select().from(paymentLinks).where(eq(paymentLinks.id, linkId));
  if (!link) throw new DomainError('common.errors.notFound');
  if (link.url || link.status !== 'open') return link.url;
  const made = await provider.createPaymentLink(providerCtx(ctx, link.idempotencyKey), {
    householdId: link.householdId,
    amount: agorot(link.amountAgorot),
    description: link.description,
    termsText: link.termsText ?? undefined,
  });
  await tx
    .update(paymentLinks)
    .set({ url: made.url, externalId: made.externalId })
    .where(eq(paymentLinks.id, linkId));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'billing.payment_link_created',
    payload: {
      linkId,
      householdId: link.householdId,
      url: made.url,
      amountAgorot: link.amountAgorot,
    },
    idempotencyKey: `billing.payment_link_created:${linkId}`,
  });
  return made.url;
}

/**
 * Collects a posted run: each household's share (no more than what it owes after credits) is charged through its
 * standing order, or a payment link goes out when there is none.
 */
export async function collectRun(
  tx: Tx,
  ctx: ServiceContext,
  provider: PaymentProvider,
  runId: string,
) {
  const [run] = await tx.select().from(billingRuns).where(eq(billingRuns.id, runId));
  if (!run || run.status !== 'posted') throw new DomainError('billing.errors.runNotPosted');
  const out = { charged: 0, failed: 0, pending: 0, links: 0, skipped: 0 };
  for (const { householdId, total } of await runTotalsByHousehold(tx, runId)) {
    const amount = Math.min(total, await balanceOfHousehold(tx, householdId));
    if (amount <= 0) {
      out.skipped++;
      continue;
    }
    const description = run.period;
    if (await chargeableMandate(tx, householdId)) {
      const r = await chargeMandate(tx, ctx, provider, {
        householdId,
        amountAgorot: amount,
        idempotencyKey: `run:${runId}:${householdId}:1`,
        description,
        billingRunId: runId,
      });
      if (r.status === 'succeeded') out.charged++;
      else if (r.status === 'failed') out.failed++;
      else out.pending++;
    } else {
      const linkId = await requestPaymentLink(
        tx,
        ctx,
        {
          householdId,
          amountAgorot: amount,
          description,
          requestId: crypto.randomUUID(),
        },
        { billingRunId: runId, idempotencyKey: `run:${runId}:${householdId}` },
      );
      await createLinkAtProvider(tx, ctx, provider, linkId);
      out.links++;
    }
  }
  return out;
}

/**
 * The daily dunning pass: for each open case due today, retry the mandate, resend the link, or hand it to the owner,
 * as the policy says. A case whose household no longer owes anything closes.
 */
export async function runDunning(
  tx: Tx,
  ctx: ServiceContext,
  provider: PaymentProvider,
  todayOverride?: string,
) {
  const today = todayOverride ?? (await todayIL(tx));
  const { rules } = await orgBillingRules(tx, today);
  const cases = await tx
    .select()
    .from(dunningCases)
    .where(
      and(
        inArray(dunningCases.status, ['open', 'escalated']),
        or(isNull(dunningCases.nextActionOn), lte(dunningCases.nextActionOn, today)),
      ),
    );
  const out = { retried: 0, reminded: 0, escalated: 0, resolved: 0 };
  for (const c of cases) {
    if (await closeCaseIfPaid(tx, ctx, c.householdId)) {
      out.resolved++;
      continue;
    }
    const mandate = await chargeableMandate(tx, c.householdId);
    const step = dunningNextStep(
      {
        openedOn: c.openedOn,
        status: c.status as 'open' | 'escalated',
        retriesDone: c.retriesDone,
        hasMandate: !!mandate,
      },
      today,
      rules.dunning,
    );
    if (step.action === 'escalate') {
      await appendCaseLog(tx, c.id, 'escalated', step.explanation, {
        status: 'escalated',
        escalatedAt: new Date(),
        nextActionOn: dunningNextStep(
          { ...c, status: 'escalated', hasMandate: !!mandate },
          today,
          rules.dunning,
        ).nextOn,
      });
      await emit(tx, {
        organizationId: ctx.orgId,
        type: 'billing.dunning_escalated',
        payload: {
          caseId: c.id,
          householdId: c.householdId,
          amountAgorot: c.amountAgorot,
          pauseEnrollment: step.pauseEnrollment,
        },
        idempotencyKey: `billing.dunning_escalated:${c.id}`,
      });
      out.escalated++;
    } else if (step.action === 'retry' || step.action === 'remind') {
      const attempt = c.retriesDone + 1;
      const owed = await balanceOfHousehold(tx, c.householdId);
      const amount = Math.min(c.amountAgorot, owed);
      let paymentId: string | null = null;
      if (step.action === 'retry') {
        const r = await chargeMandate(tx, ctx, provider, {
          householdId: c.householdId,
          amountAgorot: amount,
          idempotencyKey: `dunning:${c.id}:${attempt}`,
          description: 'retry',
          attempt: attempt + 1,
        });
        paymentId = r.paymentId;
        out.retried++;
      } else {
        await emit(tx, {
          organizationId: ctx.orgId,
          type: 'billing.dunning_step',
          payload: {
            caseId: c.id,
            householdId: c.householdId,
            step: 'reminder',
            amountAgorot: amount,
          },
          idempotencyKey: `billing.dunning_step:${c.id}:reminder:${attempt}`,
        });
        out.reminded++;
      }
      // A retry that succeeded already closed the case; otherwise schedule the next step.
      const [after] = await tx.select().from(dunningCases).where(eq(dunningCases.id, c.id));
      if (after && ['open', 'escalated'].includes(after.status)) {
        const next = dunningNextStep(
          {
            openedOn: c.openedOn,
            status: after.status as 'open' | 'escalated',
            retriesDone: attempt,
            hasMandate: !!mandate,
          },
          today,
          rules.dunning,
        );
        await appendCaseLog(
          tx,
          c.id,
          step.action,
          step.explanation,
          { retriesDone: attempt, nextActionOn: next.nextOn },
          paymentId,
        );
      }
    } else {
      await tx
        .update(dunningCases)
        .set({ nextActionOn: step.nextOn })
        .where(eq(dunningCases.id, c.id));
    }
  }
  return out;
}

/** Refunds a card payment through the provider, then records the refund. */
export async function completeProviderRefund(
  tx: Tx,
  ctx: ServiceContext,
  provider: PaymentProvider,
  refundId: string,
) {
  const [r] = await tx.select().from(payments).where(eq(payments.id, refundId));
  if (!r || r.kind !== 'refund' || r.status !== 'pending' || !r.refundOfPaymentId) return null;
  const [original] = await tx.select().from(payments).where(eq(payments.id, r.refundOfPaymentId));
  if (!original?.externalId) throw new DomainError('billing.errors.notProviderPayment');
  const done = await provider.refund(providerCtx(ctx, r.idempotencyKey), {
    externalPaymentId: original.externalId,
    amount: agorot(r.amountAgorot),
  });
  await settlePayment(tx, ctx, r.id, { externalId: done.externalRefundId });
  return done.externalRefundId;
}
