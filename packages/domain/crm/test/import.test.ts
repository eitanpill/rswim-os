/**
 * Phase 1 acceptance criterion 2: GHL contacts are imported and linked without duplicates, and contact changes
 * flow both ways without echoing. Runs against a throwaway database and the in-memory GHL with a recorded fixture.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { updateGuardian } from '@rswim/domain-people';
import { FakeGhlClient, type GhlContact } from '@rswim/integrations';
import { RSWIM_TAG_MAP } from '../src/policies';
import {
  applyContactWebhook,
  pushGuardian,
  requestContactImport,
  runContactImport,
} from '../src/services';
import fixture from './fixtures/ghl-contacts.json';

let t: TestDatabase;
let orgId: string;
let ownerId: string;
let ghl: FakeGhlClient;

beforeAll(async () => {
  t = await createTestDatabase();
  const q = async (text: string, params: unknown[] = []) =>
    (await t.pool.query(text, params)).rows[0];
  orgId = (
    await q(`insert into organizations (slug, name) values ('crm', 'ארגון בדיקה') returning id`)
  ).id;
  await q(`insert into org_settings (organization_id) values ($1)`, [orgId]);
  ownerId = (await q(`insert into auth.users (email) values ('owner@example.test') returning id`))
    .id;
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    orgId,
    ownerId,
  ]);

  // Guardians who already exist in R-SWIM OS before the first import (all fake).
  const household = async (name: string) =>
    (
      await q(
        `insert into households (organization_id, display_name) values ($1, $2) returning id`,
        [orgId, name],
      )
    ).id;
  const guardian = async (
    first: string,
    phone: string | null,
    email: string | null,
    ghlId: string | null,
  ) =>
    q(
      `insert into guardians (organization_id, household_id, first_name, last_name, phone_e164, email, ghl_contact_id)
       values ($1, $2, $3, 'קיים', $4, $5, $6)`,
      [orgId, await household(`משפחת ${first}`), first, phone, email, ghlId],
    );
  await guardian('מיכל', '+972500000106', null, null);
  await guardian('רונית', null, 'ronit@example.test', null);
  await guardian('גיל', '+972500000203', null, 'c-009');
  await guardian('נטע', '+972500000204', null, 'c-gone');
  await guardian('ללא-שם', '+972500000205', null, null);

  ghl = new FakeGhlClient(fixture.contacts as GhlContact[]);
});
afterAll(async () => {
  await t.drop();
});

const system = <T>(fn: Parameters<typeof withOrg<T>>[2]) =>
  withOrg(t.db, orgId, fn, { actorId: ownerId });
const counts = async () =>
  (
    await t.pool.query(
      `select (select count(*)::int from guardians where organization_id = $1) as guardians,
              (select count(*)::int from households where organization_id = $1) as households,
              (select count(*)::int from guardians where organization_id = $1 and ghl_contact_id is not null) as linked,
              (select count(*)::int from (select ghl_contact_id from guardians where organization_id = $1
                 and ghl_contact_id is not null group by 1 having count(*) > 1) d) as duplicate_links,
              (select count(*)::int from (select phone_e164 from guardians where organization_id = $1
                 and phone_e164 is not null group by 1 having count(*) > 1) d) as duplicate_phones`,
      [orgId],
    )
  ).rows[0];

/** Delivers pending guardian events to the push consumer, as the worker would. */
async function deliverGuardianEvents() {
  const events = (
    await t.pool.query(
      `select id, payload from outbox where organization_id = $1 and event_type = 'people.guardian_upserted' and dispatched_at is null`,
      [orgId],
    )
  ).rows as { id: string; payload: { guardianId: string } }[];
  const results: string[] = [];
  for (const e of events) {
    results.push(
      await system((tx) =>
        pushGuardian(tx, { orgId, userId: null }, ghl, e.payload.guardianId, e.id),
      ),
    );
    await t.pool.query(`update outbox set dispatched_at = now() where id = $1`, [e.id]);
  }
  return results;
}

