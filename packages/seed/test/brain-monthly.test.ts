/**
 * The monthly report (docs/AI-BRAIN.md, stage 8), on the fake demo tenant: on the 1st the owner's approvals number gets
 * the month that ended once, and nothing when she turned her summaries off or has no number.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import {
  monthlyFacts,
  monthlyText,
  sendMonthlyReport,
  setApprovalPhone,
} from '@rswim/domain-copilot';
import { todayIL } from '@rswim/domain-reports';
import type { ServiceContext } from '@rswim/domain-core';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const worker: ServiceContext = { orgId: DEMO_ORG.id, userId: null };
const owner: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const as = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: PERSONAS.owner.userId, org_id: DEMO_ORG.id }, fn);
const send = () => withOrg(t.db, DEMO_ORG.id, (tx) => sendMonthlyReport(tx, worker));
const OWNER_PHONE = '+972509990003';

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('the monthly report', () => {
  it('sums up the month that ended for the owner', async () => {
    const text = await as(async (tx) =>
      monthlyText(await monthlyFacts(tx, await todayIL(tx)), 'he'),
    );
    expect(text).toContain('📊 סיכום');
    expect(text).toContain('בסוף החודש');
  });

  it('goes once a month to the approvals number, and not when turned off', async () => {
    expect(await send()).toEqual({ sent: false, reason: 'no_phone' });
    await as((tx) => setApprovalPhone(tx, owner, OWNER_PHONE));
    expect(await send()).toEqual({ sent: true });
    const rows = (
      await t.pool.query(
        `select body from messages where to_phone_e164 = $1 and idempotency_key like 'agent.month:%'`,
        [OWNER_PHONE],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toContain('📊 סיכום');
    expect(await send()).toEqual({ sent: false, reason: 'already' });
    await as((tx) => setApprovalPhone(tx, owner, OWNER_PHONE, false));
    expect(await send()).toEqual({ sent: false, reason: 'off' });
  });
});
