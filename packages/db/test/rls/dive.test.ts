/**
 * Freediving club: who sees and changes what inside one club, and the guards on bookings, the waiver, gear and
 * personal bests. Two orgs from the standard fixture; dive rows are added with the owner connection.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../harness';
import { createOrgFixture, type OrgFixture } from '../fixtures';
import { ids, sessions } from './session';

let t: TestDatabase;
let A: OrgFixture;
let B: OrgFixture;
const d = {} as {
  site: string;
  program: string;
  session: string;
  full: string;
  mine: string;
  other: string;
  gear: string;
  bookingMine: string;
};

beforeAll(async () => {
  t = await createTestDatabase();
  A = await createOrgFixture(t.pool, 'club-a');
  B = await createOrgFixture(t.pool, 'club-b');
  const q = async (text: string, params: unknown[]) =>
    (await t.pool.query(text, params)).rows[0].id as string;
  d.site = await q(
    `insert into dive_sites (organization_id, name, kind, max_depth_m) values ($1, 'המגדלור', 'shore', 40) returning id`,
    [A.orgId],
  );
  d.program = await q(
    `insert into dive_programs (organization_id, code, name_he, name_en, kind, price_agorot)
     values ($1, 'line', 'אימון חבלים', 'Line training', 'training', 18000) returning id`,
    [A.orgId],
  );
  const session = (capacity: number) =>
    q(
      `insert into dive_sessions (organization_id, program_id, site_id, starts_at, ends_at, capacity)
       values ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 2 hours', $4) returning id`,
      [A.orgId, d.program, d.site, capacity],
    );
  d.session = await session(6);
  d.full = await session(1);
  d.mine = await q(
    `insert into dive_divers (organization_id, guardian_id, first_name, last_name) values ($1, $2, 'דנה', 'בדיקה') returning id`,
    [A.orgId, A.guardians.mine],
  );
  d.other = await q(
    `insert into dive_divers (organization_id, first_name, last_name) values ($1, 'רון', 'בדיקה') returning id`,
    [A.orgId],
  );
  d.bookingMine = await q(
    `insert into dive_bookings (organization_id, session_id, diver_id) values ($1, $2, $3) returning id`,
    [A.orgId, d.session, d.mine],
  );
  await t.pool.query(
    `insert into dive_bookings (organization_id, session_id, diver_id) values ($1, $2, $3)`,
    [A.orgId, d.full, d.other],
  );
  await t.pool.query(
    `insert into dive_sales (organization_id, diver_id, kind, description, amount_agorot, method)
     values ($1, $2, 'training', 'אימון', 18000, 'card'), ($1, $3, 'training', 'אימון', 18000, 'cash')`,
    [A.orgId, d.mine, d.other],
  );
  await t.pool.query(
    `insert into dive_leads (organization_id, name, source) values ($1, 'ליד', 'instagram')`,
    [A.orgId],
  );
  d.gear = await q(
    `insert into dive_gear (organization_id, code, kind) values ($1, 'F-01', 'fins') returning id`,
    [A.orgId],
  );
});
afterAll(async () => {
  await t.drop();
});

const { as } = sessions(() => t.pool);

describe('freediving club roles', () => {
  it('the office sees every diver, sale and lead', async () => {
    await as(A.users.admin, A.orgId, async (run) => {
      expect(ids(await run('select id from dive_divers'))).toEqual([d.mine, d.other].sort());
      expect((await run('select id from dive_sales')).length).toBe(2);
      expect((await run('select id from dive_leads')).length).toBe(1);
    });
  });

  it('a club in another org is invisible', async () => {
    await as(B.users.owner, B.orgId, async (run) => {
      expect(await run('select id from dive_divers')).toEqual([]);
      expect(await run('select id from dive_sessions')).toEqual([]);
    });
  });

  it('an instructor reads divers and sessions, logs dives, but sees no money or leads', async () => {
    await as(A.users.instructor, A.orgId, async (run) => {
      expect((await run('select id from dive_divers')).length).toBe(2);
      expect((await run('select id from dive_sessions')).length).toBe(2);
      expect(await run('select id from dive_sales')).toEqual([]);
      expect(await run('select id from dive_leads')).toEqual([]);
      const [log] = await run<{ recorded_by: string }>(
        `insert into dive_logs (organization_id, diver_id, session_id, dived_on, discipline, depth_m, recorded_by)
         values ($1, $2, $3, current_date, 'CWT', 18, null) returning recorded_by`,
        [A.orgId, d.other, d.session],
      );
      expect(log?.recorded_by).toBe(A.users.instructor);
      expect(await run(`update dive_divers set first_name = 'x' returning id`)).toEqual([]);
    });
  });

  it('a customer sees only their own diver record, bookings and sales', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      expect(ids(await run('select id from dive_divers'))).toEqual([d.mine]);
      expect(ids(await run('select id from dive_bookings'))).toEqual([d.bookingMine]);
      expect((await run('select id from dive_sales')).length).toBe(1);
      expect(await run('select id from dive_leads')).toEqual([]);
      expect((await run('select id from dive_sessions')).length).toBe(2);
    });
  });

  it('a customer signs their waiver but cannot change their certification level', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      const [row] = await run<{ waiver_signed_on: Date; cert_level: number }>(
        `update dive_divers set waiver_signed_on = current_date, cert_level = 5 where id = $1
         returning waiver_signed_on, cert_level`,
        [d.mine],
      );
      expect(row?.waiver_signed_on).not.toBeNull();
      expect(row?.cert_level).toBe(0);
    });
  });

  it('a customer books themself online, cannot book someone else, and cannot check in', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      await expect(
        run(
          `insert into dive_bookings (organization_id, session_id, diver_id) values ($1, $2, $3)`,
          [A.orgId, d.session, d.other],
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        run(`update dive_bookings set status = 'checked_in' where id = $1`, [d.bookingMine]),
      ).rejects.toThrow(/customerCannotChange/);
      const [cancelled] = await run<{ status: string }>(
        `update dive_bookings set status = 'cancelled' where id = $1 returning status`,
        [d.bookingMine],
      );
      expect(cancelled?.status).toBe('cancelled');
    });
  });

  it('a full session refuses another booking', async () => {
    await as(A.users.admin, A.orgId, async (run) => {
      await expect(
        run(
          `insert into dive_bookings (organization_id, session_id, diver_id) values ($1, $2, $3)`,
          [A.orgId, d.full, d.mine],
        ),
      ).rejects.toThrow(/sessionFull/);
    });
  });

  it('a clean deeper dive becomes the personal best; a blackout does not', async () => {
    await as(A.users.admin, A.orgId, async (run) => {
      await run(
        `insert into dive_logs (organization_id, diver_id, dived_on, discipline, depth_m, outcome)
         values ($1, $2, current_date, 'CWT', 21, 'clean'), ($1, $2, current_date, 'CWT', 30, 'blackout')`,
        [A.orgId, d.mine],
      );
      const [diver] = await run<{ pb_cwt_m: number }>(
        'select pb_cwt_m from dive_divers where id = $1',
        [d.mine],
      );
      expect(diver?.pb_cwt_m).toBe(21);
    });
  });

  it('rented gear leaves the shelf and comes back on return; sales are append-only', async () => {
    await as(A.users.admin, A.orgId, async (run) => {
      const [rental] = await run<{ id: string }>(
        `insert into dive_rentals (organization_id, gear_id, diver_id, due_at) values ($1, $2, $3, now() + interval '4 hours') returning id`,
        [A.orgId, d.gear, d.mine],
      );
      expect((await run('select status from dive_gear where id = $1', [d.gear]))[0]).toEqual({
        status: 'rented',
      });
      await expect(
        run(
          `insert into dive_rentals (organization_id, gear_id, diver_id, due_at) values ($1, $2, $3, now())`,
          [A.orgId, d.gear, d.other],
        ),
      ).rejects.toThrow(/gearNotAvailable/);
      await run('update dive_rentals set returned_at = now() where id = $1', [rental?.id]);
      expect((await run('select status from dive_gear where id = $1', [d.gear]))[0]).toEqual({
        status: 'available',
      });
      await expect(run(`update dive_sales set amount_agorot = 1`)).rejects.toThrow(/append-only/);
    });
  });
});
