import { z } from 'zod';
import type { DomainEventEnvelope } from '@rswim/contracts';
import { asPlatform, withOrg } from '@rswim/db/service';
import { and, isNotNull, notInArray, schema } from '@rswim/db';
import {
  runWhatsAppCheck,
  submitMetaTemplates,
  syncMetaTemplates,
  WHATSAPP_CHECK_REQUESTED,
  WHATSAPP_TEMPLATES_REQUESTED,
} from '@rswim/domain-comms';
import { consumeOnce } from '@rswim/domain-core/worker';
import { getDb, inngest } from '../client';
import { whatsappAdminFor } from '../ghl';
import { publicUrl } from '../providers';
import { toEnvelope } from './core-ping';

const sys = (envelope: DomainEventEnvelope) => ({ orgId: envelope.organizationId, userId: null });
const Payload = z.object({ connectionId: z.uuid() });

/**
 * "Check the connection" (WhatsApp track W10): asks Meta about the business's number and has Meta send its messages
 * to the connection's webhook. The result, or Meta's refusal, is kept on the connection for the owner.
 */
export const commsWhatsAppCheck = inngest.createFunction(
  { id: 'comms-whatsapp-check', triggers: [{ event: WHATSAPP_CHECK_REQUESTED }], retries: 2 },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    Payload.parse(envelope.payload);
    return step.run('check', async () => {
      let result: unknown = { skipped: 'already' };
      await consumeOnce(getDb(), 'comms-whatsapp-check', envelope, async (tx) => {
        const own = await whatsappAdminFor(tx, envelope.organizationId);
        result = own
          ? { outcome: await runWhatsAppCheck(tx, own, own.admin, publicUrl()) }
          : { skipped: 'not_connected' };
      });
      return result;
    });
  },
);

/** "Send the messages to Meta's review": every message not there yet goes as a template. */
export const commsWhatsAppTemplates = inngest.createFunction(
  {
    id: 'comms-whatsapp-templates',
    triggers: [{ event: WHATSAPP_TEMPLATES_REQUESTED }],
    retries: 2,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    Payload.parse(envelope.payload);
    return step.run('submit', async () => {
      let result: unknown = { skipped: 'already' };
      await consumeOnce(getDb(), 'comms-whatsapp-templates', envelope, async (tx) => {
        const own = await whatsappAdminFor(tx, envelope.organizationId);
        result = own
          ? await submitMetaTemplates(tx, sys(envelope), own.admin)
          : { skipped: 'not_connected' };
      });
      return result;
    });
  },
);

/** Every half hour: Meta's decisions on templates that still wait come home, business by business. */
export const commsWhatsAppTemplateSync = inngest.createFunction(
  {
    id: 'comms-whatsapp-template-sync',
    triggers: [{ cron: '*/30 * * * *' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const orgIds = await step.run('find-orgs', () =>
      asPlatform(getDb(), async (tx) =>
        (
          await tx
            .selectDistinct({ id: schema.messageTemplates.organizationId })
            .from(schema.messageTemplates)
            .where(
              and(
                isNotNull(schema.messageTemplates.metaStatus),
                notInArray(schema.messageTemplates.metaStatus, [
                  'APPROVED',
                  'REJECTED',
                  'DISABLED',
                ]),
              ),
            )
        ).map((r) => r.id),
      ),
    );
    let changed = 0;
    for (const orgId of orgIds) {
      changed += await step.run(`sync-${orgId}`, () =>
        withOrg(getDb(), orgId, async (tx) => {
          const own = await whatsappAdminFor(tx, orgId);
          return own ? syncMetaTemplates(tx, own.admin) : 0;
        }),
      );
    }
    return { orgs: orgIds.length, changed };
  },
);
