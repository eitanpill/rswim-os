import { z } from 'zod';
import { schema } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import {
  applyClosureCredits,
  applyGrowWebhook,
  applyTrialOffset,
  collectRun,
  completeProviderRefund,
  createLinkAtProvider,
  growWebhookBody,
  issueReceipts,
  markGrowWebhookProcessed,
  pendingPortalRequests,
  processPortalRequest,
  runDunning,
} from '@rswim/domain-billing';
import type { DomainEventEnvelope } from '@rswim/contracts';
import type { Tx } from '@rswim/db';
import { consumeOnce } from '@rswim/domain-core/worker';
import { getDb, inngest, log } from '../client';
import { invoicingProvider, invoicingProviderName, paymentProvider } from '../providers';
import { toEnvelope } from './core-ping';

const sys = (envelope: DomainEventEnvelope) => ({ orgId: envelope.organizationId, userId: null });

/**
 * Runs a provider-bound consumer once per event. Without a provider set up the event is left unconsumed and logged,
 * so nothing is marked done that never happened.
 */
async function withProvider<P>(
  consumer: string,
  envelope: DomainEventEnvelope,
  provider: P | null,
  handler: (provider: P, tx: Tx) => Promise<unknown>,
) {
  if (!provider) {
    log.warn({ consumer, eventId: envelope.id }, 'provider not configured; event not consumed');
    return { consumed: false, reason: 'provider_not_configured' };
  }
  let result: unknown = null;
  const consumed = await consumeOnce(getDb(), consumer, envelope, async (tx) => {
    result = await handler(provider, tx);
  });
  return { consumed, result };
}

/** A run was approved: charge each family's standing order, or send a payment link when it has none. */
export const billingCollectRun = inngest.createFunction(
  { id: 'billing-collect-run', triggers: [{ event: 'billing.run_posted' }], retries: 5 },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { runId } = z.object({ runId: z.uuid() }).parse(envelope.payload);
    return step.run('collect', () =>
      withProvider('billing-collect-run', envelope, paymentProvider(), (p, tx) =>
        collectRun(tx, sys(envelope), p, runId),
      ),
    );
  },
);

/** The office asked for a payment link: create it at the provider (Phase 5 sends it to the family). */
export const billingCreateLink = inngest.createFunction(
  {
    id: 'billing-create-link',
    triggers: [{ event: 'billing.payment_link_requested' }],
    retries: 5,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { linkId } = z.object({ linkId: z.uuid() }).parse(envelope.payload);
    return step.run('create-link', () =>
      withProvider('billing-create-link', envelope, paymentProvider(), (p, tx) =>
        createLinkAtProvider(tx, sys(envelope), p, linkId),
      ),
    );
  },
);

/** Grow → OS: apply a stored charge or link callback inside the tenant's scope. */
export const billingApplyGrowWebhook = inngest.createFunction(
  {
    id: 'billing-apply-grow-webhook',
    triggers: [{ event: 'billing.provider_webhook_received' }],
    retries: 5,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { webhookEventId } = z.object({ webhookEventId: z.uuid() }).parse(envelope.payload);
    return step.run('apply', async () => {
      const body = await growWebhookBody(getDb(), envelope.organizationId, webhookEventId);
      if (!body) return { outcome: 'missing' };
      let outcome = 'already';
      await consumeOnce(getDb(), 'billing-apply-grow-webhook', envelope, async (tx) => {
        outcome = await applyGrowWebhook(tx, sys(envelope), body);
      });
      await markGrowWebhookProcessed(getDb(), webhookEventId, outcome);
      return { outcome };
    });
  },
);

/** Every successful payment gets its invoice-receipt(s). */
export const billingIssueReceipts = inngest.createFunction(
  { id: 'billing-issue-receipts', triggers: [{ event: 'billing.payment_succeeded' }], retries: 5 },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { paymentId } = z.object({ paymentId: z.uuid() }).parse(envelope.payload);
    return step.run('issue', () =>
      withProvider('billing-issue-receipts', envelope, invoicingProvider(), (p, tx) =>
        issueReceipts(tx, sys(envelope), p, paymentId, invoicingProviderName()),
      ),
    );
  },
);

/** A card refund the office approved: refund at the provider, then record it. */
export const billingProviderRefund = inngest.createFunction(
  { id: 'billing-provider-refund', triggers: [{ event: 'billing.refund_requested' }], retries: 5 },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { refundId } = z.object({ refundId: z.uuid() }).parse(envelope.payload);
    return step.run('refund', () =>
      withProvider('billing-provider-refund', envelope, paymentProvider(), (p, tx) =>
        completeProviderRefund(tx, sys(envelope), p, refundId),
      ),
    );
  },
);

