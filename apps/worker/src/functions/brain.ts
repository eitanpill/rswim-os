/**
 * The business brain's daily rounds (docs/AI-BRAIN.md, stage 4): the morning check at 07:00, after the insights feed
 * (06:30), acts on debts and uncovered lessons through the brain's gate; the evening summary at 20:00 goes to the
 * owner's approvals number. Before both, at 05:45, the brain's memory (stage 5) keeps the month's facts and records
 * what happened. On Sundays at 09:00 the owner hears what the brain learned about how she
 * works (stage 6). Each school runs in its own step, as the system for that school.
 */
import { schema } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import {
  refreshMemory,
  runMorningCheck,
  sendEveningSummary,
  sendLearningDigest,
} from '@rswim/domain-copilot';
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

export const brainMemory = inngest.createFunction(
  {
    id: 'brain-memory',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 45 5 * * *' }, { event: 'brain/memory.run' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const orgIds = await step.run('find-orgs', allOrgs);
    let months = 0;
    let events = 0;
    for (const orgId of orgIds) {
      const r = await step.run(`memory-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => refreshMemory(tx, { orgId, userId: null })),
      );
      months += r.months;
      events += r.events;
    }
    return { orgs: orgIds.length, months, events };
  },
);

/** Sundays at 09:00: what the brain learned about how the owner works, to her approvals number (stage 6). */
export const brainLearning = inngest.createFunction(
  {
    id: 'brain-learning',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 9 * * 0' }, { event: 'brain/learning.run' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const orgIds = await step.run('find-orgs', allOrgs);
    let sent = 0;
    for (const orgId of orgIds) {
      const r = await step.run(`learning-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => sendLearningDigest(tx, { orgId, userId: null })),
      );
      if (r.sent) sent++;
    }
    return { orgs: orgIds.length, sent };
  },
);
