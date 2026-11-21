import { relayOnce } from '@rswim/domain-core/worker';
import { getDb, inngest, inngestSender, log } from '../client';
import { TICK_CRON } from '../ticks';

/**
 * Drains the outbox every few minutes (`TICK_CRON`), and right away when nudged. No steps: a run is one Inngest
 * execution, and a retry is harmless because relaying is idempotent (Inngest dedupes on the event id).
 */
export const outboxRelay = inngest.createFunction(
  {
    id: 'outbox-relay',
    triggers: [{ cron: TICK_CRON }, { event: 'platform/outbox.nudge' }],
    concurrency: { limit: 1 },
  },
  async () => {
    const result = await relayOnce(getDb(), inngestSender);
    if (result.deadLettered > 0) log.error(result, 'outbox events dead-lettered');
    return result;
  },
);
