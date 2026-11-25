import { z } from 'zod';
import { INBOUND_INTENTS, type ClaudeUsage, type DomainEventEnvelope } from '@rswim/contracts';
import { asPlatform, withOrg } from '@rswim/db/service';
import {
  applyAiClassification,
  commsRules,
  dispatchDue,
  dueBroadcasts,
  expandBroadcast,
  inboundContext,
  orgsWithDueMessages,
  RESOLVERS,
  runAutomation,
  sendHolidayNotice,
} from '@rswim/domain-comms';
import { aiLevel, runBrainInbound, runParentBot } from '@rswim/domain-copilot';
import { syncPipelineStage, type PipelineStage } from '@rswim/domain-crm';
import { consumeOnce } from '@rswim/domain-core/worker';
import { aiAllowed, recordAiUsage } from '@rswim/domain-platform';
import { trackUsage } from '@rswim/integrations';
import { TICK_CRON } from '../ticks';
import { todayIL } from '@rswim/domain-scheduling';
import { and, eq, lte, schema } from '@rswim/db';
import { getDb, inngest, log } from '../client';
import { ghlFor, messagingFor } from '../ghl';
import {
  botConfigured,
  ownerCopilotModel,
  parentBotModel,
  publicUrl,
  pushProvider,
  triageClassifier,
} from '../providers';
import { toEnvelope } from './core-ping';

const sys = (envelope: DomainEventEnvelope) => ({ orgId: envelope.organizationId, userId: null });

/** Inngest refuses a function with more than this many triggers (and with it the whole app's registration). */
export const MAX_TRIGGERS = 10;

const automationEvents = Object.keys(RESOLVERS);

/**
 * Domain events that message families: render the template per guardian and queue (or log as blocked). There are
 * more events than one function may listen to, so the same handler is registered as several functions of at most
 * MAX_TRIGGERS events each; every event belongs to exactly one, and they share the consumer name for idempotency.
 */
export const commsAutomations = Array.from(
  { length: Math.ceil(automationEvents.length / MAX_TRIGGERS) },
  (_, i) =>
    inngest.createFunction(
      {
        id: i === 0 ? 'comms-automation' : `comms-automation-${i + 1}`,
        triggers: automationEvents
          .slice(i * MAX_TRIGGERS, (i + 1) * MAX_TRIGGERS)
          .map((event) => ({ event })),
        retries: 5,
      },
      async ({ event, step }) => {
        const envelope = toEnvelope(event);
        return step.run('queue', async () => {
          let result: unknown = null;
          await consumeOnce(getDb(), 'comms-automation', envelope, async (tx) => {
            result = await runAutomation(tx, sys(envelope), {
              id: envelope.id,
              type: envelope.type,
              payload: envelope.payload,
            });
          });
          return result;
        });
      },
    ),
);

/**
 * Every few minutes (`TICK_CRON`): expand scheduled broadcasts whose time came, then send due messages through the provider. The send
 * window (quiet hours, Shabbat and Yom Tov) is decided again at send time. Finding the tenants is cross-tenant
 * plumbing; the work runs per tenant under RLS.
 */
export const commsDispatch = inngest.createFunction(
  { id: 'comms-dispatch', triggers: [{ cron: TICK_CRON }], concurrency: { limit: 1 } },
  async ({ step }) => {
    const now = new Date();
    // A read, outside a step: an idle run (nothing due) costs one Inngest execution, not two.
    const orgIds = await asPlatform(getDb(), async (tx) => {
      const broadcasting = (
        await tx
          .selectDistinct({ id: schema.broadcasts.organizationId })
          .from(schema.broadcasts)
          .where(
            and(
              eq(schema.broadcasts.status, 'scheduled'),
              lte(schema.broadcasts.scheduledFor, now),
            ),
          )
      ).map((r) => r.id);
      return [...new Set([...(await orgsWithDueMessages(tx, now)), ...broadcasting])];
    });
    if (orgIds.length === 0) return { idle: true };
    const totals = {
      sent: 0,
      held: 0,
      failed: 0,
      retrying: 0,
      blocked: 0,
      broadcasts: 0,
      unconfigured: 0,
      pushed: 0,
    };
    for (const orgId of orgIds) {
      const r = await step.run(`dispatch-${orgId}`, () =>
        withOrg(getDb(), orgId, async (tx) => {
          const ctx = { orgId, userId: null };
          let broadcasts = 0;
          for (const b of await dueBroadcasts(tx, now)) {
            await expandBroadcast(tx, ctx, b.id);
            broadcasts++;
          }
          const provider = await messagingFor(tx, orgId);
          if (!provider) return { broadcasts, unconfigured: 1 };
          return {
            broadcasts,
            ...(await dispatchDue(tx, ctx, provider, now, pushProvider())),
          };
        }),
      );
      for (const [k, v] of Object.entries(r)) totals[k as keyof typeof totals] += v;
    }
    if (totals.unconfigured > 0)
      log.warn(totals, 'messaging provider not configured for some organizations');
    return totals;
  },
);

