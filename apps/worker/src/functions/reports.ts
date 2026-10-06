/**
 * The owner's weekly digest (brief §6.15): every Sunday at 07:00 each tenant's digest for the week is built from the
 * reports and stored for /admin/reports/digest. A tenant whose digest policy is off is skipped.
 */
import { schema } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { buildWeeklyDigest, sundayOf } from '@rswim/domain-reports';
import { getDb, inngest } from '../client';

const todayIL = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

export const reportsWeeklyDigest = inngest.createFunction(
  {
    id: 'reports-weekly-digest',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 7 * * 0' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const weekOf = sundayOf(todayIL());
    const orgIds = await step.run('find-orgs', () =>
      asPlatform(getDb(), async (tx) =>
        (await tx.select({ id: schema.organizations.id }).from(schema.organizations)).map(
          (r) => r.id,
        ),
      ),
    );
    let built = 0;
    for (const orgId of orgIds) {
      const ok = await step.run(`digest-${orgId}`, () =>
        withOrg(getDb(), orgId, async (tx) =>
          Boolean(await buildWeeklyDigest(tx, { orgId, userId: null }, weekOf)),
        ),
      );
      if (ok) built++;
    }
    return { weekOf, built };
  },
);
