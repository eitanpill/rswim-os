/**
 * The desk's diver list on the fake Eilat club: every filter narrows the list to divers that match it, and filters
 * combine.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DIVE_ORG, DIVE_PERSONAS } from '@rswim/db/personas';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { diverTags, listDivers, type DiverListRow } from '@rswim/domain-dive';
import type { DiverFilter } from '@rswim/contracts';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
let all: DiverListRow[];
const office = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: DIVE_PERSONAS.diveOffice.userId, org_id: DIVE_ORG.id }, fn);
const list = (f: Partial<DiverFilter> | string) => office((tx) => listDivers(tx, f));
const ids = (rows: DiverListRow[]) => rows.map((r) => r.id).sort();

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  all = await list({ sort: 'name' });
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('the desk filters its divers', () => {
  it('lists the whole club with each diver’s money, pass and next session', () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all.some((d) => d.owes)).toBe(true);
    expect(all.some((d) => d.pass !== 'none')).toBe(true);
    expect(all.some((d) => d.nextOn !== null)).toBe(true);
  });

  it('a pass counts only while it is valid and has sessions left', async () => {
    const usable = await t.pool.query<{ id: string }>(
      `select distinct q.diver_id as id from dive_passes q
        where q.organization_id = $1 and q.valid_until >= app.today()
          and (q.sessions_total is null or q.sessions_total > (select count(*) from dive_bookings u
                where u.pass_id = q.id and u.status in ('booked', 'checked_in', 'no_show')))`,
      [DIVE_ORG.id],
    );
    expect(usable.rows.length).toBeGreaterThan(0);
    expect(ids(all.filter((d) => d.pass !== 'none'))).toEqual(usable.rows.map((r) => r.id).sort());
  });

  it('each filter keeps only the divers that match it', async () => {
    const checks: [Partial<DiverFilter>, (d: DiverListRow) => boolean][] = [
      [{ level: 3 }, (d) => d.certLevel === 3],
      [{ origin: 'abroad' }, (d) => d.origin === 'abroad'],
      [{ medical: 'expired' }, (d) => d.medical === 'expired'],
      [{ balance: 'owes' }, (d) => d.owes],
      [{ balance: 'clear' }, (d) => !d.owes],
      [{ pass: 'active' }, (d) => d.pass !== 'none'],
      [{ pass: 'ending' }, (d) => d.pass === 'ending'],
      [{ pass: 'none' }, (d) => d.pass === 'none'],
      [{ upcoming: 'booked' }, (d) => d.nextOn !== null],
      [{ upcoming: 'none' }, (d) => d.nextOn === null],
      [{ activity: 'never' }, (d) => d.lastDive === null],
    ];
    for (const [filter, holds] of checks) {
      const got = await list(filter);
      expect(got.every(holds), JSON.stringify(filter)).toBe(true);
      expect(ids(got), JSON.stringify(filter)).toEqual(ids(all.filter(holds)));
    }
    // Owing and clear split the club between them.
    expect(
      (await list({ balance: 'owes' })).length + (await list({ balance: 'clear' })).length,
    ).toBe(all.length);
  });

  it('filters combine, and the tag filter offers the tags in use', async () => {
    const tags = await office((tx) => diverTags(tx));
    expect(tags.length).toBeGreaterThan(0);
    const tag = tags[0] as string;
    const both = await list({ origin: 'eilat', upcoming: 'booked', tag });
    expect(ids(both)).toEqual(
      ids(all.filter((d) => d.origin === 'eilat' && d.nextOn !== null && d.tags.includes(tag))),
    );
  });

  it('sorts, searches by name, and ignores a filter it does not understand', async () => {
    const byValue = await list({});
    expect(byValue.map((d) => d.value)).toEqual(
      [...byValue.map((d) => d.value)].sort((a, b) => b - a),
    );
    const first = all[0] as DiverListRow;
    expect((await list(first.name)).map((d) => d.id)).toContain(first.id);
    const junk = { level: 'deep', pass: 'gold' } as unknown as Partial<DiverFilter>;
    expect((await list(junk)).length).toBe(all.length);
  });
});
