import { z } from 'zod';
import { eq, schema } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { applyContactWebhook, pushGuardian, runContactImport } from '@rswim/domain-crm';
import { markWebhookProcessed, webhookContact } from '@rswim/domain-crm/webhook';
import { consumeOnce } from '@rswim/domain-core/worker';
import { getDb, inngest, log } from '../client';
import { ghlFor } from '../ghl';
import { toEnvelope } from './core-ping';

/**
 * OS → GHL: a guardian was created or edited here. Skips changes that came from GHL itself; pushGuardian skips
 * anything already in sync. The outbox event id is the idempotency key, so a redelivered event upserts once.
 */
export const crmPushGuardian = inngest.createFunction(
  { id: 'crm-push-guardian', triggers: [{ event: 'people.guardian_upserted' }], retries: 5 },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { guardianId, source } = z
      .object({ guardianId: z.uuid(), source: z.string() })
      .parse(envelope.payload);
    if (source === 'ghl') return { skipped: 'from_ghl' };
    return step.run('push', async () => {
      let outcome = 'not_configured';
      await consumeOnce(getDb(), 'crm-push-guardian', envelope, async (tx) => {
        const ghl = await ghlFor(tx, envelope.organizationId);
        if (!ghl) return;
        outcome = await pushGuardian(
          tx,
          { orgId: envelope.organizationId, userId: null },
          ghl.client,
          guardianId,
          envelope.id,
        );
      });
      return { outcome };
    });
  },
);

/** The owner pressed "import now": read every GHL contact and link or create families. */
export const crmImportContacts = inngest.createFunction(
  {
    id: 'crm-import-contacts',
    triggers: [{ event: 'crm.import_requested' }],
    concurrency: { limit: 1, key: 'event.data.organizationId' },
    retries: 2,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { importRunId } = z.object({ importRunId: z.uuid() }).parse(envelope.payload);
    const orgId = envelope.organizationId;
    try {
      return await step.run('import', async () => {
        let stats: Record<string, number> | null = null;
        await consumeOnce(getDb(), 'crm-import-contacts', envelope, async (tx) => {
          const ghl = await ghlFor(tx, orgId);
          if (!ghl) throw new Error('GHL is not configured for this organization');
          const { plan } = await runContactImport(
            tx,
            { orgId, userId: null },
            ghl.client,
            ghl.tagMap,
            importRunId,
          );
          stats = plan.stats;
        });
        return { stats };
      });
    } catch (e) {
      // Record the failure where the owner sees it, then let Inngest retry.
      await withOrg(getDb(), orgId, (tx) =>
        tx
          .update(schema.importRuns)
          .set({
            status: 'failed',
            error: e instanceof Error ? e.message.slice(0, 500) : 'failed',
            finishedAt: new Date(),
          })
          .where(eq(schema.importRuns.id, importRunId)),
      );
      log.error({ err: e, importRunId }, 'GHL contact import failed');
      throw e;
    }
  },
);

/** GHL → OS: apply a stored ContactCreate/ContactUpdate webhook to the linked guardian. */
export const crmApplyWebhook = inngest.createFunction(
  { id: 'crm-apply-webhook', triggers: [{ event: 'crm.contact_webhook_received' }], retries: 5 },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { webhookEventId } = z.object({ webhookEventId: z.uuid() }).parse(envelope.payload);
    return step.run('apply', async () => {
      const contact = await webhookContact(getDb(), envelope.organizationId, webhookEventId);
      if (!contact) return { outcome: 'missing' };
      let outcome = 'duplicate';
      await consumeOnce(getDb(), 'crm-apply-webhook', envelope, async (tx) => {
        outcome = await applyContactWebhook(tx, contact);
      });
      await markWebhookProcessed(
        getDb(),
        webhookEventId,
        outcome === 'unknown_contact' ? 'ignored' : 'processed',
      );
      return { outcome };
    });
  },
);