/** Daily (Israel morning): the holiday notice before every run of holiday days without lessons. */
export const commsHolidayNotice = inngest.createFunction(
  {
    id: 'comms-holiday-notice',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 10 * * *' }],
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
    const results: Record<string, string> = {};
    for (const orgId of orgIds) {
      const r = await step.run(`holiday-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => sendHolidayNotice(tx, { orgId, userId: null })),
      );
      results[orgId] = r.outcome;
    }
    return results;
  },
);

/**
 * With `comms.ai_triage` on and an API key, Claude gives a second opinion on each inbound message; a more confident
 * verdict replaces the rules' draft while nobody has acted on it.
 */
export const commsAiTriage = inngest.createFunction(
  { id: 'comms-ai-triage', triggers: [{ event: 'comms.inbound_received' }], retries: 3 },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { inboundMessageId } = z.object({ inboundMessageId: z.uuid() }).parse(envelope.payload);
    const classifier = triageClassifier();
    if (!classifier) return { skipped: 'not_configured' };
    const input = await step.run('context', () =>
      withOrg(getDb(), envelope.organizationId, async (tx) =>
        // Past the month's AI allowance the rules' verdict stands alone.
        (await commsRules(tx)).aiTriage && (await aiAllowed(tx))
          ? inboundContext(tx, inboundMessageId)
          : null,
      ),
    );
    if (!input) return { skipped: 'off' };
    const verdict = await step.run('classify', async () => {
      const usage: ClaudeUsage[] = [];
      try {
        return await trackUsage(usage, () =>
          classifier.classify({ ...input, intents: INBOUND_INTENTS }),
        );
      } finally {
        await withOrg(getDb(), envelope.organizationId, (tx) =>
          recordAiUsage(tx, envelope.organizationId, 'triage', usage),
        );
      }
    });
    if (!verdict) return { skipped: 'no_verdict' };
    return step.run('apply', async () => {
      let outcome = 'already';
      await consumeOnce(getDb(), 'comms-ai-triage', envelope, async (tx) => {
        outcome = await applyAiClassification(tx, sys(envelope), inboundMessageId, {
          ...verdict,
          intent: verdict.intent as (typeof INBOUND_INTENTS)[number],
          confidence: Math.max(0, Math.min(100, Math.round(verdict.confidence))),
          date: verdict.date && /^\d{4}-\d{2}-\d{2}$/.test(verdict.date) ? verdict.date : null,
          classifier: classifier.name,
        });
      });
      return { outcome };
    });
  },
);

/**
 * The parents' bot (`comms.bot_enabled`): answers a family's question from their own data and the school's knowledge,
 * or hands it to the office with a summary. Without a model (no key, no fake) it stays out of the way.
 */
export const commsParentBot = inngest.createFunction(
  { id: 'comms-parent-bot', triggers: [{ event: 'comms.inbound_received' }], retries: 3 },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { inboundMessageId } = z.object({ inboundMessageId: z.uuid() }).parse(envelope.payload);
    if (!botConfigured()) return { skipped: 'not_configured' };
    return step.run('answer', async () => {
      let result: unknown = { skipped: 'already' };
      await consumeOnce(getDb(), 'comms-parent-bot', envelope, async (tx) => {
        const model = parentBotModel(await aiLevel(tx));
        if (!model) return;
        result = await runParentBot(tx, sys(envelope), model, inboundMessageId, {
          publicUrl: publicUrl(),
        });
      });
      return result;
    });
  },
);

/**
 * The business brain on WhatsApp beyond families (docs/AI-BRAIN.md, stage 3): the owner's "כן 12" / "לא 12" decides a
 * waiting action, an instructor's "אני חולה היום" opens substitute searches, an instructor gets their day, and the
 * owner's free question is answered by her assistant (the only part that needs a model).
 */
export const brainInbound = inngest.createFunction(
  { id: 'brain-inbound', triggers: [{ event: 'comms.inbound_received' }], retries: 3 },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { inboundMessageId } = z.object({ inboundMessageId: z.uuid() }).parse(envelope.payload);
    return step.run('read', async () => {
      let result: unknown = { skipped: 'already' };
      await consumeOnce(getDb(), 'brain-inbound', envelope, async (tx) => {
        result = await runBrainInbound(tx, sys(envelope), inboundMessageId, {
          model: ownerCopilotModel(await aiLevel(tx), await todayIL(tx)),
          publicUrl: publicUrl(),
        });
      });
      return result;
    });
  },
);

/** OS → GHL pipeline: a booked or converted trial moves the family's opportunity to the configured stage. */
export const crmPipelineSync = inngest.createFunction(
  {
    id: 'crm-pipeline-sync',
    triggers: [{ event: 'enrollment.trial_booked' }, { event: 'enrollment.trial_converted' }],
    retries: 5,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { studentId } = z.looseObject({ studentId: z.uuid() }).parse(envelope.payload);
    const stage: PipelineStage =
      envelope.type === 'enrollment.trial_converted' ? 'trial_converted' : 'trial_booked';
    return step.run('move', async () => {
      let outcome = 'not_configured';
      await consumeOnce(getDb(), 'crm-pipeline-sync', envelope, async (tx) => {
        const ghl = await ghlFor(tx, envelope.organizationId);
        if (!ghl) return;
        outcome = await syncPipelineStage(tx, sys(envelope), ghl.client, {
          studentId,
          stage,
          eventId: envelope.id,
        });
      });
      return { outcome };
    });
  },
);
