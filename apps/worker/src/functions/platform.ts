/**
 * Phase 10 SaaS plumbing: a new school gets its encryption key; custom domains are verified by DNS; every morning
 * trials end and long-unpaid schools are suspended; on the 1st (or when a platform admin asks) each school is billed
 * and charged through the payment provider (the fake Grow until the platform's own account exists).
 */
import { z } from 'zod';
import { schema, sql } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { createDataKey } from '@rswim/domain-core';
import { consumeOnce } from '@rswim/domain-core/worker';
import {
  billingPeriod,
  billSchool,
  pendingDomainIds,
  subscriptionDailyStep,
  verifyDomain,
} from '@rswim/domain-platform';
import { FakeDnsResolver, SystemDnsResolver, type DnsResolver } from '@rswim/integrations';
import { getDb, inngest, log } from '../client';
import { paymentProvider } from '../providers';
import { toEnvelope } from './core-ping';

const todayIL = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

/**
 * DNS for domain checks. RSWIM_DNS_FAKE=1 (demos, E2E): a `*.localhost` host answers with its own token, so a demo
 * domain verifies itself; nothing else resolves.
 */
function dnsResolver(): DnsResolver {
  if (process.env.RSWIM_DNS_FAKE !== '1') return new SystemDnsResolver();
  return new FakeDnsResolver(async (name) => {
    const host = name.replace(/^_rswim\./, '');
    if (!host.endsWith('.localhost')) return [];
    const [d] = await asPlatform(getDb(), (tx) =>
      tx
        .select({ token: schema.orgDomains.token })
        .from(schema.orgDomains)
        .where(sql`${schema.orgDomains.host} = ${host}`),
    );
    return d ? [[`rswim-verify=${d.token}`]] : [];
  });
}

/** A new school's data key for encrypted fields (ID numbers, medical notes). Key management is platform plumbing. */
export const platformSchoolCreated = inngest.createFunction(
  { id: 'platform-school-created', triggers: [{ event: 'platform.school_created' }], retries: 5 },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const raw = process.env.RSWIM_MASTER_KEY;
    if (!raw) {
      log.warn({ orgId: envelope.organizationId }, 'no RSWIM_MASTER_KEY; school has no data key yet');
      return { keyed: false };
    }
    return step.run('data-key', () =>
      asPlatform(getDb(), async (tx) => {
        const { wrapped } = createDataKey(Buffer.from(raw, 'base64'), envelope.organizationId);
        await tx
          .insert(schema.orgKeys)
          .values({ organizationId: envelope.organizationId, wrappedDek: wrapped })
          .onConflictDoNothing();
        return { keyed: true };
      }),
    );
  },
);

export const platformCheckDomain = inngest.createFunction(
  {
    id: 'platform-check-domain',
    triggers: [{ event: 'platform.domain_check_requested' }],
    retries: 3,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { domainId } = z.object({ domainId: z.uuid() }).parse(envelope.payload);
    return step.run('verify', async () => {
      let status: string | null = null;
      await consumeOnce(getDb(), 'platform-check-domain', envelope, async (tx) => {
        status = await verifyDomain(tx, domainId, dnsResolver());
      });
      return { status };
    });
  },
);

/** Bills one school for a month: asked by a platform admin (event) or by the monthly run. */
export const platformBillSchool = inngest.createFunction(
  {
    id: 'platform-bill-school',
    triggers: [{ event: 'platform.billing_due' }],
    retries: 5,
    concurrency: { limit: 1, key: 'event.data.organizationId' },
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { period } = z.object({ period: z.iso.date() }).parse(envelope.payload);
    return step.run('bill', async () => {
      let outcome: unknown = null;
      await consumeOnce(getDb(), 'platform-bill-school', envelope, async (tx) => {
        outcome = await billSchool(
          tx,
          { orgId: envelope.organizationId, userId: null },
          period,
          paymentProvider(),
          todayIL(),
        );
      });
      return outcome;
    });
  },
);

const subscribedOrgs = () =>
  asPlatform(getDb(), async (tx) =>
    (await tx.select({ id: schema.orgSubscriptions.organizationId }).from(schema.orgSubscriptions)).map(
      (r) => r.id,
    ),
  );

/** On the 1st at 06:00: bill every school for the month. */
export const platformMonthlyBilling = inngest.createFunction(
  {
    id: 'platform-monthly-billing',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 6 1 * *' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const today = todayIL();
    const period = billingPeriod(today);
    const orgIds = await step.run('find-orgs', subscribedOrgs);
    const outcomes: Record<string, unknown> = {};
    for (const orgId of orgIds) {
      outcomes[orgId] = await step.run(`bill-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) =>
          billSchool(tx, { orgId, userId: null }, period, paymentProvider(), today),
        ),
      );
    }
    return { period, outcomes };
  },
);

/** Every morning: trials end, unpaid schools past their grace days are suspended, pending domains are re-checked. */
export const platformDaily = inngest.createFunction(
  {
    id: 'platform-daily',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 30 5 * * *' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const today = todayIL();
    const orgIds = await step.run('find-orgs', () =>
      asPlatform(getDb(), async (tx) =>
        (await tx.select({ id: schema.organizations.id }).from(schema.organizations)).map((r) => r.id),
      ),
    );
    let changed = 0;
    let verified = 0;
    for (const orgId of orgIds) {
      const r = await step.run(`day-${orgId}`, () =>
        withOrg(getDb(), orgId, async (tx) => {
          const change = await subscriptionDailyStep(tx, { orgId, userId: null }, today);
          let ok = 0;
          for (const id of await pendingDomainIds(tx)) {
            if ((await verifyDomain(tx, id, dnsResolver())) === 'verified') ok++;
          }
          return { changed: change?.changed ?? false, verified: ok };
        }),
      );
      if (r.changed) changed++;
      verified += r.verified;
    }
    return { today, changed, verified };
  },
);
