/**
 * Phase 1 acceptance criterion 1 at the service level (the browser test drives the same services through the UI):
 * Har Homa with gender windows and two price lists effective on different dates.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { DomainError, toDomainError, type ServiceContext } from '@rswim/domain-core';
import { createPool, createVenue, getVenue, saveWindow } from '@rswim/domain-venues';
import {
  addLevel,
  createPolicyVersion,
  createPriceList,
  createProgram,
  duplicatePriceList,
  listPrograms,
  moveLevel,
  priceFor,
  publishPriceList,
  resolvePolicyFor,
  savePriceItem,
} from '../src/services';

let t: TestDatabase;
let ctx: ServiceContext;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);

beforeAll(async () => {
  t = await createTestDatabase();
  const q = async (text: string, params: unknown[] = []) =>
    (await t.pool.query(text, params)).rows[0];
  const orgId = (
    await q(`insert into organizations (slug, name) values ('s', 'בדיקה') returning id`)
  ).id;
  const userId = (await q(`insert into auth.users (email) values ('o@example.test') returning id`))
    .id;
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    orgId,
    userId,
  ]);
  ctx = { orgId, userId };
});
afterAll(async () => {
  await t.drop();
});

describe('configuring Har Homa', () => {
  let venueId: string;
  let poolId: string;
  let laneIds: string[];
  let programId: string;

  it('creates the venue with a pool and lanes', async () => {
    venueId = await owner((tx) =>
      createVenue(tx, ctx, {
        name: 'הר חומה (דמו)',
        kind: 'country_club',
        status: 'active',
        address: 'רחוב הדמו 1',
        city: 'ירושלים',
        parkingInstructions: null,
        entryInstructions: 'כרטיס מלווה: מבוגר אחד לכל ילד',
        frontDeskScript: null,
        notes: null,
      }),
    );
    poolId = await owner((tx) =>
      createPool(tx, ctx, venueId, {
        name: 'בריכה מקורה',
        indoor: true,
        tempMinC: 28,
        tempMaxC: 30,
        depthMinCm: 90,
        depthMaxCm: 180,
        laneCount: 4,
      }),
    );
    const detail = await owner((tx) => getVenue(tx, venueId));
    laneIds = detail?.pools[0]?.lanes.map((l) => l.id) ?? [];
    expect(laneIds).toHaveLength(4);
  });

  it('adds a women/girls window on Monday and a men/boys window on Wednesday, and refuses an overlap', async () => {
    const window = (weekday: number, genderRestriction: 'female' | 'male', lanes: string[]) =>
      owner((tx) =>
        saveWindow(tx, ctx, venueId, {
          poolId,
          weekday,
          startsAt: '15:00',
          endsAt: '19:00',
          genderRestriction,
          effectiveFrom: '2026-09-01',
          effectiveTo: null,
          laneIds: lanes,
          notes: null,
        }),
      );
    await window(1, 'female', laneIds.slice(0, 2));
    await window(3, 'male', laneIds.slice(0, 2));
    await expect(window(1, 'male', laneIds.slice(1, 3))).rejects.toThrow(DomainError);
    const detail = await owner((tx) => getVenue(tx, venueId));
    expect(detail?.windows.map((w) => [w.weekday, w.genderRestriction, w.laneIds.length])).toEqual([
      [1, 'female', 2],
      [3, 'male', 2],
    ]);
  });

  it('answers ₪330 for September and ₪350 for January from two price lists', async () => {
    programId = await owner((tx) =>
      createProgram(tx, ctx, {
        code: 'group-kids',
        kind: 'group_kids',
        nameHe: 'קבוצת ילדים',
        nameEn: null,
        defaultDurationMin: 40,
        defaultCapacity: 6,
        minAgeMonths: 48,
        maxAgeMonths: 168,
        parentInWater: false,
        active: true,
      }),
    );
    const sep = await owner((tx) =>
      createPriceList(tx, ctx, {
        name: 'הר חומה ספטמבר',
        venueId,
        effectiveFrom: '2026-09-01',
        notes: null,
      }),
    );
    await owner((tx) =>
      savePriceItem(tx, ctx, sep, {
        programId,
        kind: 'monthly',
        durationMin: 40,
        sessionsCount: null,
        amountAgorot: 33000,
        label: null,
      }),
    );
    await expect(owner((tx) => publishPriceList(tx, ctx, sep))).resolves.toBeUndefined();
    const jan = await owner((tx) =>
      duplicatePriceList(tx, ctx, sep, {
        name: 'הר חומה ינואר',
        venueId,
        effectiveFrom: '2027-01-01',
        notes: null,
      }),
    );
    await owner((tx) =>
      savePriceItem(tx, ctx, jan, {
        programId,
        kind: 'monthly',
        durationMin: 40,
        sessionsCount: null,
        amountAgorot: 35000,
        label: null,
      }),
    );
    // A draft never applies.
    expect(
      (
        await owner((tx) =>
          priceFor(tx, {
            date: '2027-01-15',
            venueId,
            programId,
            kind: 'monthly',
            durationMin: 40,
          }),
        )
      )?.amount,
    ).toBe(33000);
    await owner((tx) => publishPriceList(tx, ctx, jan));
    const at = (date: string) =>
      owner((tx) => priceFor(tx, { date, venueId, programId, kind: 'monthly', durationMin: 40 }));
    expect(await at('2026-09-15')).toMatchObject({
      amount: 33000,
      priceListName: 'הר חומה ספטמבר',
    });
    expect(await at('2027-01-15')).toMatchObject({ amount: 35000, priceListName: 'הר חומה ינואר' });
    // The September list is in effect, so its prices are locked.
    const locked = await owner((tx) =>
      savePriceItem(tx, ctx, sep, {
        programId,
        kind: 'monthly',
        durationMin: 40,
        sessionsCount: null,
        amountAgorot: 1,
        label: null,
      }),
    ).catch((e: unknown) => toDomainError(e));
    expect(locked?.code).toBe('settings.errors.versionLocked');
  });

  it('refuses to publish an empty list and a package without sessions', async () => {
    const empty = await owner((tx) =>
      createPriceList(tx, ctx, {
        name: 'ריק',
        venueId: null,
        effectiveFrom: '2027-03-01',
        notes: null,
      }),
    );
    await expect(owner((tx) => publishPriceList(tx, ctx, empty))).rejects.toThrow(
      'settings.errors.emptyPriceList',
    );
    await expect(
      owner((tx) =>
        savePriceItem(tx, ctx, empty, {
          programId,
          kind: 'package',
          durationMin: null,
          sessionsCount: null,
          amountAgorot: 100000,
          label: null,
        }),
      ),
    ).rejects.toThrow('settings.errors.packageSessions');
  });

  it('stores entry rules as a venue policy over the org defaults', async () => {
    await owner((tx) =>
      createPolicyVersion(
        tx,
        ctx,
        { scopeType: 'org' },
        { effectiveFrom: '2026-01-01', rules: { venue: { companions_per_child: 1 } }, notes: null },
      ),
    );
    await owner((tx) =>
      createPolicyVersion(
        tx,
        ctx,
        { scopeType: 'venue', venueId },
        {
          effectiveFrom: '2026-09-01',
          rules: { venue: { extra_child_fee_agorot: 2000, father_escort_in_women_hours: false } },
          notes: null,
        },
      ),
    );
    await expect(
      owner((tx) =>
        createPolicyVersion(
          tx,
          ctx,
          { scopeType: 'org' },
          { effectiveFrom: '2026-01-01', rules: {}, notes: null },
        ),
      ),
    ).rejects.toThrow('settings.errors.duplicateStart');
    const resolved = await owner((tx) => resolvePolicyFor(tx, { date: '2026-10-01', venueId }));
    expect(resolved.rules.venue).toEqual({
      companions_per_child: 1,
      extra_child_fee_agorot: 2000,
      father_escort_in_women_hours: false,
    });
    expect(resolved.sources.map((s) => s.scopeType)).toEqual(['org', 'venue']);
  });

  it('keeps levels as an ordered ladder', async () => {
    for (const [code, nameHe] of [
      ['beginners', 'מתחילים'],
      ['intermediate', 'בינוני'],
      ['advanced', 'מתקדמים'],
    ] as const) {
      await owner((tx) =>
        addLevel(tx, ctx, programId, {
          code,
          nameHe,
          nameEn: null,
          skills: [{ code: 's1', he: 'נשימה' }],
        }),
      );
    }
    const ladder = async () =>
      (await owner((tx) => listPrograms(tx)))[0]?.levels.map((l) => l.code);
    expect(await ladder()).toEqual(['beginners', 'intermediate', 'advanced']);
    const advanced = (await owner((tx) => listPrograms(tx)))[0]?.levels[2]?.id as string;
    await owner((tx) => moveLevel(tx, advanced, 'up'));
    expect(await ladder()).toEqual(['beginners', 'advanced', 'intermediate']);
    // Moving the top level up does nothing.
    const top = (await owner((tx) => listPrograms(tx)))[0]?.levels[0]?.id as string;
    await owner((tx) => moveLevel(tx, top, 'up'));
    expect(await ladder()).toEqual(['beginners', 'advanced', 'intermediate']);
  });
});
