/**
 * Phase 10 SaaS on the fake demo database: a newcomer opens a school, installs the marketplace's regulations, catalog
 * and messages, brands it and verifies a domain; the plan holds its size; the platform bills it on the fake payment
 * provider (paid, then declined → past due → suspended after the grace days); and an owner's shared template waits
 * for a platform admin.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, type Tx } from '@rswim/db';
import { ACCOUNT_PERSONAS, DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import {
  accountState,
  addDomain,
  billSchool,
  brandingForHost,
  createSchool,
  installTemplate,
  listDomains,
  listSchools,
  listSubmittedTemplates,
  listTemplates,
  myBranding,
  myFeatures,
  myPlanPage,
  onboardingStatus,
  provisionSchool,
  requestBilling,
  reviewTemplate,
  saveBranding,
  shareTemplate,
  subscriptionDailyStep,
  updateSchool,
  verifyDomain,
} from '@rswim/domain-platform';
import { createVenue } from '@rswim/domain-venues';
import { FakeDnsResolver, FakePaymentProvider } from '@rswim/integrations';
import { seedDemo } from '../src/demo';
import { TEMPLATE_NAMES } from '../src/saas-data';

let t: TestDatabase;
let orgId = '';
const newcomer = ACCOUNT_PERSONAS.newcomer.userId;
const platform = ACCOUNT_PERSONAS.platform.userId;
const ctx = (): ServiceContext => ({ orgId, userId: newcomer });
const owner = <T>(fn: (tx: Tx) => Promise<T>) => asUser(t.db, { sub: newcomer, org_id: orgId }, fn);
const admin = <T>(fn: (tx: Tx) => Promise<T>) => asUser(t.db, { sub: platform, org_id: null }, fn);
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, orgId, fn);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const de = toDomainError(e);
    if (de) return de.code;
    throw e;
  }
  return null;
};
const venue = (name: string) => ({
  name,
  kind: 'country_club' as const,
  status: 'active' as const,
  address: null,
  city: null,
  parkingInstructions: null,
  entryInstructions: null,
  frontDeskScript: null,
  notes: null,
});

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('a new school', () => {
  it('signs up on a trial and gets the defaults as its new owner', async () => {
    orgId = await asUser(t.db, { sub: newcomer, org_id: null }, (tx) =>
      createSchool(tx, { name: 'גלים (דמו)', slug: 'galim-demo', plan: 'starter' }),
    );
    await owner((tx) => provisionSchool(tx, ctx()));
    const page = await owner((tx) => myPlanPage(tx));
    expect(page.subscription).toMatchObject({ planCode: 'starter', status: 'trialing' });
    expect(page.usage.map((u) => [u.limit, u.used, u.max])).toEqual([
      ['students', 0, 60],
      ['staff', 0, 3],
      ['venues', 0, 1],
    ]);
    expect(await owner((tx) => myFeatures(tx))).toMatchObject({ reports: false, copilot: false });
    const steps = await owner((tx) => onboardingStatus(tx));
    expect(steps.ready).toBe(false);
    expect(steps.doneCount).toBe(0);
    // The demo school sees nothing of it.
    expect(
      await asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, (tx) =>
        listDomains(tx),
      ),
    ).toEqual([]);
  });

  it('installs the regulations, catalog and messages from the marketplace', async () => {
    const list = await owner((tx) => listTemplates(tx));
    expect(list.map((x) => x.name).sort()).toEqual(Object.values(TEMPLATE_NAMES).sort());
    const id = (name: string) => list.find((x) => x.name === name)!.id;
    const reg = await owner((tx) => installTemplate(tx, ctx(), id(TEMPLATE_NAMES.regulations)));
    expect(reg).toHaveProperty('policySetId');
    const cat = (await owner((tx) => installTemplate(tx, ctx(), id(TEMPLATE_NAMES.catalog)))) as {
      programsAdded: string[];
      priceListId: string;
    };
    expect(cat.programsAdded).toContain('kids-group');
    const msgs = (await owner((tx) => installTemplate(tx, ctx(), id(TEMPLATE_NAMES.messages)))) as {
      templatesUpdated: string[];
    };
    expect(msgs.templatesUpdated.length).toBeGreaterThan(10);
    // Installing the catalog again adds no program twice.
    const again = (await owner((tx) => installTemplate(tx, ctx(), id(TEMPLATE_NAMES.catalog)))) as {
      programsAdded: string[];
    };
    expect(again.programsAdded).toEqual([]);
    expect((await owner((tx) => listTemplates(tx))).every((x) => x.installedAt !== null)).toBe(
      true,
    );
  });

  it('is held to its plan: one venue on the starter plan', async () => {
    await owner((tx) => createVenue(tx, ctx(), venue('בריכת גלים')));
    expect(await code(owner((tx) => createVenue(tx, ctx(), venue('בריכה שנייה'))))).toBe(
      'platform.errors.limit.venues',
    );
  });

  it('brands itself and proves a domain before the login page shows it', async () => {
    await owner((tx) =>
      saveBranding(tx, ctx(), { displayName: 'גלים - בית ספר לשחייה', hue: 'coral' }),
    );
    expect(await owner((tx) => myBranding(tx))).toMatchObject({ hue: 'coral', name: 'גלים (דמו)' });
    expect(await code(owner((tx) => addDomain(tx, ctx(), 'http://127.0.0.1')))).toBe(
      'platform.errors.host',
    );
    const domainId = await owner((tx) => addDomain(tx, ctx(), 'https://Galim.Example.co.il/'));
    expect(await code(owner((tx) => addDomain(tx, ctx(), 'galim.example.co.il')))).toBe(
      'platform.errors.hostTaken',
    );
    const [d] = await owner((tx) => listDomains(tx));
    expect(d).toMatchObject({
      host: 'galim.example.co.il',
      status: 'pending',
      record: '_rswim.galim.example.co.il',
    });
    expect(await asAnon(t.db, (tx) => brandingForHost(tx, 'galim.example.co.il'))).toBeNull();

    const dns = new FakeDnsResolver();
    expect(await system((tx) => verifyDomain(tx, domainId, dns))).toBe('pending');
    dns.set(d!.record, d!.value);
    expect(await system((tx) => verifyDomain(tx, domainId, dns))).toBe('verified');
    expect(await asAnon(t.db, (tx) => brandingForHost(tx, 'GALIM.example.co.il:443'))).toEqual({
      name: 'גלים (דמו)',
      slug: 'galim-demo',
      displayName: 'גלים - בית ספר לשחייה',
      hue: 'coral',
    });
    const steps = await owner((tx) => onboardingStatus(tx));
    expect(steps.steps.filter((s) => !s.done).map((s) => s.step)).toEqual(['catalog', 'staff']);
  });
});

describe('platform billing', () => {
  const payments = new FakePaymentProvider();

  it('bills nothing during the trial, then the plan’s price once it ends', async () => {
    expect(
      await system((tx) => billSchool(tx, ctx(), '2026-11-01', payments, '2026-11-01')),
    ).toEqual({
      billed: false,
      reason: 'trialing',
    });
    expect(
      await code(
        owner((tx) =>
          updateSchool(tx, { organizationId: orgId, action: 'endTrial' }, '2026-10-06'),
        ),
      ),
    ).toBe('common.errors.forbidden');
    await admin((tx) =>
      updateSchool(tx, { organizationId: orgId, action: 'endTrial' }, '2026-10-06'),
    );
    // No payment method yet: the invoice fails and the school is past due.
    expect(
      await system((tx) => billSchool(tx, ctx(), '2026-11-01', payments, '2026-11-01')),
    ).toMatchObject({
      billed: true,
      status: 'failed',
      code: 'platform.errors.noMandate',
    });
    expect(await owner((tx) => accountState(tx))).toMatchObject({
      status: 'past_due',
      locked: false,
    });
    await admin((tx) =>
      updateSchool(
        tx,
        { organizationId: orgId, action: 'mandate', mandateId: 'fake-mandate-galim' },
        '2026-11-02',
      ),
    );
    expect(
      await system((tx) => billSchool(tx, ctx(), '2026-11-01', payments, '2026-11-02')),
    ).toMatchObject({
      status: 'paid',
    });
    // Paid is final: billing the month again charges nothing.
    await system((tx) => billSchool(tx, ctx(), '2026-11-01', payments, '2026-11-03'));
    expect(payments.calls.filter((c) => c.op === 'charge')).toHaveLength(1);
    const page = await owner((tx) => myPlanPage(tx));
    expect(page.subscription).toMatchObject({ status: 'active', pastDueSince: null });
    expect(page.invoices).toMatchObject([
      { period: '2026-11-01', amountAgorot: 14900, status: 'paid', attempts: 1 },
    ]);
  });

  it('marks a declined school past due and suspends it after the grace days', async () => {
    await admin((tx) =>
      updateSchool(
        tx,
        { organizationId: orgId, action: 'mandate', mandateId: 'fake-fail-galim' },
        '2026-12-01',
      ),
    );
    expect(
      await system((tx) => billSchool(tx, ctx(), '2026-12-01', payments, '2026-12-01')),
    ).toMatchObject({
      status: 'failed',
      code: 'platform.errors.declined',
    });
    expect(await system((tx) => subscriptionDailyStep(tx, ctx(), '2026-12-10'))).toMatchObject({
      changed: false,
    });
    expect(await system((tx) => subscriptionDailyStep(tx, ctx(), '2026-12-11'))).toMatchObject({
      status: 'suspended',
      changed: true,
    });
    expect(await owner((tx) => accountState(tx))).toMatchObject({
      status: 'suspended',
      locked: true,
    });
    await admin((tx) =>
      updateSchool(tx, { organizationId: orgId, action: 'reactivate' }, '2026-12-12'),
    );
    expect(await owner((tx) => accountState(tx))).toMatchObject({
      status: 'active',
      locked: false,
    });
  });

  it('lets the platform admin see every school, move plans within size, and queue a billing run', async () => {
    const schools = await admin((tx) => listSchools(tx));
    expect(schools.find((s) => s.slug === 'galim-demo')).toMatchObject({
      planCode: 'starter',
      venues: 1,
      lastPeriod: '2026-12-01',
      lastStatus: 'failed',
    });
    expect(schools.find((s) => s.organizationId === DEMO_ORG.id)).toMatchObject({
      planCode: 'pro',
    });
    await admin((tx) =>
      updateSchool(tx, { organizationId: orgId, action: 'plan', planCode: 'growth' }, '2026-12-12'),
    );
    expect(await owner((tx) => myFeatures(tx))).toMatchObject({ reports: true, copilot: false });
    expect(
      await code(
        admin((tx) =>
          updateSchool(
            tx,
            { organizationId: DEMO_ORG.id, action: 'plan', planCode: 'starter' },
            '2026-12-12',
          ),
        ),
      ),
    ).toBe('platform.errors.tooBigForPlan');
    expect(await admin((tx) => requestBilling(tx, '2027-01-01'))).toBeGreaterThanOrEqual(3);
    expect(await code(owner((tx) => listSchools(tx)))).toBe('common.errors.forbidden');
  });
});

describe('sharing a template', () => {
  it('waits for a platform admin before other schools see it', async () => {
    const demo = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
    const asDemo = <T>(fn: (tx: Tx) => Promise<T>) =>
      asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, fn);
    await asDemo((tx) =>
      shareTemplate(tx, demo, { kind: 'messages', name: 'ההודעות של רעות', description: '' }),
    );
    expect((await owner((tx) => listTemplates(tx))).some((x) => x.name === 'ההודעות של רעות')).toBe(
      false,
    );
    const [submitted] = await admin((tx) => listSubmittedTemplates(tx));
    expect(submitted).toMatchObject({ name: 'ההודעות של רעות', sourceOrganizationId: DEMO_ORG.id });
    await admin((tx) => reviewTemplate(tx, { userId: platform }, submitted!.id, 'published'));
    expect((await owner((tx) => listTemplates(tx))).some((x) => x.name === 'ההודעות של רעות')).toBe(
      true,
    );
    expect(
      await code(
        admin((tx) => reviewTemplate(tx, { userId: platform }, submitted!.id, 'rejected')),
      ),
    ).toBe('platform.errors.notSubmitted');
  });
});
