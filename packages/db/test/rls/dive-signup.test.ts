/**
 * Freediving self-registration: who may join a club through its link (and what the database creates for them), what a
 * visitor may know about a club, and certification cards (a diver uploads, the office verifies, the file follows).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../harness';
import { createOrgFixture, type OrgFixture } from '../fixtures';
import { sessions } from './session';

let t: TestDatabase;
let A: OrgFixture;
let B: OrgFixture;
const d = {} as { mine: string; other: string; newcomer: string; file: string };

beforeAll(async () => {
  t = await createTestDatabase();
  A = await createOrgFixture(t.pool, 'join-a');
  B = await createOrgFixture(t.pool, 'join-b');
  await createOrgFixture(t.pool, 'join-swim');
  await t.pool.query(`update organizations set vertical = 'freediving' where id = any($1)`, [
    [A.orgId, B.orgId],
  ]);
  await t.pool.query(
    `insert into dive_rule_sets (organization_id, effective_from, rules)
     values ($1, '2020-01-01', '{"registration": {"self_signup": false}}')`,
    [B.orgId],
  );
  const q = async (text: string, params: unknown[]) =>
    (await t.pool.query(text, params)).rows[0].id as string;
  d.mine = await q(
    `insert into dive_divers (organization_id, guardian_id, first_name, last_name, cert_level) values ($1, $2, 'דנה', 'בדיקה', 2) returning id`,
    [A.orgId, A.guardians.mine],
  );
  d.other = await q(
    `insert into dive_divers (organization_id, first_name, last_name) values ($1, 'רון', 'בדיקה') returning id`,
    [A.orgId],
  );
  d.newcomer = randomUUID();
  await t.pool.query(`insert into auth.users (id, email) values ($1, 'new-diver@example.test')`, [
    d.newcomer,
  ]);
  d.file = await q(
    `insert into files (organization_id, bucket, path, mime, size_bytes, purpose, created_by)
     values ($1, 'local', 'x/card.png', 'image/png', 10, 'dive_cert', $2) returning id`,
    [A.orgId, A.users.parent],
  );
});
afterAll(async () => {
  await t.drop();
});

const { as } = sessions(() => t.pool);

const join = (slug: string, phone = '+972501112233') =>
  `select public.dive_join_club('${slug}', 'נועם', 'חדש', '${phone}', 'noam@example.test', '1995-04-02', 'אמא', '+972502223344') as id`;

describe('the join page', () => {
  it('tells a visitor the name of an active freediving club and whether it takes sign-ups', async () => {
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role anon');
      const one = async (slug: string) =>
        (await c.query(`select public.dive_club_public($1) as j`, [slug])).rows[0].j;
      expect(await one('join-a')).toMatchObject({ id: A.orgId, open: true });
      expect(await one('join-b')).toMatchObject({ id: B.orgId, open: false });
      expect(await one('join-swim')).toBeNull();
      expect(await one('nope')).toBeNull();
      await expect(c.query(join('join-a'))).rejects.toThrow(/permission denied/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

describe('joining a club', () => {
  it('creates a household, the diver and a customer membership, and points the next token at the club', async () => {
    await as(d.newcomer, null, async (run) => {
      const [r] = await run<{ id: string }>(join('join-a'));
      expect(r?.id).toBe(A.orgId);
      const [again] = await run<{ id: string }>(join('join-a'));
      expect(again?.id).toBe(A.orgId);
    });
    // The session above was rolled back; do it for real to look at the rows.
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: d.newcomer, org_id: null }),
      ]);
      await c.query('set local role authenticated');
      await c.query(join('join-a'));
      await c.query('commit');
    } finally {
      c.release();
    }
    const { rows } = await t.pool.query(
      `select m.role, g.relation, g.is_billing_contact, d.first_name, d.phone_e164, d.emergency_phone, d.source,
              d.cert_level, (select raw_app_meta_data ->> 'active_org_id' from auth.users where id = $1) as active
       from memberships m join guardians g on g.id = m.guardian_id
       join dive_divers d on d.guardian_id = g.id
       where m.user_id = $1 and m.organization_id = $2`,
      [d.newcomer, A.orgId],
    );
    expect(rows).toEqual([
      {
        role: 'parent',
        relation: 'self',
        is_billing_contact: true,
        first_name: 'נועם',
        phone_e164: '+972501112233',
        emergency_phone: '+972502223344',
        source: 'join_link',
        cert_level: 0,
        active: A.orgId,
      },
    ]);
    // Now a customer of the club: they see their own file only.
    await as(d.newcomer, A.orgId, async (run) => {
      const mine = await run<{ first_name: string }>(`select first_name from dive_divers`);
      expect(mine.map((x) => x.first_name)).toEqual(['נועם']);
    });
  });

  it('refuses a closed club, a swim school, staff of the club, bad details and anonymous callers', async () => {
    const someone = randomUUID();
    await t.pool.query(`insert into auth.users (id, email) values ($1, 'x@example.test')`, [
      someone,
    ]);
    await as(someone, null, async (run) => {
      await expect(run(join('join-b'))).rejects.toThrow(/signupClosed/);
      await expect(run(join('join-swim'))).rejects.toThrow(/clubNotFound/);
      await expect(run(join('join-a', '0501112233'))).rejects.toThrow(/joinPhone/);
      await expect(
        run(
          `select public.dive_join_club('join-a', '', 'חדש', '+972501112233', null, null, null, null)`,
        ),
      ).rejects.toThrow(/joinName/);
      await expect(
        run(
          `select public.dive_join_club('join-a', 'א', 'ב', '+972501112233', null, current_date, null, null)`,
        ),
      ).rejects.toThrow(/joinDob/);
    });
    await as(A.users.instructor, A.orgId, async (run) => {
      await expect(run(join('join-a'))).rejects.toThrow(/alreadyMember/);
    });
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await expect(c.query(join('join-a'))).rejects.toThrow(/forbidden/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

const card = (diver: string, extra = '') =>
  `insert into dive_certifications (organization_id, diver_id, agency, level, name, number, issued_on, file_id${
    extra ? ', status' : ''
  })
   values ('${A.orgId}', '${diver}', 'molchanovs', 3, 'Wave 2', ' M-12345 ', '2024-05-01', '${d.file}'${
     extra ? `, '${extra}'` : ''
   }) returning id, status, submitted_by, reviewed_by, number`;

describe('certification cards', () => {
  it('a diver uploads their own card, always pending, and cannot change it afterwards', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      const [c] = await run<{
        id: string;
        status: string;
        submitted_by: string;
        reviewed_by: string;
        number: string;
      }>(card(d.mine, 'verified'));
      expect(c).toMatchObject({
        status: 'pending',
        submitted_by: A.users.parent,
        reviewed_by: null,
        number: 'M-12345',
      });
      await expect(run(card(d.other))).rejects.toThrow(/row-level security/);
      await expect(
        run(`update dive_certifications set status = 'verified' where id = $1`, [c?.id]),
      ).resolves.toEqual([]);
      await expect(
        run(
          `insert into dive_certifications (organization_id, diver_id, agency, level, name, issued_on)
           values ($1, $2, 'aida', 2, 'AIDA 2', current_date + 3)`,
          [A.orgId, d.mine],
        ),
      ).rejects.toThrow(/certIssued/);
      expect(await run(`select id from dive_certifications`)).toHaveLength(1);
    });
  });

  it('the office verifies once (correcting the level) and the diver file follows; a lower card leaves it', async () => {
    const id = (
      await t.pool.query<{ id: string }>(
        `insert into dive_certifications (organization_id, diver_id, agency, level, name, number)
         values ($1, $2, 'molchanovs', 3, 'Wave 2', 'M-777') returning id`,
        [A.orgId, d.mine],
      )
    ).rows[0]?.id;
    const low = (
      await t.pool.query<{ id: string }>(
        `insert into dive_certifications (organization_id, diver_id, agency, level, name)
         values ($1, $2, 'padi', 1, 'Basic Freediver') returning id`,
        [A.orgId, d.mine],
      )
    ).rows[0]?.id;
    await as(A.users.instructor, A.orgId, async (run) => {
      expect((await run(`select id from dive_certifications`)).length).toBeGreaterThan(0);
      await expect(
        run(`update dive_certifications set status = 'verified' where id = $1`, [id]),
      ).resolves.toEqual([]);
    });
    await as(A.users.admin, A.orgId, async (run) => {
      await run(
        `update dive_certifications set status = 'verified', level = 4, review_note = ' נבדק ', name = 'זיוף' where id = $1`,
        [id],
      );
      const [row] = await run(
        `select status, level, name, review_note, reviewed_by from dive_certifications where id = $1`,
        [id],
      );
      expect(row).toEqual({
        status: 'verified',
        level: 4,
        name: 'Wave 2',
        review_note: 'נבדק',
        reviewed_by: A.users.admin,
      });
      const [diver] = await run(
        `select cert_level, cert_agency, cert_name, cert_number from dive_divers where id = $1`,
        [d.mine],
      );
      expect(diver).toEqual({
        cert_level: 4,
        cert_agency: 'molchanovs',
        cert_name: 'Wave 2',
        cert_number: 'M-777',
      });
      await expect(
        run(`update dive_certifications set status = 'rejected' where id = $1`, [id]),
      ).rejects.toThrow(/certNotPending/);
      await run(`update dive_certifications set status = 'verified' where id = $1`, [low]);
      const [after] = await run(`select cert_level, cert_name from dive_divers where id = $1`, [
        d.mine,
      ]);
      expect(after).toEqual({ cert_level: 4, cert_name: 'Wave 2' });
      // The desk records a card it saw as verified on the spot.
      const [desk] = await run<{ status: string; reviewed_by: string }>(card(d.other, 'verified'));
      expect(desk).toMatchObject({ status: 'verified', reviewed_by: A.users.admin });
    });
  });

  it('keeps clubs apart', async () => {
    await as(B.users.owner, B.orgId, async (run) => {
      expect(await run(`select id from dive_certifications`)).toEqual([]);
      await expect(run(card(d.mine))).rejects.toThrow();
    });
  });
});
