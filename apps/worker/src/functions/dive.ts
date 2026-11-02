import { and, eq, schema } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { queueSessionReminders } from '@rswim/domain-dive';
import { getDb, inngest, log } from '../client';

/**
 * Every afternoon (Israel time): each active freediving club reminds the divers booked for tomorrow. Finding the
 * clubs is cross-tenant plumbing; the work runs per club under RLS, and each booking is reminded once.
 */
export const diveDailyReminders = inngest.createFunction(
  {
    id: 'dive-daily-reminders',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 17 * * *' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const orgIds = await step.run('find-clubs', () =>
      asPlatform(getDb(), async (tx) =>
        (
          await tx
            .select({ id: schema.organizations.id })
            .from(schema.organizations)
            .where(
              and(
                eq(schema.organizations.vertical, 'freediving'),
                eq(schema.organizations.status, 'active'),
              ),
            )
        ).map((r) => r.id),
      ),
    );
    let reminded = 0;
    for (const orgId of orgIds) {
      reminded += await step.run(`remind-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => queueSessionReminders(tx, { orgId, userId: null })),
      );
    }
    if (reminded > 0) log.info({ reminded }, 'dive reminders queued');
    return { reminded };
  },
);
