/**
 * After-school transport (brief §6.10): every morning each tenant's runs for the day are opened, so escorts find them
 * in the app and the office sees the day. The stage messages go through the communications hub's automations.
 */
import { schema } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { planRuns } from '@rswim/domain-transport';
import { getDb, inngest } from '../client';

const todayIL = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

export const transportPlanRuns = inngest.createFunction(
  {
    id: 'transport-plan-runs',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 6 * * *' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const date = todayIL();
    const orgIds = await step.run('find-orgs', () =>
      asPlatform(getDb(), async (tx) =>
        (await tx.select({ id: schema.organizations.id }).from(schema.organizations)).map(
          (r) => r.id,
        ),
      ),
    );
    let opened = 0;
    for (const orgId of orgIds) {
      opened += await step.run(`runs-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => planRuns(tx, { orgId, userId: null }, date)),
      );
    }
    return { date, opened };
  },
);
