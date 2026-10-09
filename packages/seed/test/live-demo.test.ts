/**
 * The public live demo's profiles: the swim school and the Eilat freediving club side by side, over the fake seed.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProfile, dressMessages } from '@rswim/db/demo-profiles';
import { DEMO_ORG, DIVE_ORG } from '@rswim/db/personas';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { seedDemo } from '../src/demo';
import { rebrandLiveDemo } from '../src/live-demo';

let t: TestDatabase;
const q = async (sql: string) =>
  (await t.pool.query<{ v: string }>(sql, [DEMO_ORG.id])).rows.map((r) => r.v);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  await rebrandLiveDemo(t.pool, demoProfile({ RSWIM_DEMO_PROFILE: 'freediving' }));
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('live demo profiles', () => {
  it('picks the profile from the environment, with overrides, and falls back to swim', () => {
    expect(demoProfile({}).key).toBe('swim');
    expect(demoProfile({ RSWIM_DEMO_PROFILE: 'nope' }).key).toBe('swim');
    expect(
      demoProfile({ RSWIM_DEMO_PROFILE: 'freediving', RSWIM_DEMO_SCHOOL_NAME: 'X' }),
    ).toMatchObject({ key: 'freediving', schoolName: 'X', ownerFirstName: 'יעל' });
  });

  it('dresses wording only when a profile asks for it', () => {
    const msgs = { baby: 'שחיית תינוקות', camp: { a: 'קייטנה' } };
    expect(
      dressMessages(msgs, demoProfile({ RSWIM_DEMO_PROFILE: 'freediving' }).uiWords.he),
    ).toEqual(msgs);
    expect(dressMessages(msgs, [['קייטנה', 'מחנה']])).toEqual({
      baby: 'שחיית תינוקות',
      camp: { a: 'מחנה' },
    });
  });

  it('keeps the swim school a swim school and seeds the freediving club beside it', async () => {
    expect(await q(`select name v from organizations where id = $1`)).toEqual(['שחייה בכיף (דמו)']);
    const [club] = (
      await t.pool.query<{ vertical: string; divers: number }>(
        `select vertical, (select count(*)::int from dive_divers where organization_id = $1) as divers
         from organizations where id = $1`,
        [DIVE_ORG.id],
      )
    ).rows;
    expect(club?.vertical).toBe('freediving');
    expect(club?.divers).toBeGreaterThan(100);
  });
});
