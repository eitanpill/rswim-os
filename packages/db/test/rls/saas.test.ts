/**
 * Phase 10: the database side of the SaaS layer. Signing up creates exactly one school with the caller as owner; plan
 * limits hold whoever inserts; a school cannot verify its own domain, change its own plan or publish a template;
 * the login page learns only a verified domain's name and colour; platform functions are for platform admins only.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../harness';
import { createOrgFixture, type OrgFixture } from '../fixtures';
import { sessions } from './session';

let t: TestDatabase;
let A: OrgFixture;
let B: OrgFixture;
let newcomer: string;
let platformAdmin: string;

const { as, asSystem } = sessions(() => t.pool);
const newUser = async (label: string) => {
  const id = randomUUID();
  await t.pool.query(`insert into auth.users (id, email) values ($1, $2)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
  ]);
  return id;
};
const pgCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err.code === 'RSW01' ? err.message : err.code;
  }
};

beforeAll(async () => {
  t = await createTestDatabase();
  A = await createOrgFixture(t.pool, 'saas-a');
  B = await createOrgFixture(t.pool, 'saas-b');
  await t.pool.query(
    `insert into plans (code, name_he, name_en, price_agorot, max_students, max_staff, max_venues, features)
     values ('tiny', 'זעיר', 'Tiny', 9900, 3, 10, 1, '{}'), ('big', 'גדול', 'Big', 49900, null, null, null, '{reports}')`,
  );
  newcomer = await newUser('newcomer');
  platformAdmin = await newUser('platform');
  await t.pool.query(`insert into platform_admins (user_id) values ($1)`, [platformAdmin]);
});
afterAll(async () => {
  await t.drop();
});

describe('signing up a school', () => {
  it('creates the school, its owner and a trial, and points the next token at it', async () => {
    const orgId = await as(newcomer, null, async (run) => {
      const [r] = await run<{ id: string }>(`select public.create_school($1, $2, $3) id`, [
        'גלים בדיקה',
        'galim-test',
        'tiny',
      ]);
      return r!.id;
    });
    // The test session rolls back: do it again for real through the owner connection's view.
    expect(orgId).toMatch(/^[0-9a-f-]{36}$/);
    await as(newcomer, null, async (run, c) => {
      const [r] = await run<{ id: string }>(`select public.create_school($1, $2, $3) id`, [
        'גלים בדיקה',
        'galim-test',
        'tiny',
      ]);
      const id = r!.id;
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: newcomer, org_id: id }),
      ]);
      expect(await run(`select role from memberships`)).toEqual([{ role: 'owner' }]);
      const [sub] = await run<{ status: string; plan_code: string; trial_ends_on: string }>(
        `select status, plan_code, trial_ends_on::text from org_subscriptions`,
      );
      expect(sub).toMatchObject({ status: 'trialing', plan_code: 'tiny' });
      expect(await run(`select public.my_branding() ->> 'displayName' n`)).toEqual([
        { n: 'גלים בדיקה' },
      ]);
      await c.query('reset role');
      const [u] = (
        await c.query(
          `select raw_app_meta_data ->> 'active_org_id' o from auth.users where id = $1`,
          [newcomer],
        )
      ).rows;
      expect(u.o).toBe(id);
    });
  });

  it('opens the kind of business the owner picked (swim by default)', async () => {
    await as(newcomer, null, async (run, c) => {
      const [dive] = await run<{ id: string }>(`select public.create_school($1, $2, $3, $4) id`, [
        'מועדון בדיקה',
        'dive-test',
        'tiny',
        'freediving',
      ]);
      const [swim] = await run<{ id: string }>(`select public.create_school($1, $2, $3) id`, [
        'בריכה בדיקה',
        'swim-test',
        'tiny',
      ]);
      await c.query('reset role');
      const { rows } = await c.query<{ id: string; vertical: string }>(
        `select id, vertical from organizations where id = any($1) order by slug`,
        [[dive!.id, swim!.id]],
      );
      expect(rows).toEqual([
        { id: dive!.id, vertical: 'freediving' },
        { id: swim!.id, vertical: 'swim' },
      ]);
    });
  });

  it('refuses a taken address, a bad address, an unknown plan and anonymous callers', async () => {
    await as(newcomer, null, async (run) => {
      expect(await pgCode(run(`select public.create_school('x y', 'saas-a', 'tiny')`))).toBe(
        'platform.errors.slugTaken',
      );
      expect(await pgCode(run(`select public.create_school('x y', 'Bad Slug', 'tiny')`))).toBe(
        'platform.errors.slug',
      );
      expect(await pgCode(run(`select public.create_school('x y', 'okay-slug', 'nope')`))).toBe(
        'platform.errors.plan',
      );
      expect(
        await pgCode(run(`select public.create_school('x y', 'okay-slug', 'tiny', 'surfing')`)),
      ).toBe('platform.errors.vertical');
    });
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role anon');
      // A visitor sees the price list (active plans only), and nothing else about plans.
      const { rows: visible } = await c.query<{ code: string }>(
        `select code from public.public_plans()`,
      );
      const { rows: active } = await t.pool.query<{ code: string }>(
        `select code from plans where active order by sort_order, price_agorot`,
      );
      expect(visible.map((p) => p.code)).toEqual(active.map((p) => p.code));
      await c.query('savepoint plans');
      expect(await pgCode(c.query(`select count(*) from plans`))).toBe('42501');
      await c.query('rollback to savepoint plans');
      expect(await pgCode(c.query(`select public.create_school('x y', 'anon-slug', 'tiny')`))).toBe(
        '42501',
      );
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

describe('plan limits', () => {
  it('holds for every writer, and a school with no subscription has none', async () => {
    await t.pool.query(
      `insert into org_subscriptions (organization_id, plan_code, status) values ($1, 'tiny', 'active')`,
      [A.orgId],
    );
    // Room for exactly one more venue than the fixture already has.
    await t.pool.query(
      `update plans set max_venues = (select count(*) + 1 from venues where organization_id = $1 and status <> 'closed') where code = 'tiny'`,
      [A.orgId],
    );
    // A already has 2 children: one more fits, the next does not, whoever inserts it.
    await as(A.users.owner, A.orgId, async (run) => {
      await run(
        `insert into students (organization_id, household_id, first_name, last_name) values ($1, $2, 'שלישי', 'בדיקה')`,
        [A.orgId, A.households.mine],
      );
      expect(
        await pgCode(
          run(
            `insert into students (organization_id, household_id, first_name, last_name) values ($1, $2, 'רביעי', 'בדיקה')`,
            [A.orgId, A.households.mine],
          ),
        ),
      ).toBe('platform.errors.limit.students');
      await run(`insert into venues (organization_id, name) values ($1, 'בריכה א')`, [A.orgId]);
      expect(
        await pgCode(
          run(`insert into venues (organization_id, name) values ($1, 'בריכה ב')`, [A.orgId]),
        ),
      ).toBe('platform.errors.limit.venues');
      // A closed venue does not count.
      await run(
        `insert into venues (organization_id, name, status) values ($1, 'סגורה', 'closed')`,
        [A.orgId],
      );
    });
    await asSystem(A.orgId, async (run) => {
      await run(
        `insert into students (organization_id, household_id, first_name, last_name) values ($1, $2, 'שלישי', 'בדיקה')`,
        [A.orgId, A.households.mine],
      );
      expect(
        await pgCode(
          run(
            `insert into students (organization_id, household_id, first_name, last_name) values ($1, $2, 'רביעי', 'בדיקה')`,
            [A.orgId, A.households.mine],
          ),
        ),
      ).toBe('platform.errors.limit.students');
    });
    await as(B.users.owner, B.orgId, async (run) => {
      for (const n of ['א', 'ב', 'ג']) {
        await run(
          `insert into students (organization_id, household_id, first_name, last_name) values ($1, $2, $3, 'בדיקה')`,
          [B.orgId, B.households.mine, n],
        );
      }
    });
  });
});

describe('what a school may change about itself', () => {
  it('reads its own subscription but cannot change it, nor see another school’s', async () => {
    await as(A.users.instructor, A.orgId, async (run) => {
      expect(await run(`select plan_code from org_subscriptions`)).toEqual([{ plan_code: 'tiny' }]);
    });
    await as(A.users.owner, A.orgId, async (run) => {
      expect(
        await run(`update org_subscriptions set plan_code = 'big' returning plan_code`),
      ).toEqual([]);
      expect(
        await pgCode(
          run(`insert into org_subscriptions (organization_id, plan_code) values ($1, 'big')`, [
            A.orgId,
          ]),
        ),
      ).toBe('42501');
    });
    await as(B.users.owner, B.orgId, async (run) => {
      expect(await run(`select 1 from org_subscriptions`)).toEqual([]);
    });
  });

  it('adds a domain only as pending, cannot verify it, and the worker can', async () => {
    const host = 'saas-a.localhost';
    await t.pool.query(`delete from org_domains where host = $1`, [host]);
    await as(A.users.owner, A.orgId, async (run) => {
      expect(
        await pgCode(
          run(
            `insert into org_domains (organization_id, host, token, status) values ($1, $2, 't', 'verified')`,
            [A.orgId, host],
          ),
        ),
      ).toBe('42501');
      await run(`insert into org_domains (organization_id, host, token) values ($1, $2, 't')`, [
        A.orgId,
        host,
      ]);
      expect(await run(`update org_domains set status = 'verified' returning id`)).toEqual([]);
    });
    await t.pool.query(
      `insert into org_domains (organization_id, host, token) values ($1, $2, 't')`,
      [A.orgId, host],
    );
    const anon = async () => {
      const c = await t.pool.connect();
      try {
        await c.query('begin');
        await c.query('set local role anon');
        return (await c.query(`select public.branding_for_host($1) b`, [host.toUpperCase()]))
          .rows[0].b;
      } finally {
        await c.query('rollback');
        c.release();
      }
    };
    expect(await anon()).toBeNull();
    await asSystem(A.orgId, async (run) => {
      expect(
        await run(`update org_domains set status = 'verified', verified_at = now() returning host`),
      ).toEqual([{ host }]);
    });
    await t.pool.query(`update org_domains set status = 'verified' where host = $1`, [host]);
    await t.pool.query(
      `update org_settings set branding = '{"displayName": "בית הספר א", "hue": "coral", "secret": 1}' where organization_id = $1`,
      [A.orgId],
    );
    expect(await anon()).toEqual({
      name: `ארגון saas-a`,
      slug: 'saas-a',
      displayName: 'בית הספר א',
      hue: 'coral',
    });
  });

  it('submits a template for review but cannot publish it; others see only published ones', async () => {
    const insert = (status: string) =>
      `insert into templates (kind, status, name, payload, source_organization_id, created_by)
       values ('messages', '${status}', 'שלנו', '{}', $1, $2) returning id`;
    await as(A.users.owner, A.orgId, async (run) => {
      expect(await pgCode(run(insert('published'), [A.orgId, A.users.owner]))).toBe('42501');
      await run(insert('submitted'), [A.orgId, A.users.owner]);
      expect(await run(`select name from templates`)).toEqual([{ name: 'שלנו' }]);
    });
    await as(A.users.admin, A.orgId, async (run) => {
      expect(await pgCode(run(insert('submitted'), [A.orgId, A.users.admin]))).toBe('42501');
    });
  });
});

describe('the platform console', () => {
  it('lists schools and requests billing for platform admins only', async () => {
    await as(A.users.owner, A.orgId, async (run) => {
      expect(await pgCode(run(`select * from public.platform_schools()`))).toBe(
        'common.errors.forbidden',
      );
      expect(await pgCode(run(`select public.platform_request_billing('2026-11-01')`))).toBe(
        'common.errors.forbidden',
      );
    });
    await as(platformAdmin, null, async (run) => {
      const rows = await run<{ slug: string; plan_code: string | null; students: string }>(
        `select slug, plan_code, students from public.platform_schools()`,
      );
      expect(rows.find((r) => r.slug === 'saas-a')).toMatchObject({
        plan_code: 'tiny',
        students: '2',
      });
      expect(rows.find((r) => r.slug === 'saas-b')).toMatchObject({ plan_code: null });
      expect(await pgCode(run(`select public.platform_request_billing('2026-11-02')`))).toBe(
        'platform.errors.period',
      );
      expect(await run(`select public.platform_request_billing('2026-11-01') n`)).toEqual([
        { n: 1 },
      ]);
      expect(
        await run(`update org_subscriptions set plan_code = 'big' returning plan_code`),
      ).toEqual([{ plan_code: 'big' }]);
    });
  });
});

describe('the owner pays and manages the subscription (stage 3)', () => {
  it('lets only the owner open a card page, and only for her own school', async () => {
    await as(A.users.owner, A.orgId, async (run) => {
      const [r] = await run<{ id: string }>(
        `insert into platform_card_setups (organization_id, created_by) values ($1, $2) returning id`,
        [A.orgId, A.users.owner],
      );
      expect(r!.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(
        await pgCode(
          run(`insert into platform_card_setups (organization_id, created_by) values ($1, $2)`, [
            B.orgId,
            A.users.owner,
          ]),
        ),
      ).toBe('42501');
      expect(
        await pgCode(
          run(
            `insert into platform_card_setups (organization_id, created_by, status) values ($1, $2, 'saved')`,
            [A.orgId, A.users.owner],
          ),
        ),
      ).toBe('42501');
      expect(
        await pgCode(run(`update platform_card_setups set status = 'saved' returning id`)),
      ).toBe('42501');
      // She notes the processor's id on her open visit, and nothing else.
      expect(
        await run(`update platform_card_setups set external_id = 'x1' where id = $1 returning id`, [
          r!.id,
        ]),
      ).toHaveLength(1);
      expect(
        await pgCode(
          run(`select public.complete_card_setup($1, true, 'tok', '4242', null)`, [r!.id]),
        ),
      ).toBe('42501');
    });
    await as(A.users.admin, A.orgId, async (run) => {
      expect(
        await pgCode(
          run(`insert into platform_card_setups (organization_id, created_by) values ($1, $2)`, [
            A.orgId,
            A.users.admin,
          ]),
        ),
      ).toBe('42501');
      expect(await run(`update platform_card_setups set external_id = 'x2' returning id`)).toEqual(
        [],
      );
    });
  });

  it('saves the card on the setup’s school only, once, and charges a school that owes money again', async () => {
    const {
      rows: [setup],
    } = await t.pool.query<{ id: string }>(
      `insert into platform_card_setups (organization_id, created_by) values ($1, $2) returning id`,
      [A.orgId, A.users.owner],
    );
    await t.pool.query(
      `insert into platform_invoices (organization_id, period, covers_from, plan_code, amount_agorot, status)
       values ($1, '2026-10-01', '2026-10-01', 'tiny', 9900, 'failed')`,
      [A.orgId],
    );
    const complete = () =>
      t.pool.query(`select public.complete_card_setup($1, true, 'tok_a', '4242', null) org`, [
        setup!.id,
      ]);
    expect((await complete()).rows[0].org).toBe(A.orgId);
    await complete(); // a redelivery
    const sub = await t.pool.query(
      `select mandate_id, card_last4 from org_subscriptions where organization_id = $1`,
      [A.orgId],
    );
    expect(sub.rows[0]).toEqual({ mandate_id: 'tok_a', card_last4: '4242' });
    const due = await t.pool.query(
      `select payload ->> 'period' period from outbox
       where organization_id = $1 and event_type = 'platform.billing_due' and payload ->> 'reason' = 'cardSaved'`,
      [A.orgId],
    );
    expect(due.rows).toEqual([{ period: '2026-10-01' }]);
    await as(B.users.owner, B.orgId, async (run) => {
      expect(await run(`select id from platform_card_setups`)).toEqual([]);
    });
    await t.pool.query(`delete from platform_invoices where organization_id = $1`, [A.orgId]);
  });

  it('lets the owner change plan, cancel, keep and renew; nobody else', async () => {
    await as(A.users.admin, A.orgId, async (run) => {
      expect(await pgCode(run(`select public.owner_change_plan('big')`))).toBe(
        'common.errors.forbidden',
      );
      expect(await pgCode(run(`select public.owner_subscription_action('keep')`))).toBe(
        'common.errors.forbidden',
      );
    });
    await as(B.users.owner, B.orgId, async (run) => {
      expect(await pgCode(run(`select public.owner_change_plan('big')`))).toBe(
        'platform.errors.noSubscription',
      );
    });
    await as(A.users.owner, A.orgId, async (run) => {
      expect(await pgCode(run(`select public.owner_change_plan('nope')`))).toBe(
        'platform.errors.plan',
      );
      await run(`select public.owner_change_plan('big')`);
      expect(await run(`select plan_code from org_subscriptions`)).toEqual([{ plan_code: 'big' }]);
      expect(
        await pgCode(run(`select public.owner_subscription_action('cancel', '2000-01-01')`)),
      ).toBe('platform.errors.period');
      await run(`select public.owner_subscription_action('cancel', '2099-01-31')`);
      expect(await run(`select cancels_on::text from org_subscriptions`)).toEqual([
        { cancels_on: '2099-01-31' },
      ]);
      await run(`select public.owner_subscription_action('keep')`);
      expect(await run(`select cancels_on from org_subscriptions`)).toEqual([{ cancels_on: null }]);
      expect(await pgCode(run(`select public.owner_subscription_action('renew')`))).toBe(
        'platform.errors.notCancelled',
      );
      expect(await pgCode(run(`update org_subscriptions set plan_code = 'tiny' returning 1`))).toBe(
        null,
      );
      expect(await run(`select plan_code from org_subscriptions`)).toEqual([{ plan_code: 'big' }]);
    });
  });

  it('renews a cancelled subscription and bills the rest of the month', async () => {
    await t.pool.query(
      `update org_subscriptions set status = 'cancelled' where organization_id = $1`,
      [A.orgId],
    );
    await as(A.users.owner, A.orgId, async (run, c) => {
      expect(await pgCode(run(`select public.owner_change_plan('big')`))).toBe(
        'platform.errors.renewFirst',
      );
      await run(`select public.owner_subscription_action('renew')`);
      expect(await run(`select status from org_subscriptions`)).toEqual([{ status: 'active' }]);
      await c.query('reset role'); // the outbox is plumbing: read it as the owner connection
      const due = await c.query(
        `select (payload ->> 'from') is not null has_from from outbox
         where organization_id = $1 and event_type = 'platform.billing_due' and payload ? 'from'`,
        [A.orgId],
      );
      expect(due.rows).toEqual([{ has_from: true }]);
    });
    await t.pool.query(
      `update org_subscriptions set status = 'trialing' where organization_id = $1`,
      [A.orgId],
    );
  });

  it('keeps invoice details well-formed', async () => {
    await as(A.users.owner, A.orgId, async (run) => {
      expect(
        await pgCode(run(`select public.owner_billing_details('גלים בע״מ', '12x', 'a@b.co')`)),
      ).toBe('23514');
      await run(
        `select public.owner_billing_details('גלים בע״מ', '514000000', 'Office@Galim.co.il')`,
      );
      expect(
        await run(`select billing_name, billing_tax_id, billing_email from org_subscriptions`),
      ).toEqual([
        {
          billing_name: 'גלים בע״מ',
          billing_tax_id: '514000000',
          billing_email: 'office@galim.co.il',
        },
      ]);
    });
  });
});
