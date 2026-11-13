/**
 * Finding a school (store launch, stage 4): the school search, a school's public page, join requests that only the
 * school's own office sees and decides, and "we found you" by the phone the office already has. Every name is invented.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../harness';
import { createOrgFixture, type OrgFixture } from '../fixtures';
import { sessions } from './session';

let t: TestDatabase;
let A: OrgFixture;
let B: OrgFixture;

const { as } = sessions(() => t.pool);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err.code === 'RSW01' ? err.message : err.code;
  }
};

const person = async (phone: string | null) => {
  const id = randomUUID();
  await t.pool.query(`insert into auth.users (id, email, phone) values ($1, $2, $3)`, [
    id,
    `${id}@find.test`,
    phone,
  ]);
  return id;
};

const anon = async <T>(text: string, params: unknown[] = []) => {
  const c = await t.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role anon');
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.query('rollback');
    c.release();
  }
};

const ask = (slug: string, children = '[{"firstName":"נוגה","dob":"2019-04-02"}]', kind = 'join') =>
  `select public.request_to_join('${slug}', '${kind}', 'שירה', 'בדיקה', '+972541112233', null, '${children}'::jsonb, 'מחפשים קבוצה ביום שלישי') as id`;

beforeAll(async () => {
  t = await createTestDatabase();
  A = await createOrgFixture(t.pool, 'find-a');
  B = await createOrgFixture(t.pool, 'find-b');
  await t.pool.query(
    `update organizations set city = 'ירושלים', about = 'שחייה לילדים' where id = $1`,
    [A.orgId],
  );
  await t.pool.query(`update organizations set city = 'חיפה', listed = false where id = $1`, [
    B.orgId,
  ]);
});
afterAll(async () => {
  await t.drop();
});

describe('school search', () => {
  it('finds listed schools by name or city, signed out', async () => {
    const all = await anon<{ slug: string }>(`select slug from public.school_directory()`);
    expect(all.map((r) => r.slug)).toContain('find-a');
    const byCity = await anon<{ slug: string; city: string }>(
      `select slug, city from public.school_directory('ירושל')`,
    );
    expect(byCity).toEqual([{ slug: 'find-a', city: 'ירושלים' }]);
    expect(await anon(`select slug from public.school_directory('find', 'freediving')`)).toEqual(
      [],
    );
  });

  it('leaves out a school that opted out, but its own link still opens', async () => {
    expect(await anon(`select slug from public.school_directory('חיפה')`)).toEqual([]);
    const [r] = await anon<{ j: { id: string; city: string } }>(
      `select public.school_public('find-b') as j`,
    );
    expect(r?.j).toMatchObject({ id: B.orgId, city: 'חיפה', vertical: 'swim' });
  });

  it('never opens join requests to anonymous callers', async () => {
    await expect(anon(ask('find-a'))).rejects.toThrow(/permission denied/);
    await expect(anon(`select * from join_requests`)).rejects.toThrow(/permission denied/);
  });
});

describe('join requests', () => {
  it('lands with the school office only, and the person sees their own', async () => {
    const newcomer = await person('+972541112233');
    const reqId = await as(newcomer, null, async (run, c) => {
      const [r] = await run<{ id: string }>(ask('find-a'));
      // Asking again updates the same open request.
      const [again] = await run<{ id: string }>(ask('find-a', '[]', 'trial'));
      expect(again?.id).toBe(r?.id);
      await c.query('commit');
      return r!.id;
    });

    await as(newcomer, null, async (run) => {
      expect(await run(`select id, status, kind from public.my_join_requests()`)).toEqual([
        { id: reqId, status: 'new', kind: 'trial' },
      ]);
      // Not the table itself.
      expect(await run(`select id from join_requests`)).toEqual([]);
    });
    for (const role of ['owner', 'admin'] as const) {
      await as(A.users[role], A.orgId, async (run) => {
        expect(await run(`select id from join_requests`)).toEqual([{ id: reqId }]);
      });
    }
    for (const role of ['instructor', 'parent', 'accountant'] as const) {
      await as(A.users[role], A.orgId, async (run) => {
        expect(await run(`select id from join_requests`), role).toEqual([]);
      });
    }
    // The other school's office sees nothing and cannot decide it.
    await as(B.users.owner, B.orgId, async (run) => {
      expect(await run(`select id from join_requests`)).toEqual([]);
      expect(await code(run(`select public.accept_join_request($1)`, [reqId]))).toBe(
        'common.errors.forbidden',
      );
      expect(await code(run(`select public.decline_join_request($1)`, [reqId]))).toBe(
        'common.errors.forbidden',
      );
    });
    await as(A.users.instructor, A.orgId, async (run) => {
      expect(await code(run(`select public.accept_join_request($1)`, [reqId]))).toBe(
        'common.errors.forbidden',
      );
    });
  });

  it('accepted: a new family with the children, and the person gets the parent app there', async () => {
    const parent = await person('+972541114455');
    const reqId = await as(parent, null, async (run, c) => {
      const [r] = await run<{ id: string }>(
        `select public.request_to_join('find-a', 'join', 'דפנה', 'ניסוי', '+972541114455', null,
                '[{"firstName":"עומר","dob":"2018-02-01"},{"firstName":"אלה"}]'::jsonb, null) as id`,
      );
      await c.query('commit');
      return r!.id;
    });
    const guardianId = await as(A.users.admin, A.orgId, async (run, c) => {
      const [r] = await run<{ g: string }>(`select public.accept_join_request($1) as g`, [reqId]);
      expect(await code(run(`select public.accept_join_request($1)`, [reqId]))).toBe(
        'join.errors.handled',
      );
      await c.query('commit');
      return r!.g;
    });
    const kids = await t.pool.query(
      `select s.first_name, s.dob::text dob from students s join guardians g on g.household_id = s.household_id
       where g.id = $1 order by s.first_name`,
      [guardianId],
    );
    expect(kids.rows).toEqual([
      { first_name: 'אלה', dob: null },
      { first_name: 'עומר', dob: '2018-02-01' },
    ]);
    const m = await t.pool.query(
      `select role, guardian_id from memberships where organization_id = $1 and user_id = $2`,
      [A.orgId, parent],
    );
    expect(m.rows).toEqual([{ role: 'parent', guardian_id: guardianId }]);
    const u = await t.pool.query(
      `select raw_app_meta_data ->> 'active_org_id' o from auth.users where id = $1`,
      [parent],
    );
    expect(u.rows[0].o).toBe(A.orgId);
    // A member doesn't ask again.
    await as(parent, A.orgId, async (run) => {
      expect(await code(run(ask('find-a')))).toBe('join.errors.alreadyMember');
    });
  });

  it('accepted by phone the school already knows: the person joins that family instead of a new one', async () => {
    // B's unclaimed contact has this phone; A's request from the same phone goes to A's own unclaimed contact.
    const known = await person('+972500000000');
    const reqId = await as(known, null, async (run, c) => {
      const [r] = await run<{ id: string }>(
        `select public.request_to_join('find-a', 'join', 'רונית', 'בדיקה', '+972500000000', null, '[]'::jsonb, null) as id`,
      );
      await c.query('commit');
      return r!.id;
    });
    await as(A.users.owner, A.orgId, async (run) => {
      const [r] = await run<{ g: string }>(`select public.accept_join_request($1) as g`, [reqId]);
      expect(r?.g).toBe(A.guardians.other);
    });
  });

  it('declined: the person sees it, nothing is created', async () => {
    const someone = await person('+972541117788');
    const reqId = await as(someone, null, async (run, c) => {
      const [r] = await run<{ id: string }>(ask('find-a'));
      await c.query('commit');
      return r!.id;
    });
    await as(A.users.owner, A.orgId, async (run, c) => {
      await run(`select public.decline_join_request($1)`, [reqId]);
      await c.query('commit');
    });
    await as(someone, null, async (run) => {
      expect(await run(`select status from public.my_join_requests()`)).toEqual([
        { status: 'declined' },
      ]);
    });
    const m = await t.pool.query(`select 1 from memberships where user_id = $1`, [someone]);
    expect(m.rows).toEqual([]);
  });

  it('checks what the person typed', async () => {
    const someone = await person(null);
    await as(someone, null, async (run) => {
      expect(await code(run(ask('no-such-school')))).toBe('join.errors.notFound');
      expect(await code(run(ask('find-a', '[{"firstName":""}]')))).toBe('join.errors.childName');
      expect(await code(run(ask('find-a', '[{"firstName":"א","dob":"2999-01-01"}]')))).toBe(
        'join.errors.childDob',
      );
      expect(
        await code(run(ask('find-a', JSON.stringify(Array(5).fill({ firstName: 'א' }))))),
      ).toBe('join.errors.tooManyChildren');
    });
  });
});

describe('we found you by phone', () => {
  it("offers only schools with the person's phone on an unclaimed family, and joins it", async () => {
    // Every fixture contact carries +972500000000; A's "mine" is held by A's parent, the rest are free.
    const phoneOwner = await person('972500000000'); // Supabase keeps phones without the plus
    await as(phoneOwner, null, async (run, c) => {
      const matches = await run<{ organization_id: string }>(
        `select organization_id from public.my_phone_matches() order by organization_id`,
      );
      expect(matches.map((m) => m.organization_id).sort()).toEqual([A.orgId, B.orgId].sort());
      expect(await run(`select public.claim_by_phone($1) as o`, [B.orgId])).toEqual([
        { o: B.orgId },
      ]);
      await c.query('commit');
    });
    const m = await t.pool.query(
      `select role, guardian_id from memberships where organization_id = $1 and user_id = $2`,
      [B.orgId, phoneOwner],
    );
    expect(m.rows[0].role).toBe('parent');
    expect([B.guardians.mine, B.guardians.other]).toContain(m.rows[0].guardian_id);

    await as(phoneOwner, B.orgId, async (run) => {
      const left = await run<{ organization_id: string }>(
        `select organization_id from public.my_phone_matches()`,
      );
      expect(left.map((r) => r.organization_id)).not.toContain(B.orgId);
    });
  });

  it('finds nothing for a phone no school has, and refuses a claim', async () => {
    const stranger = await person('+972549990000');
    await as(stranger, null, async (run) => {
      expect(await run(`select * from public.my_phone_matches()`)).toEqual([]);
      expect(await code(run(`select public.claim_by_phone($1)`, [A.orgId]))).toBe(
        'join.errors.noMatch',
      );
    });
    const noPhone = await person(null);
    await as(noPhone, null, async (run) => {
      expect(await run(`select * from public.my_phone_matches()`)).toEqual([]);
    });
  });
});