/** A standing order cancelled here is cancelled at the provider too. */
export const billingCancelMandate = inngest.createFunction(
  {
    id: 'billing-cancel-mandate',
    triggers: [{ event: 'billing.standing_order_cancelled' }],
    retries: 5,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { mandateId, provider } = z
      .object({ mandateId: z.string(), provider: z.string() })
      .parse(envelope.payload);
    if (provider !== 'grow') return { consumed: false, reason: 'not_a_provider_mandate' };
    return step.run('cancel', () =>
      withProvider('billing-cancel-mandate', envelope, paymentProvider(), (p) =>
        p.cancelStandingOrder(
          {
            organizationId: envelope.organizationId,
            idempotencyKey: `cancel-mandate:${mandateId}`,
          },
          mandateId,
        ),
      ),
    );
  },
);

/** A converted trial's fee is credited against the first bill. */
export const billingTrialOffset = inngest.createFunction(
  { id: 'billing-trial-offset', triggers: [{ event: 'enrollment.trial_converted' }], retries: 5 },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    return step.run('credit', () =>
      consumeOnce(getDb(), 'billing-trial-offset', envelope, async (tx) => {
        await applyTrialOffset(tx, sys(envelope), envelope.payload);
      }),
    );
  },
);

/** Closure credits the regulations turn into money become ledger credits. */
export const billingClosureCredits = inngest.createFunction(
  {
    id: 'billing-closure-credits',
    triggers: [{ event: 'attendance.closure_credits_converted' }],
    retries: 5,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    return step.run('credit', () =>
      consumeOnce(getDb(), 'billing-closure-credits', envelope, async (tx) => {
        await applyClosureCredits(tx, sys(envelope), envelope.payload);
      }),
    );
  },
);

/**
 * Daily (Israel time, morning): dunning retries, link reminders and escalations on the policy's days. Finding the
 * tenants is cross-tenant plumbing; the work runs per tenant under RLS.
 */
export const billingDailyDunning = inngest.createFunction(
  {
    id: 'billing-daily-dunning',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 9 * * *' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const provider = paymentProvider();
    if (!provider) {
      log.warn('payment provider not configured; dunning skipped');
      return { skipped: true };
    }
    const orgIds = await step.run('find-orgs', () =>
      asPlatform(getDb(), async (tx) =>
        (await tx.select({ id: schema.organizations.id }).from(schema.organizations)).map(
          (r) => r.id,
        ),
      ),
    );
    const totals = { retried: 0, reminded: 0, escalated: 0, resolved: 0 };
    for (const orgId of orgIds) {
      const r = await step.run(`dunning-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => runDunning(tx, { orgId, userId: null }, provider)),
      );
      totals.retried += r.retried;
      totals.reminded += r.reminded;
      totals.escalated += r.escalated;
      totals.resolved += r.resolved;
    }
    log.info(totals, 'billing daily dunning');
    return totals;
  },
);

/**
 * A family asked from the portal to freeze a seat or to leave: decide it with the office's own services (the same
 * regulations), once. The payload only names the request; the request row is the truth.
 */
export const billingPortalRequest = inngest.createFunction(
  {
    id: 'billing-portal-request',
    triggers: [{ event: 'billing.portal_request_created' }],
    retries: 5,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { requestId } = z.object({ requestId: z.uuid() }).parse(envelope.payload);
    return step.run('decide', async () => {
      let status: string | null = null;
      await consumeOnce(getDb(), 'billing-portal-request', envelope, async (tx) => {
        status = (await processPortalRequest(tx, sys(envelope), requestId))?.status ?? null;
      });
      return { status };
    });
  },
);

/** Every half hour: decide any family request whose event was lost, so nobody waits on a request forever. */
export const billingPortalRequestSweep = inngest.createFunction(
  {
    id: 'billing-portal-request-sweep',
    triggers: [{ cron: 'TZ=Asia/Jerusalem */30 * * * *' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const orgIds = await step.run('find-orgs', () =>
      asPlatform(getDb(), async (tx) =>
        (await tx.select({ id: schema.organizations.id }).from(schema.organizations)).map(
          (r) => r.id,
        ),
      ),
    );
    let decided = 0;
    for (const orgId of orgIds) {
      decided += await step.run(`requests-${orgId}`, () =>
        withOrg(getDb(), orgId, async (tx) => {
          let n = 0;
          // Only requests older than five minutes: newer ones are still in the event's hands.
          const due = (await pendingPortalRequests(tx)).filter(
            (r) => Date.now() - r.requestedAt.getTime() > 5 * 60_000,
          );
          for (const r of due)
            if (await processPortalRequest(tx, { orgId, userId: null }, r.id)) n++;
          return n;
        }),
      );
    }
    return { decided };
  },
);
