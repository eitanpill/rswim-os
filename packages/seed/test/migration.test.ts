/**
 * Phase 9 acceptance at the service level, on the fake demo tenant: moving every group of the closing Gush Etzion
 * pool produces a preview (rules, prices, one message per child), executes in one go with personal messages, and is
 * reverted inside the window with everything back as it was. A merge into an existing group is undone as well.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DEMO_ORG, PERSONAS } from '@rswim/db/personas';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { bookingsInSessions } from '@rswim/domain-attendance';
import { chargedPlaces } from '@rswim/domain-billing';
import { runAutomation } from '@rswim/domain-comms';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import {
  createMigration,
  executeMigration,
  listMigrations,
  previewMigration,
  relocateAllTo,
  revertMigration,
  saveMigrationItem,
  type MigrationDeps,
} from '@rswim/domain-scheduling';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const ctx: ServiceContext = { orgId: DEMO_ORG.id, userId: PERSONAS.owner.userId };
const ids = { gush: '', jlm: '', jlmPool: '', tuesday: '', adults: '', fear: '' };
let effectiveOn = '';

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const deps = (tx: Tx): MigrationDeps => ({
  bookingsInSessions: (s) => bookingsInSessions(tx, s),
  chargedPlaces: (e) => chargedPlaces(tx, e),
});
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
/** Runs the comms automation for the latest outbox event of a type, as the worker would. */
async function deliver(type: string) {
  const [e] = await q(
    `select id, payload from outbox where event_type = $1 order by created_at desc limit 1`,
    [type],
  );
  return withOrg(t.db, ctx.orgId, (tx) =>
    runAutomation(tx, ctx, { id: e.id, type, payload: e.payload }),
  );
}
const groupRow = async (id: string) =>
  (
    await q(
      `select venue_id, pool_id, to_char(starts_at, 'HH24:MI') starts_at, effective_to::text, lead_staff_id,
              (select count(*)::int from session_staff ss join sessions s on s.id = ss.session_id
               where s.class_template_id = $1 and ss.role = 'lead') leads,
              (select array_agg(lane_id order by lane_id) from class_template_lanes where class_template_id = $1) lanes
       from class_templates where id = $1`,
      [id],
    )
  )[0];

