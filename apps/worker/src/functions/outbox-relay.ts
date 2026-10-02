import { relayOnce } from '@rswim/domain-core/worker';
import { getDb, inngest, inngestSender, log } from '../client';

/** Drains the outbox every minute, and right away when the web app nudges it after a commit. */
export const outboxRelay = inngest.createFunction(
  {
    id: 'outbox-relay',
    triggers: [{ cron: '* * * * *' }, { event: 'platform/outbox.nudge' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const result = await step.run('relay', () => relayOnce(getDb(), inngestSender));
    if (result.deadLettered > 0) log.error(result, 'outbox events dead-lettered');
    return result;
  },
);
