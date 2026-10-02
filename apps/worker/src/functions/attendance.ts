import { z } from 'zod';
import { schema } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import {
  closeDueClosureEvents,
  expireDueCredits,
  processAbsenceNotice,
  processPendingNotices,
} from '@rswim/domain-attendance';
import { consumeOnce } from '@rswim/domain-core/worker';
import { getDb, inngest, log } from '../client';
import { toEnvelope } from './core-ping';

/**
 * A family reported an absence: classify it against the regulations and issue the credit it earns. Parents never
 * decide their own credit, so this runs as the tenant's worker. Redelivery is a no-op (inbox guard, and a processed
 * notice is not processed again).
 */
export const attendanceProcessAbsence = inngest.createFunction(
  {
    id: 'attendance-process-absence',
    triggers: [{ event: 'attendance.absence_reported' }],
    retries: 5,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { noticeId } = z.object({ noticeId: z.uuid() }).parse(envelope.payload);
    return step.run('classify', async () => {
      let classification: string | null = null;
      await consumeOnce(getDb(), 'attendance-process-absence', envelope, async (tx) => {
        const outcome = await processAbsenceNotice(
          tx,
          { orgId: envelope.organizationId, userId: null },
          noticeId,
        );
        classification = outcome.classification;
      });
      return { classification };
    });
  },
);

/**
 * Nightly (Israel time): credits past their last day expire, closure events past their makeup deadline close with
 * their end rule, and any notice still pending (a lost event) is classified. Finding the tenants is cross-tenant
 * plumbing; the work runs per tenant under RLS.
 */
export const attendanceNightly = inngest.createFunction(
  {
    id: 'attendance-nightly',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 10 0 * * *' }],
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
    const totals = { expired: 0, closed: 0, classified: 0 };
    for (const orgId of orgIds) {
      const r = await step.run(`nightly-${orgId}`, () =>
        withOrg(getDb(), orgId, async (tx) => {
          const ctx = { orgId, userId: null };
          return {
            classified: await processPendingNotices(tx, ctx),
            closed: await closeDueClosureEvents(tx, ctx),
            expired: await expireDueCredits(tx, ctx),
          };
        }),
      );
      totals.expired += r.expired;
      totals.closed += r.closed;
      totals.classified += r.classified;
    }
    log.info(totals, 'attendance nightly run');
    return totals;
  },
);