/** Lia does not teach in Jerusalem on Thursdays: her group moves without a lead for now. */
const noLeadForFear = (migrationId: string) =>
  owner((tx) =>
    saveMigrationItem(tx, ctx, {
      migrationId,
      sourceTemplateId: ids.fear,
      mode: 'relocate',
      targetVenueId: ids.jlm,
      targetPoolId: ids.jlmPool,
      leadChoice: 'none',
    }),
  );

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
  const venues = await q(`select id, name from venues where organization_id = $1`, [DEMO_ORG.id]);
  ids.gush = venues.find((v) => v.name.includes('גוש')).id;
  ids.jlm = venues.find((v) => v.name.includes('ירושלים')).id;
  [{ id: ids.jlmPool }] = await q(`select id from pools where venue_id = $1`, [ids.jlm]);
  const groups = await q(`select id, name from class_templates where venue_id = $1`, [ids.gush]);
  ids.tuesday = groups.find((g) => g.name === 'גוש שלישי').id;
  ids.adults = groups.find((g) => g.name === 'מבוגרים גוש').id;
  ids.fear = groups.find((g) => g.name === 'פחד ממים חמישי').id;
  // A Sunday two weeks or more ahead, so lessons both before and after it exist.
  const [{ d }] = await q(
    `select (app.today() + 14 + ((7 - extract(dow from app.today() + 14)::int) % 7))::text d`,
  );
  effectiveOn = d;
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('venue migration: relocate every group', () => {
  let migrationId = '';
  const before: Record<string, Awaited<ReturnType<typeof groupRow>>> = {};

  it('drafts a migration and shows what is still unmapped, with suggestions', async () => {
    migrationId = await owner((tx) =>
      createMigration(tx, ctx, {
        sourceVenueId: ids.gush,
        effectiveOn,
        reason: 'המועצה סוגרת את הבריכה (דמו)',
      }),
    );
    expect(
      await code(owner((tx) => createMigration(tx, ctx, { sourceVenueId: ids.gush, effectiveOn }))),
    ).toBe('scheduling.migration.errors.draftExists');
    const p = await owner((tx) => previewMigration(tx, migrationId, deps(tx)));
    expect(p.groups.map((g) => g.source.name)).toEqual([
      'גוש שלישי',
      'מבוגרים גוש',
      'פחד ממים חמישי',
    ]);
    expect(p.ready).toBe(false);
    expect(p.groups.every((g) => g.issues[0]?.code === 'scheduling.migration.unmapped')).toBe(true);
    const tuesday = p.groups[0]!;
    expect(tuesday.suggestions.find((s) => s.name === 'מעורבת ראשון')).toMatchObject({
      fits: false,
    });
    expect(p.targets.map((x) => x.id)).toContain(ids.jlm);
    for (const id of [ids.tuesday, ids.adults, ids.fear]) before[id] = await groupRow(id);
  });

  it('maps everything to Jerusalem at the same times and previews prices and messages', async () => {
    await owner((tx) => relocateAllTo(tx, ctx, migrationId, ids.jlm));
    let p = await owner((tx) => previewMigration(tx, migrationId, deps(tx)));
    // Lia does not teach in Jerusalem on Thursdays: that group needs another lead, or none for now.
    expect(p.groups.map((g) => g.issues.map((i) => i.code))).toEqual([
      [],
      [],
      ['scheduling.rules.instructorUnavailable'],
    ]);
    await noLeadForFear(migrationId);
    p = await owner((tx) => previewMigration(tx, migrationId, deps(tx)));
    expect(p.groups[2]!.warnings.map((w) => w.code)).toContain('scheduling.migration.noLeadYet');
    expect(p.blockers).toBe(0);
    expect(p.ready).toBe(true);
    expect(
      p.groups.map((g) => [g.item?.mode, g.item?.target.venueName, g.item?.target.startsAt]),
    ).toEqual([
      ['relocate', 'קאנטרי הדמו - ירושלים', '16:00'],
      ['relocate', 'קאנטרי הדמו - ירושלים', '18:00'],
      ['relocate', 'קאנטרי הדמו - ירושלים', '16:00'],
    ]);
    // Each relocated group gets its own lanes in the Jerusalem pool.
    expect(p.groups[0]!.item?.target.laneLabels.length).toBeGreaterThan(0);
    const notices = p.groups.flatMap((g) => g.notices);
    expect(notices).toHaveLength(p.groups.reduce((n, g) => n + g.source.seated, 0));
    expect(
      notices.every((n) => n.from.venue.includes('גוש') && n.to.venue.includes('ירושלים')),
    ).toBe(true);
    expect(p.groups[0]!.price.kind).not.toBe('unknown');
  });

  it('executes: the groups and their lessons from the date move, and every family is told', async () => {
    const lessons = await q(
      `select count(*) filter (where date >= $2) after, count(*) filter (where date < $2) before
       from sessions where class_template_id = $1`,
      [ids.tuesday, effectiveOn],
    );
    const r = await owner((tx) => executeMigration(tx, ctx, migrationId, deps(tx)));
    expect(r.groups).toBe(3);
    const after = await groupRow(ids.tuesday);
    expect(after).toMatchObject({ venue_id: ids.jlm, pool_id: ids.jlmPool, starts_at: '16:00' });
    expect(
      await q(
        `select count(*) filter (where date >= $2 and venue_id = $3) moved,
                count(*) filter (where date < $2 and venue_id = $4) stayed
         from sessions where class_template_id = $1`,
        [ids.tuesday, effectiveOn, ids.jlm, ids.gush],
      ),
    ).toEqual([{ moved: lessons[0].after, stayed: lessons[0].before }]);
    const sent = await deliver('scheduling.venue_migrated');
    expect(sent.outcome).toBe('done');
    expect(sent.queued + sent.blocked).toBeGreaterThan(0);
    const [m] = await q(
      `select body from messages where template_key = 'venue_migration' and status <> 'blocked' limit 1`,
    );
    expect(m.body).toContain('עוברת לקאנטרי הדמו - ירושלים');
    const [listed] = await owner((tx) => listMigrations(tx));
    expect(listed).toMatchObject({ id: migrationId, status: 'executed', groups: 3 });
  });

  it('reverts inside the window: groups, lanes and lessons are back, and families hear it is off', async () => {
    expect(await groupRow(ids.fear)).toMatchObject({ venue_id: ids.jlm });
    expect(await q(`select lead_staff_id from class_templates where id = $1`, [ids.fear])).toEqual([
      { lead_staff_id: null },
    ]);
    await owner((tx) => revertMigration(tx, ctx, migrationId, deps(tx)));
    for (const id of [ids.tuesday, ids.adults, ids.fear]) {
      expect(await groupRow(id)).toEqual(before[id]);
    }
    expect(
      await q(
        `select count(*)::int n from sessions where class_template_id = $1 and venue_id <> $2`,
        [ids.tuesday, ids.gush],
      ),
    ).toEqual([{ n: 0 }]);
    await deliver('scheduling.venue_migration_reverted');
    const [m] = await q(
      `select body from messages where template_key = 'venue_migration_reverted' and status <> 'blocked' limit 1`,
    );
    expect(m.body).toContain('בוטל');
    expect(await code(owner((tx) => revertMigration(tx, ctx, migrationId)))).toBe(
      'scheduling.migration.errors.notExecuted',
    );
  });
});

