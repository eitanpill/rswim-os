import { z } from 'zod';
import type { DomainEventEnvelope } from '@rswim/contracts';
import {
  GHL_BRIDGE_CHECK_REQUESTED,
  GHL_BRIDGE_PULL_REQUESTED,
  runGhlBridgeCheck,
  runGhlBridgePull,
} from '@rswim/domain-comms';
import { consumeOnce } from '@rswim/domain-core/worker';
import { getDb, inngest } from '../client';
import { ghlBridgeFor } from '../ghl';
import { toEnvelope } from './core-ping';

const sys = (envelope: DomainEventEnvelope) => ({ orgId: envelope.organizationId, userId: null });
const CheckPayload = z.object({ connectionId: z.uuid() });
const PullPayload = CheckPayload.extend({ contactId: z.string().min(1).max(64) });

/** The GHL bridge's connection check: GHL answers for the sub-account with the business's token, or says why not. */
export const commsGhlBridgeCheck = inngest.createFunction(
  { id: 'comms-ghl-bridge-check', triggers: [{ event: GHL_BRIDGE_CHECK_REQUESTED }], retries: 2 },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const payload = CheckPayload.parse(envelope.payload);
    return step.run('check', async () => {
      let result: unknown = { skipped: 'already' };
      await consumeOnce(getDb(), 'comms-ghl-bridge-check', envelope, async (tx) => {
        const own = await ghlBridgeFor(tx, envelope.organizationId);
        result =
          own && own.bridge.connectionId === payload.connectionId
            ? { outcome: await runGhlBridgeCheck(tx, own.bridge, own.client) }
            : { skipped: 'not_connected' };
      });
      return result;
    });
  },
);

/**
 * GHL's workflow said a contact wrote: the worker reads that conversation from GHL (the person's new WhatsApp messages
 * go into the inbox and to the bots) and, when an answer was too fresh to judge, reads it once more a minute later.
 */
export const commsGhlBridgePull = inngest.createFunction(
  {
    id: 'comms-ghl-bridge-pull',
    triggers: [{ event: GHL_BRIDGE_PULL_REQUESTED }],
    retries: 3,
    // One read of a conversation at a time: a burst of messages is read in order, each message once.
    concurrency: { limit: 1, key: 'event.data.payload.contactId' },
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const payload = PullPayload.parse(envelope.payload);
    const read = (consumer: string) =>
      step.run(consumer, async () => {
        let result: Record<string, unknown> = { skipped: 'already' };
        await consumeOnce(getDb(), consumer, envelope, async (tx) => {
          const own = await ghlBridgeFor(tx, envelope.organizationId);
          if (!own || own.bridge.connectionId !== payload.connectionId || !own.bridge.whatsapp) {
            result = { skipped: 'not_connected' };
            return;
          }
          const { plan: _plan, ...r } = await runGhlBridgePull(
            tx,
            sys(envelope),
            own.bridge,
            own.client,
            payload.contactId,
          );
          result = r;
        });
        return result;
      });
    const first = await read('comms-ghl-bridge-pull');
    if (!(typeof first.deferred === 'number' && first.deferred > 0)) return first;
    await step.sleep('settle', '70s');
    return { first, settled: await read('comms-ghl-bridge-pull-settle') };
  },
);
