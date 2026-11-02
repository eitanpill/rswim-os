/**
 * Families booking private lessons from the parent portal: they see only the slots the office opened to families,
 * book only their own children, never see other families' bookings, and cancel only what they booked in time.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../harness';
import { createOrgFixture, type OrgFixture } from '../fixtures';
import { sessions } from './session';

let t: TestDatabase;
let A: OrgFixture;
let B: OrgFixture;
const s = {} as { open: string; closed: string; soon: string; pair: string; otherOrg: string };

beforeAll(async () => {
  t = await createTestDatabase();
  A = await createOrgFixture(t.pool, 'slots-a');
  B = await createOrgFixture(t.pool, 'slots-b');
  const slot = async (
    org: OrgFixture,
    hoursAhead: number,
    bookable: boolean,
    capacity = 1,
    kind = 'private',
  ) =>
    (
      await t.pool.query(
        `insert into private_slots (organization_id, staff_member_id, venue_id, kind, date, starts_at, ends_at,
                                    capacity, parent_bookable)
         values ($1, $2, $3, $4, (now() + make_interval(hours => $5))::date,
                 now() + make_interval(hours => $5), now() + make_interval(hours => $5) + interval '30 minutes',
                 $6, $7) returning id`,
        [org.orgId, org.staff.instructor, org.core.venue, kind, hoursAhead, capacity, bookable],
      )
    ).rows[0].id as string;
  s.open = await slot(A, 72, true);
  s.closed = await slot(A, 96, false);
  s.soon = await slot(A, 5, true);
  s.pair = await slot(A, 120, true, 2, 'pair');
  s.otherOrg = await slot(B, 72, true);
  // Another family already holds one seat of the pair.
  await t.pool.query(
    `insert into slot_bookings (organization_id, slot_id, student_id, booked_by) values ($1, $2, $3, $4)`,
    [A.orgId, s.pair, A.students.other, A.users.admin],
  );
});
afterAll(async () => {
  await t.drop();
});

const { as } = sessions(() => t.pool);

describe('open slots in the portal', () => {
  it('a parent sees only open, family-bookable, future slots of their own school, with seats left', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      const rows = await run<{ id: string; seats_left: number }>(
        `select id, seats_left from public.portal_open_slots()`,
      );
      expect(rows.map((r) => r.id).sort()).toEqual([s.open, s.soon, s.pair].sort());
      expect(rows.find((r) => r.id === s.pair)?.seats_left).toBe(1);
      // Still no direct read of the slot tables or of other families' bookings.
      expect(await run(`select id from private_slots where id = $1`, [s.open])).toHaveLength(0);
      expect(await run(`select id from slot_bookings where slot_id = $1`, [s.pair])).toHaveLength(
        0,
      );
    });
  });

  it('staff get nothing from the portal list (they use the office screen)', async () => {
    await as(A.users.instructor, A.orgId, async (run) => {
      expect(await run(`select * from public.portal_open_slots()`)).toHaveLength(0);
    });
  });
});

describe('booking and cancelling', () => {
  it('books the own child, fills the slot, emits the booking event, and refuses a second seat', async () => {
    await as(A.users.parent, A.orgId, async (run, c) => {
      const [b] = await run<{ id: string }>(`select public.portal_book_slot($1, $2) as id`, [
        s.open,
        A.students.mine,
      ]);
      expect(b?.id).toBeTruthy();
      const mine = await run<{ id: string; can_cancel: boolean; booked_by_family: boolean }>(
        `select id, can_cancel, booked_by_family from public.portal_my_slot_bookings()`,
      );
      expect(mine).toEqual([{ id: b?.id, can_cancel: true, booked_by_family: true }]);
      await expect(
        run(`select public.portal_book_slot($1, $2)`, [s.open, A.students.mine]),
      ).rejects.toThrow(/slotNotOpen/);
      await c.query('reset role');
      const st = await c.query(`select status from private_slots where id = $1`, [s.open]);
      expect(st.rows[0].status).toBe('full');
      const ev = await c.query(
        `select payload from outbox where event_type = 'scheduling.slot_booked' and payload->>'bookingId' = $1`,
        [b?.id],
      );
      expect(ev.rows[0].payload).toMatchObject({ studentId: A.students.mine, byFamily: true });
    });
  });

  it("refuses another family's child, a slot not open to families, another school", async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      const book = (slot: string, student: string) =>
        run(`select public.portal_book_slot($1, $2)`, [slot, student]);
      await expect(book(s.open, A.students.other)).rejects.toThrow(/forbidden/);
      await expect(book(s.closed, A.students.mine)).rejects.toThrow(/notFound/);
      await expect(book(s.otherOrg, A.students.mine)).rejects.toThrow(/notFound/);
    });
    await as(A.users.instructor, A.orgId, async (run) => {
      await expect(
        run(`select public.portal_book_slot($1, $2)`, [s.open, A.students.mine]),
      ).rejects.toThrow(/forbidden/);
    });
  });

  it("cancels a booking the family made in time; not within a day, not the office's", async () => {
    await as(A.users.parent, A.orgId, async (run, c) => {
      const [b] = await run<{ id: string }>(`select public.portal_book_slot($1, $2) as id`, [
        s.pair,
        A.students.mine,
      ]);
      await run(`select public.portal_cancel_slot_booking($1)`, [b?.id]);
      const [late] = await run<{ id: string }>(`select public.portal_book_slot($1, $2) as id`, [
        s.soon,
        A.students.mine,
      ]);
      await expect(run(`select public.portal_cancel_slot_booking($1)`, [late?.id])).rejects.toThrow(
        /portalCancelLate/,
      );
      await c.query('reset role');
      const office = await c.query(
        `insert into slot_bookings (organization_id, slot_id, student_id, booked_by)
         values ($1, $2, $3, $4) returning id`,
        [A.orgId, s.pair, A.students.mine, A.users.admin],
      );
      await c.query('set local role authenticated');
      await expect(
        run(`select public.portal_cancel_slot_booking($1)`, [office.rows[0].id]),
      ).rejects.toThrow(/portalCancelOffice/);
      const mine = await run<{ id: string; can_cancel: boolean }>(
        `select id, can_cancel from public.portal_my_slot_bookings() order by starts_at`,
      );
      expect(mine.map((m) => m.can_cancel)).toEqual([false, false]);
    });
  });
});
