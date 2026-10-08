/**
 * The public live demo's profiles: the neutral swim school and the freediving dress, over the same fake seed.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProfile, dressMessages } from '@rswim/db/demo-profiles';
import { DEMO_ORG } from '@rswim/db/personas';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { seedDemo } from '../src/demo';
import { rebrandLiveDemo } from '../src/live-demo';

const SWIM_WORDS = /שחי|צפרדע|דולפין|כריש|תינוק|קאנטרי|גוש עציון|רעות/;

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
    ).toMatchObject({
      key: 'freediving',
      schoolName: 'X',
      ownerFirstName: 'אורי',
    });
  });

  it('dresses the wording without touching keys', () => {
    const out = dressMessages(
      { baby: 'שחיית תינוקות', camp: { a: 'קייטנה' } },
      demoProfile({ RSWIM_DEMO_PROFILE: 'freediving' }).uiWords.he,
    );
    expect(out).toEqual({ baby: 'סדנת נשימה', camp: { a: 'מחנה צלילה' } });
  });

  it('leaves no swimming names in the freediving school', async () => {
    expect(await q(`select name v from organizations where id = $1`)).toEqual(['כחול עמוק (דמו)']);
    const names = [
      ...(await q(`select name v from venues where organization_id = $1`)),
      ...(await q(`select name_he v from programs where organization_id = $1`)),
      ...(await q(`select name_he v from levels where organization_id = $1`)),
      ...(await q(`select name v from class_templates where organization_id = $1`)),
      ...(await q(`select description v from ledger_entries where organization_id = $1`)),
      ...(await q(`select first_name v from staff_members where organization_id = $1`)),
    ];
    expect(names.filter((n) => n && SWIM_WORDS.test(n))).toEqual([]);
    expect(names).toContain('חוף אכזיב – אתר ים (דמו)');
  });

  it('makes every student at least ten and drops baby swimming', async () => {
    const [youngest] = await q(
      `select min(date_part('year', age(dob)))::text v from students where organization_id = $1`,
    );
    expect(Number(youngest)).toBeGreaterThanOrEqual(10);
    expect(
      await q(`select kind v from programs where organization_id = $1 and kind = 'baby'`),
    ).toEqual([]);
  });
});
