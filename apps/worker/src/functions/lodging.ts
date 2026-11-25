/**
 * Lodging (docs/LODGING.md): at 07:00 each business with lodging on hears today's arrivals, departures and rooms to
 * prepare on WhatsApp (reception's number, or the owner's approvals number); at 17:00 each guest arriving tomorrow
 * hears when to come, how to get here and what is still owed. Loading this file also adds lodging to
 * the new-customers bot, which then answers about rooms and what is free.
 */
import { schema } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { registerLodgingBot, sendGuestReminders, sendMorningBrief } from '@rswim/domain-lodging';
import { getDb, inngest } from '../client';
import { publicUrl } from '../providers';

registerLodgingBot();

export const lodgingMorningBrief = inngest.createFunction(
  {
    id: 'lodging-morning-brief',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 7 * * *' }, { event: 'lodging/brief.run' }],
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
    let sent = 0;
    for (const orgId of orgIds) {
      const r = await step.run(`brief-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => sendMorningBrief(tx, { orgId, userId: null })),
      );
      if (r.sent) sent++;
    }
    return { orgs: orgIds.length, sent };
  },
);

export const lodgingGuestReminders = inngest.createFunction(
  {
    id: 'lodging-guest-reminders',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 17 * * *' }, { event: 'lodging/reminders.run' }],
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
    let sent = 0;
    for (const orgId of orgIds) {
      const r = await step.run(`remind-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) =>
          sendGuestReminders(tx, { orgId, userId: null }, publicUrl()),
        ),
      );
      sent += r.sent;
    }
    return { orgs: orgIds.length, sent };
  },
);
