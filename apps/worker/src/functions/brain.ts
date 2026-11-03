/**
 * The business brain's daily rounds (docs/AI-BRAIN.md, stage 4): the morning check at 07:00, after the insights feed
 * (06:30), acts on debts and uncovered lessons through the brain's gate; the evening summary at 20:00 goes to the
 * owner's approvals number. Each school runs in its own step, as the system for that school.
 */
import { schema } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { runMorningCheck, sendEveningSummary } from '@rswim/domain-copilot';
import { getDb, inngest } from '../client';

const allOrgs = () =>
  asPlatform(getDb(), async (tx) =>
    (await tx.select({ id: schema.organizations.id }).from(schema.organizations)).map((r) => r.id),
  );

export const brainMorningCheck = inngest.createFunction(
  {
    id: 'brain-morning-check',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 7 * * *' }, { event: 'brain/morning.run' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const orgIds = await step.run('find-orgs', allOrgs);
    let actions = 0;
    for (const orgId of orgIds) {
      const r = await step.run(`morning-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => runMorningCheck(tx, { orgId, userId: null })),
      );
      actions += r?.actions.length ?? 0;
    }
    return { orgs: orgIds.length, actions };
  },
);

export const brainEveningSummary = inngest.createFunction(
  {
    id: 'brain-evening-summary',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 20 * * *' }, { event: 'brain/evening.run' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const orgIds = await step.run('find-orgs', allOrgs);
    let sent = 0;
    for (const orgId of orgIds) {
      const r = await step.run(`evening-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => sendEveningSummary(tx, { orgId, userId: null })),
      );
      if (r.sent) sent++;
    }
    return { orgs: orgIds.length, sent };
  },
);
