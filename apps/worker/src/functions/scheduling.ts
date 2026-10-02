import { z } from 'zod';
import { and, eq, lte, schema, sql } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { consumeOnce } from '@rswim/domain-core/worker';
import { applyShiftChange, escalateDueShiftChanges } from '@rswim/domain-scheduling';
import { getDb, inngest, log } from '../client';
import { toEnvelope } from './core-ping';

/**
 * The instructor accepted a shift change: put it on the schedule. Applying emits `scheduling.staff_changed`, the only
 * event that may reach parents (Phase 5). A declined answer changes nothing. Redelivery applies once (inbox guard,
 * and applyShiftChange is a no-op on an applied change).
 */
export const schedulingApplyShiftChange = inngest.createFunction(
  {
    id: 'scheduling-apply-shift-change',
    triggers: [{ event: 'scheduling.shift_change_answered' }],
    retries: 5,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { shiftChangeId, accepted } = z
      .object({ shiftChangeId: z.uuid(), accepted: z.boolean() })
      .parse(envelope.payload);
    if (!accepted) return { skipped: 'declined' };
    return step.run('apply', async () => {
      let applied = false;
      await consumeOnce(getDb(), 'scheduling-apply-shift-change', envelope, async (tx) => {
        applied = await applyShiftChange(
          tx,
          { orgId: envelope.organizationId, userId: null },
          shiftChangeId,
        );
      });
      return { applied };
    });
  },
);

/**
 * Hourly: pending changes nobody answered in `staffing.shift_change_escalate_after_hours` go to the owner. Finding
 * which tenants have one is cross-tenant plumbing; the escalation itself runs per tenant under RLS.
 */
export const schedulingEscalateShiftChanges = inngest.createFunction(
  {
    id: 'scheduling-escalate-shift-changes',
    triggers: [{ cron: '7 * * * *' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const orgIds = await step.run('find-orgs', () =>
      asPlatform(getDb(), async (tx) =>
        (
          await tx
            .selectDistinct({ id: schema.shiftChanges.organizationId })
            .from(schema.shiftChanges)
            .where(
              and(
                eq(schema.shiftChanges.status, 'pending'),
                lte(schema.shiftChanges.escalateAt, sql`now()`),
              ),
            )
        ).map((r) => r.id),
      ),
    );
    let escalated = 0;
    for (const orgId of orgIds) {
      escalated += await step.run(`escalate-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => escalateDueShiftChanges(tx, { orgId, userId: null })),
      );
    }
    if (escalated > 0) log.info({ escalated }, 'shift changes escalated to the owner');
    return { escalated };
  },
);
