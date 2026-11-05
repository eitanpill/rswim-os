/**
 * The demo businesses' own processor (docs/PAYMENTS.md): R-SWIM and the Eilat club are connected to "Grow" with
 * invented keys, sealed exactly as the owner's screen seals them. In a sandboxed process (local, E2E, the live demo)
 * Grow runs as the demo processor, so families and divers can pay by card, Bit or standing order end to end; anywhere
 * else the invented keys open nothing.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { DEMO_ORG, DIVE_ORG } from '@rswim/db/personas';
import { createDataKey, encryptField, unwrapDataKey } from '@rswim/domain-core';
import { credentialHints } from '@rswim/integrations';
import type pg from 'pg';

const DEMO_GROW = {
  userId: 'demo-user-4471',
  pageCode: 'demo-page-9c2e',
  apiKey: 'demo-key-not-real-7731',
};

export async function seedPaymentConnections(
  client: pg.PoolClient,
  masterKey: Buffer | undefined,
): Promise<number> {
  if (!masterKey) return 0;
  let n = 0;
  for (const orgId of [DEMO_ORG.id, DIVE_ORG.id]) {
    const existing = await client.query<{ wrapped_dek: Buffer }>(
      `select wrapped_dek from org_keys where organization_id = $1`,
      [orgId],
    );
    let dek: Buffer;
    if (existing.rows[0]) dek = unwrapDataKey(masterKey, orgId, existing.rows[0].wrapped_dek);
    else {
      const k = createDataKey(masterKey, orgId);
      dek = k.dek;
      await client.query(`insert into org_keys (organization_id, wrapped_dek) values ($1, $2)`, [
        orgId,
        k.wrapped,
      ]);
    }
    const id = randomUUID();
    const aad = (column: string) => ({ table: 'payment_connections', column, rowId: id });
    await client.query(
      `insert into payment_connections
         (id, organization_id, provider, status, methods, enc_credentials, enc_webhook_secret, credential_hints,
          last_checked_at)
       values ($1, $2, 'grow', 'connected', $3, $4, $5, $6, now())`,
      [
        id,
        orgId,
        orgId === DEMO_ORG.id ? ['card', 'bit', 'standing_order'] : ['card', 'bit'],
        encryptField(dek, JSON.stringify(DEMO_GROW), aad('enc_credentials')),
        encryptField(dek, randomBytes(32).toString('hex'), aad('enc_webhook_secret')),
        JSON.stringify(credentialHints('grow', DEMO_GROW)),
      ],
    );
    n++;
  }
  return n;
}
