/** GHL webhook intake: stored once, routed to the right tenant by location, queued for the worker. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { ingestGhlWebhook, markWebhookProcessed, webhookContact } from '../src/webhook';

let t: TestDatabase;
let orgId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const q = async (text: string, params: unknown[] = []) =>
    (await t.pool.query(text, params)).rows[0];
  orgId = (
    await q(`insert into organizations (slug, name) values ('wh', 'ארגון בדיקה') returning id`)
  ).id;
  await q(
    `insert into org_settings (organization_id, integrations) values ($1, '{"ghl":{"locationId":"loc-1","tagMap":{}}}')`,
    [orgId],
  );
  const other = (
    await q(`insert into organizations (slug, name) values ('wh2', 'ארגון אחר') returning id`)
  ).id;
  await q(
    `insert into org_settings (organization_id, integrations) values ($1, '{"ghl":{"locationId":"loc-2","tagMap":{}}}')`,
    [other],
  );
});
afterAll(async () => {
  await t.drop();
});

const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'ContactUpdate',
    locationId: 'loc-1',
    id: 'c-001',
    webhookId: 'wh-1',
    firstName: 'מיכל',
    lastName: 'כהן',
    phone: '+972500000106',
    ...extra,
  });

describe('ingestGhlWebhook', () => {
  it('stores and queues a contact webhook once, for the org that owns the location', async () => {
    expect(await ingestGhlWebhook(t.db, body())).toBe('queued');
    expect(await ingestGhlWebhook(t.db, body())).toBe('duplicate');
    const { rows } = await t.pool.query(
      `select organization_id, payload->>'webhookEventId' as wid from outbox where event_type = 'crm.contact_webhook_received'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_id).toBe(orgId);
    const contact = await webhookContact(t.db, orgId, rows[0].wid);
    expect(contact).toMatchObject({ id: 'c-001', firstName: 'מיכל', phone: '+972500000106' });
    // Another tenant cannot read it, even by id.
    expect(
      await webhookContact(t.db, '00000000-0000-0000-0000-000000000000', rows[0].wid),
    ).toBeNull();
    await markWebhookProcessed(t.db, rows[0].wid, 'processed');
    expect(
      (await t.pool.query(`select status from webhook_events where id = $1`, [rows[0].wid])).rows[0]
        .status,
    ).toBe('processed');
  });

  it('dedupes by body hash when there is no webhook id', async () => {
    const raw = body({ webhookId: undefined, dateUpdated: '2026-10-01T10:00:00Z' });
    expect(await ingestGhlWebhook(t.db, raw)).toBe('queued');
    expect(await ingestGhlWebhook(t.db, raw)).toBe('duplicate');
  });

  it('ignores other event types and unknown locations', async () => {
    expect(
      await ingestGhlWebhook(t.db, body({ type: 'OpportunityCreate', webhookId: 'wh-2' })),
    ).toBe('ignored');
    expect(await ingestGhlWebhook(t.db, JSON.stringify({ type: 'ContactUpdate' }))).toBe('ignored');
    expect(await ingestGhlWebhook(t.db, body({ locationId: 'nope', webhookId: 'wh-3' }))).toBe(
      'unknown_location',
    );
  });
});