describe('venue migration: merge into an existing group', () => {
  let migrationId = '';
  let target = '';

  it('flags a group without room, then moves the children and undoes it', async () => {
    // A roomy Tuesday group in Jerusalem the Gush children can join.
    const [lane] = await q(
      `select l.id from lanes l where l.pool_id = $1 order by l.ordinal desc limit 1`,
      [ids.jlmPool],
    );
    [{ id: target }] = await q(
      `insert into class_templates (organization_id, name, program_id, venue_id, pool_id, weekday, starts_at,
                                    duration_min, capacity, effective_from)
       select organization_id, 'ירושלים שלישי (דמו)', program_id, $2, $3, 2, '17:00', duration_min, 12, '2026-09-01'
       from class_templates where id = $1 returning id`,
      [ids.tuesday, ids.jlm, ids.jlmPool],
    );
    await q(
      `insert into class_template_lanes (organization_id, pool_id, class_template_id, lane_id) values ($1, $2, $3, $4)`,
      [DEMO_ORG.id, ids.jlmPool, target, lane.id],
    );
    migrationId = await owner((tx) =>
      createMigration(tx, ctx, { sourceVenueId: ids.gush, effectiveOn }),
    );
    await owner((tx) =>
      saveMigrationItem(tx, ctx, {
        migrationId,
        sourceTemplateId: ids.tuesday,
        mode: 'merge',
        targetTemplateId: target,
      }),
    );
    await owner((tx) => relocateAllTo(tx, ctx, migrationId, ids.jlm));
    await noLeadForFear(migrationId);
    let p = await owner((tx) => previewMigration(tx, migrationId, deps(tx)));
    const merged = p.groups.find((g) => g.source.id === ids.tuesday)!;
    expect(merged.item).toMatchObject({ mode: 'merge', target: { templateId: target } });
    expect(merged.suggestions.map((s) => s.id)).toContain(target);

    // Shrink the target: the preview blocks it for lack of room.
    await q(`update class_templates set capacity = 2 where id = $1`, [target]);
    p = await owner((tx) => previewMigration(tx, migrationId, deps(tx)));
    expect(p.groups.find((g) => g.source.id === ids.tuesday)!.issues[0]?.code).toBe(
      'scheduling.migration.noRoom',
    );
    expect(await code(owner((tx) => executeMigration(tx, ctx, migrationId, deps(tx))))).toBe(
      'scheduling.migration.errors.notReady',
    );
    await q(`update class_templates set capacity = 12 where id = $1`, [target]);
    p = await owner((tx) => previewMigration(tx, migrationId, deps(tx)));
    const blocking = p.groups.flatMap((g) => [...g.issues, ...g.children.flatMap((c) => c.issues)]);
    expect(blocking).toEqual([]);

    const seated = await q(
      `select student_id from enrollments where class_template_id = $1 and ends_on is null order by student_id`,
      [ids.tuesday],
    );
    await owner((tx) => executeMigration(tx, ctx, migrationId, deps(tx)));
    expect(
      await q(
        `select student_id from enrollments where class_template_id = $1 and source = 'venue_migration'
         order by student_id`,
        [target],
      ),
    ).toEqual(seated);
    expect(await groupRow(ids.tuesday)).toMatchObject({ effective_to: effectiveOn });
    expect(
      await q(
        `select distinct status, cancel_reason from sessions where class_template_id = $1 and date >= $2`,
        [ids.tuesday, effectiveOn],
      ),
    ).toEqual([{ status: 'cancelled_by_school', cancel_reason: 'venue_migration' }]);

    await owner((tx) => revertMigration(tx, ctx, migrationId, deps(tx)));
    expect(
      await q(`select count(*)::int n from enrollments where class_template_id = $1`, [target]),
    ).toEqual([{ n: 0 }]);
    expect(
      await q(
        `select student_id from enrollments where class_template_id = $1 and ends_on is null order by student_id`,
        [ids.tuesday],
      ),
    ).toEqual(seated);
    expect(await groupRow(ids.tuesday)).toMatchObject({ effective_to: null });
    expect(
      await q(`select distinct status from sessions where class_template_id = $1 and date >= $2`, [
        ids.tuesday,
        effectiveOn,
      ]),
    ).toEqual([{ status: 'scheduled' }]);
  });

  it('hands a group to another instructor through a shift change, and a revert cancels it', async () => {
    const [noa] = await q(
      `select id from staff_members where organization_id = $1 and first_name = 'נועה'`,
      [DEMO_ORG.id],
    );
    await q(`update staff_members set skills = '{water_fear}' where id = $1`, [noa.id]);
    await q(
      `insert into availability_rules (organization_id, staff_member_id, weekday, starts_at, ends_at, venue_id, effective_from)
       values ($1, $2, 4, '15:00', '20:00', $3, '2026-09-01')`,
      [DEMO_ORG.id, noa.id, ids.jlm],
    );
    const id = await owner((tx) =>
      createMigration(tx, ctx, { sourceVenueId: ids.gush, effectiveOn }),
    );
    await owner((tx) => relocateAllTo(tx, ctx, id, ids.jlm));
    await owner((tx) =>
      saveMigrationItem(tx, ctx, {
        migrationId: id,
        sourceTemplateId: ids.fear,
        mode: 'relocate',
        targetVenueId: ids.jlm,
        targetPoolId: ids.jlmPool,
        leadChoice: 'other',
        newLeadStaffId: noa.id,
      }),
    );
    const p = await owner((tx) => previewMigration(tx, id, deps(tx)));
    expect(p.blockers).toBe(0);
    expect(p.groups[2]!.item?.lead).toContain('נועה');
    await owner((tx) => executeMigration(tx, ctx, id, deps(tx)));
    expect(
      await q(
        `select status from shift_changes where class_template_id = $1 and to_staff_id = $2`,
        [ids.fear, noa.id],
      ),
    ).toEqual([{ status: 'pending' }]);
    await owner((tx) => revertMigration(tx, ctx, id, deps(tx)));
    expect(
      await q(
        `select status from shift_changes where class_template_id = $1 and to_staff_id = $2`,
        [ids.fear, noa.id],
      ),
    ).toEqual([{ status: 'cancelled' }]);
  });

  it('refuses a revert after the window closes', async () => {
    const id = await owner((tx) =>
      createMigration(tx, ctx, { sourceVenueId: ids.gush, effectiveOn }),
    );
    await owner((tx) => relocateAllTo(tx, ctx, id, ids.jlm));
    await noLeadForFear(id);
    await owner((tx) => executeMigration(tx, ctx, id, deps(tx)));
    await q(
      `update venue_migrations set revert_until = now() - interval '1 minute' where id = $1`,
      [id],
    );
    expect(await code(owner((tx) => revertMigration(tx, ctx, id, deps(tx))))).toBe(
      'scheduling.migration.errors.revertClosed',
    );
    expect(
      (await owner((tx) => previewMigration(tx, id))).groups.map((g) => g.source.name),
    ).toHaveLength(3);
  });

  it('keeps migrations away from instructors', async () => {
    const rows = await asUser(
      t.db,
      { sub: PERSONAS.instructor.userId, org_id: DEMO_ORG.id },
      (tx) => tx.execute(`select id from venue_migrations` as never),
    );
    expect((rows as { rows: unknown[] }).rows).toEqual([]);
  });
});
