import { z } from 'zod';
import { DomainEventEnvelope } from '@rswim/contracts';
import { recordAudit } from '@rswim/domain-core';
import { consumeOnce } from '@rswim/domain-core/worker';
import { getDb, inngest } from '../client';

const OutboxEventData = z.object({
  organizationId: z.string(),
  idempotencyKey: z.string(),
  occurredAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

/** Turns an Inngest event (sent by our relay) back into our envelope. */
export function toEnvelope(e: { id?: string; name: string; data: unknown }): DomainEventEnvelope {
  const data = OutboxEventData.parse(e.data);
  return DomainEventEnvelope.parse({ id: e.id, type: e.name, ...data });
}

/** Phase 0 smoke consumer: proves the path web → outbox → relay → Inngest → consumer end to end. */
export const corePing = inngest.createFunction(
  { id: 'core-ping', triggers: [{ event: 'core.ping' }] },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    return step.run('record', () =>
      consumeOnce(getDb(), 'core-ping', envelope, (tx) =>
        recordAudit(tx, {
          organizationId: envelope.organizationId,
          actorId: null,
          action: 'ping_received',
          subjectType: 'outbox',
          subjectId: envelope.id,
          diff: envelope.payload,
        }),
      ),
    );
  },
);