describe('GHL contact import', () => {
  it('links existing guardians, creates new families, and reports the rest', async () => {
    const before = await counts();
    const { plan, runId } = await system((tx) =>
      runContactImport(tx, { orgId, userId: ownerId }, ghl, RSWIM_TAG_MAP),
    );
    expect(plan.stats).toEqual({
      already_linked: 1,
      link: 3,
      create: 4,
      duplicate_in_ghl: 2,
      conflict: 1,
      skipped: 3,
    });
    const after = await counts();
    expect(after.guardians - before.guardians).toBe(4);
    expect(after.households - before.households).toBe(4);
    expect(after).toMatchObject({ linked: 9, duplicate_links: 0, duplicate_phones: 0 });

    const michal = (
      await t.pool.query(
        `select ghl_contact_id, crm_profile from guardians where phone_e164 = '+972500000106'`,
      )
    ).rows[0];
    expect(michal.ghl_contact_id).toBe('c-001');
    expect(michal.crm_profile).toMatchObject({
      programInterest: ['group_kids'],
      ageBands: ['5-7y'],
    });
    const dana = (await t.pool.query(`select * from guardians where ghl_contact_id = 'c-003'`))
      .rows[0];
    expect(dana).toMatchObject({
      first_name: 'דנה',
      last_name: 'לוי',
      phone_e164: '+972500000201',
      is_billing_contact: true,
    });
    expect(dana.crm_profile).toMatchObject({ programInterest: ['baby'], waterFear: true });

    const run = (
      await t.pool.query(`select status, stats, report from import_runs where id = $1`, [runId])
    ).rows[0];
    expect(run.status).toBe('succeeded');
    expect(run.report).toHaveLength(fixture.contacts.length);
    expect(run.report).toContainEqual({
      ghlId: 'c-011',
      action: 'conflict',
      guardianId: expect.any(String),
      linkedGhlId: 'c-gone',
    });
  });

  it('changes nothing when run again', async () => {
    const before = await counts();
    const { plan } = await system((tx) =>
      runContactImport(tx, { orgId, userId: ownerId }, ghl, RSWIM_TAG_MAP),
    );
    expect(plan.stats).toMatchObject({ link: 0, create: 0, already_linked: 8 });
    expect(await counts()).toEqual(before);
  });

  it('runs an import the owner requested and fills in that run', async () => {
    const runId = await asUser(t.db, { sub: ownerId, org_id: orgId }, (tx) =>
      requestContactImport(tx, { orgId, userId: ownerId }),
    );
    const queued = (
      await t.pool.query(`select payload from outbox where event_type = 'crm.import_requested'`)
    ).rows;
    expect(queued).toEqual([{ payload: { importRunId: runId } }]);
    await system((tx) =>
      runContactImport(tx, { orgId, userId: ownerId }, ghl, RSWIM_TAG_MAP, runId),
    );
    const run = (await t.pool.query(`select status from import_runs where id = $1`, [runId]))
      .rows[0];
    expect(run.status).toBe('succeeded');
  });
});

describe('two-way contact sync', () => {
  it('pushes each linked guardian to GHL once, and redelivery sends nothing', async () => {
    const results = await deliverGuardianEvents();
    expect(results.filter((r) => r === 'pushed')).toHaveLength(3); // the three linked in the first run
    const pushedTo = ghl.calls.map((c) => c.contact.externalId).sort();
    expect(pushedTo).toEqual(['c-001', 'c-005', 'c-012']);
    // The same events again (worker retry): the hash matches, so no API call.
    const callsBefore = ghl.calls.length;
    for (const id of ['c-001', 'c-005', 'c-012']) {
      const g = (await t.pool.query(`select id from guardians where ghl_contact_id = $1`, [id]))
        .rows[0];
      expect(
        await system((tx) => pushGuardian(tx, { orgId, userId: null }, ghl, g.id, randomUUID())),
      ).toBe('unchanged');
    }
    expect(ghl.calls.length).toBe(callsBefore);
  });

  it('sends an owner’s edit to GHL once and ignores the webhook echo', async () => {
    const g = (await t.pool.query(`select id from guardians where ghl_contact_id = 'c-003'`))
      .rows[0];
    await asUser(t.db, { sub: ownerId, org_id: orgId }, (tx) =>
      updateGuardian(tx, { orgId, userId: ownerId }, g.id, {
        firstName: 'דנה',
        lastName: 'לוי-כהן',
        phoneE164: '+972500000201',
        email: 'dana@example.test',
        relation: 'mother',
        whatsappOptIn: true,
        isBillingContact: true,
      }),
    );
    const callsBefore = ghl.calls.length;
    expect(await deliverGuardianEvents()).toEqual(['pushed']);
    expect(ghl.calls.length).toBe(callsBefore + 1);
    const inGhl = ghl.contacts.get('c-003');
    expect(inGhl).toMatchObject({ lastName: 'לוי-כהן', email: 'dana@example.test' });

    // GHL fires ContactUpdate for our own write: nothing changes and nothing is queued.
    expect(await system((tx) => applyContactWebhook(tx, inGhl as GhlContact))).toBe('echo');
    expect(await deliverGuardianEvents()).toEqual([]);
  });

  it('applies a change made in GHL without pushing it back', async () => {
    const result = await system((tx) =>
      applyContactWebhook(tx, {
        id: 'c-004',
        firstName: 'יוסף',
        lastName: 'בן אברהם',
        phone: '050-000-0202',
      }),
    );
    expect(result).toBe('updated');
    const g = (
      await t.pool.query(`select id, first_name from guardians where ghl_contact_id = 'c-004'`)
    ).rows[0];
    expect(g.first_name).toBe('יוסף');
    const calls = ghl.calls.length;
    expect(
      await system((tx) => pushGuardian(tx, { orgId, userId: null }, ghl, g.id, randomUUID())),
    ).toBe('unchanged');
    expect(ghl.calls.length).toBe(calls);
  });

  it('ignores webhooks for contacts that were never imported', async () => {
    expect(await system((tx) => applyContactWebhook(tx, { id: 'c-unknown', firstName: 'x' }))).toBe(
      'unknown_contact',
    );
  });

  it('reports a missing guardian instead of failing the event', async () => {
    expect(
      await system((tx) => pushGuardian(tx, { orgId, userId: null }, ghl, randomUUID(), 'k')),
    ).toBe('missing');
  });
});
