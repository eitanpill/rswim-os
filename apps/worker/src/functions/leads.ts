/**
 * New customers (WhatsApp track W4): at 10:00 the brain follows up leads (after a trial, or once after they went
 * quiet) through its gate, and at 17:00 every trial lesson booked for tomorrow gets its reminder. Each school runs in
 * its own step, as the system for that school.
 */
import { and, eq, schema } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { runLeadFollowUps } from '@rswim/domain-copilot';
import { queueTrialReminders } from '@rswim/domain-enrollment';
import { getDb, inngest, log } from '../client';

const activeOrgs = (vertical?: 'swim') =>
  asPlatform(getDb(), async (tx) =>
    (
      await tx
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(
          vertical
            ? and(
                eq(schema.organizations.status, 'active'),
                eq(schema.organizations.vertical, vertical),
              )
            : eq(schema.organizations.status, 'active'),
        )
    ).map((r) => r.id),
  );

export const brainLeadFollowUps = inngest.createFunction(
  {
    id: 'brain-lead-followups',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 10 * * *' }, { event: 'brain/lead-followups.run' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const orgIds = await step.run('find-orgs', () => activeOrgs());
    let actions = 0;
    for (const orgId of orgIds) {
      const r = await step.run(`followups-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => runLeadFollowUps(tx, { orgId, userId: null })),
      );
      actions += r.length;
    }
    return { orgs: orgIds.length, actions };
  },
);

export const enrollmentTrialReminders = inngest.createFunction(
  {
    id: 'enrollment-trial-reminders',
    triggers: [
      { cron: 'TZ=Asia/Jerusalem 0 17 * * *' },
      { event: 'enrollment/trial-reminders.run' },
    ],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const orgIds = await step.run('find-orgs', () => activeOrgs('swim'));
    let reminded = 0;
    for (const orgId of orgIds) {
      reminded += await step.run(`remind-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => queueTrialReminders(tx, { orgId, userId: null })),
      );
    }
    if (reminded > 0) log.info({ reminded }, 'trial reminders queued');
    return { reminded };
  },
);
