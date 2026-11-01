/**
 * Freediving forms: what the database decides when a diver signs (the text's hash, the time, the medical review,
 * until when it counts), who may sign for whom, who reads what, and how the diver's file follows the signatures.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../harness';
import { createOrgFixture, type OrgFixture } from '../fixtures';
import { ids, sessions } from './session';

let t: TestDatabase;
let A: OrgFixture;
let B: OrgFixture;
const d = {} as {
  mine: string;
  other: string;
  health: string;
  waiver: string;
  insurance: string;
  draft: string;
  file: string;
};
const SIG = JSON.stringify([
  [
    [10, 10],
    [40, 60],
    [80, 20],
    [120, 90],
  ],
  [
    [200, 50],
    [260, 80],
    [300, 40],
    [340, 100],
  ],
]);
const QUESTIONS = JSON.stringify([
  { code: 'heart', he: 'מחלת לב?', flag: true },
  { code: 'cold', he: 'הצטננות?', flag: false },
]);

beforeAll(async () => {
  t = await createTestDatabase();
  A = await createOrgFixture(t.pool, 'forms-a');
  B = await createOrgFixture(t.pool, 'forms-b');
  const q = async (text: string, params: unknown[]) =>
    (await t.pool.query(text, params)).rows[0].id as string;
  d.mine = await q(
    `insert into dive_divers (organization_id, guardian_id, first_name, last_name) values ($1, $2, 'דנה', 'בדיקה') returning id`,
    [A.orgId, A.guardians.mine],
  );
  d.other = await q(
    `insert into dive_divers (organization_id, first_name, last_name) values ($1, 'רון', 'בדיקה') returning id`,
    [A.orgId],
  );
  const tpl = (kind: string, questions: string, published: boolean) =>
    q(
      `insert into dive_form_templates (organization_id, kind, version, title, body, questions, published_at)
       values ($1, $2, 1, 'טופס', 'נוסח הטופס', $3::jsonb, ${published ? 'now()' : 'null'}) returning id`,
      [A.orgId, kind, questions],
    );
  d.health = await tpl('health', QUESTIONS, true);
  d.waiver = await tpl('waiver', '[]', true);
  d.insurance = await tpl('insurance', '[]', true);
  d.draft = await q(
    `insert into dive_form_templates (organization_id, kind, version, title, body) values ($1, 'waiver', 2, 'טיוטה', 'עוד לא') returning id`,
    [A.orgId],
  );
  await t.pool.query(
    `insert into dive_rule_sets (organization_id, effective_from, rules)
     values ($1, '2020-01-01', '{"paperwork": {"medical_valid_months": 6}}')`,
    [A.orgId],
  );
});
afterAll(async () => {
  await t.drop();
});

const { as } = sessions(() => t.pool);

const sign = (
  org: string,
  diver: string,
  template: string,
  answers: Record<string, string> = {},
  extra = '',
  extraVals: unknown[] = [],
) => [
  `insert into dive_form_signatures (organization_id, diver_id, template_id, kind, answers, text_hash, signer_name,
     signature, channel, signed_at${extra ? `, ${extra}` : ''})
   values ($1, $2, $3, 'waiver', $4::jsonb, 'forged', 'דנה בדיקה', $5::jsonb, 'desk', '2001-01-01'${
     extraVals.length ? `, ${extraVals.map((_, i) => `$${i + 6}`).join(', ')}` : ''
   })
   returning id, kind, text_hash, signed_at, valid_until, review, channel, recorded_by`,
  [org, diver, template, JSON.stringify(answers), SIG, ...extraVals],
];

describe('signing a form', () => {
  it('a customer signs their own waiver: the database stamps the text, time and validity', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      const [text, params] = sign(A.orgId, d.mine, d.waiver);
      const [row] = await run<{
        kind: string;
        text_hash: string;
        signed_at: Date;
        valid_until: Date;
        channel: string;
        recorded_by: string;
      }>(text as string, params as unknown[]);
      expect(row?.kind).toBe('waiver');
      expect(row?.text_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.signed_at.getFullYear()).toBeGreaterThan(2020);
      expect(row?.channel).toBe('online');
      expect(row?.recorded_by).toBe(A.users.parent);
      const [diver] = await run<{ waiver_signed_on: Date | null }>(
        'select waiver_signed_on from dive_divers where id = $1',
        [d.mine],
      );
      expect(diver?.waiver_signed_on).not.toBeNull();
    });
  });

  it('a customer cannot sign for someone else, nor sign a draft', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      const [text, params] = sign(A.orgId, d.other, d.waiver);
      await expect(run(text as string, params as unknown[])).rejects.toThrow(/row-level security/);
      const [t2, p2] = sign(A.orgId, d.mine, d.draft);
      await expect(run(t2 as string, p2 as unknown[])).rejects.toThrow(/formNotPublished/);
    });
  });

  it('a health declaration needs every answer; a flagged "yes" waits for the club and does not count yet', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      const [t1, p1] = sign(A.orgId, d.mine, d.health, { heart: 'no' });
      await expect(run(t1 as string, p1 as unknown[])).rejects.toThrow(/formIncomplete/);
      const [t2, p2] = sign(A.orgId, d.mine, d.health, { heart: 'yes', cold: 'no' });
      const [row] = await run<{ review: string; valid_until: Date }>(t2 as string, p2 as unknown[]);
      expect(row?.review).toBe('pending');
      const [diver] = await run<{ medical_expires_on: Date | null }>(
        'select medical_expires_on from dive_divers where id = $1',
        [d.mine],
      );
      expect(diver?.medical_expires_on).toBeNull();
    });
  });

  it('the office clears a pending declaration once; the medical then counts for the rules months', async () => {
    await as(A.users.admin, A.orgId, async (run) => {
      const [t1, p1] = sign(A.orgId, d.other, d.health, { heart: 'yes', cold: 'yes' });
      const [row] = await run<{ id: string; review: string; channel: string }>(
        t1 as string,
        p1 as unknown[],
      );
      expect(row?.review).toBe('pending');
      expect(row?.channel).toBe('desk');
      const [cleared] = await run<{ review: string; reviewed_by: string; signer_name: string }>(
        `update dive_form_signatures set review = 'cleared', review_note = 'אישור רופא', signer_name = 'זיוף'
         where id = $1 returning review, reviewed_by, signer_name`,
        [row?.id],
      );
      expect(cleared).toEqual({
        review: 'cleared',
        reviewed_by: A.users.admin,
        signer_name: 'דנה בדיקה',
      });
      await expect(
        run(`update dive_form_signatures set review = 'refused' where id = $1`, [row?.id]),
      ).rejects.toThrow(/reviewNotPending/);
      const [diver] = await run<{ months: number }>(
        `select (extract(year from age(medical_expires_on, app.today())) * 12
                 + extract(month from age(medical_expires_on, app.today())))::int as months
         from dive_divers where id = $1`,
        [d.other],
      );
      expect(diver?.months).toBe(6);
    });
  });

  it('insurance needs an insurer, a policy and an end date that has not passed; the file follows it', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      const [t1, p1] = sign(
        A.orgId,
        d.mine,
        d.insurance,
        {},
        'insurer, policy_number, valid_until',
        ['הראל', 'P-1', '2000-01-01'],
      );
      await expect(run(t1 as string, p1 as unknown[])).rejects.toThrow(/insuranceExpired/);
      const [t2, p2] = sign(
        A.orgId,
        d.mine,
        d.insurance,
        {},
        'insurer, policy_number, valid_until',
        ['הראל', 'P-1', '2099-03-01'],
      );
      await run(t2 as string, p2 as unknown[]);
      const [diver] = await run<{ insurance_expires_on: Date }>(
        'select insurance_expires_on from dive_divers where id = $1',
        [d.mine],
      );
      expect(diver?.insurance_expires_on.getFullYear()).toBe(2099);
    });
  });

  it('signatures are append-only, and a customer cannot review', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      expect(await run(`update dive_form_signatures set review = 'cleared' returning id`)).toEqual(
        [],
      );
      expect(await run(`delete from dive_form_signatures returning id`)).toEqual([]);
    });
    await as(A.users.owner, A.orgId, async (run) => {
      await run(...(sign(A.orgId, d.other, d.waiver) as [string, unknown[]]));
      await expect(run(`delete from dive_form_signatures`)).rejects.toThrow(/append-only/);
      await expect(
        run(`update dive_form_signatures set signer_name = 'x' where review = 'none'`),
      ).rejects.toThrow(/reviewNotPending/);
    });
  });
});

describe('who reads and writes forms', () => {
  it('a customer reads only published templates and their own signatures', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      await run(...(sign(A.orgId, d.mine, d.waiver) as [string, unknown[]]));
      expect(ids(await run('select id from dive_form_templates'))).toEqual(
        [d.health, d.waiver, d.insurance].sort(),
      );
      const rows = await run<{ diver_id: string }>('select diver_id from dive_form_signatures');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.diver_id === d.mine)).toBe(true);
      await expect(
        run(
          `insert into dive_form_templates (organization_id, kind, version, title, body) values ($1, 'waiver', 9, 'x', 'y')`,
          [A.orgId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('the front desk reads but cannot edit texts; the owner can, until published', async () => {
    await as(A.users.admin, A.orgId, async (run) => {
      expect((await run('select id from dive_form_templates')).length).toBe(4);
      expect(await run(`update dive_form_templates set title = 'x' returning id`)).toEqual([]);
    });
    await as(A.users.owner, A.orgId, async (run) => {
      const [draft] = await run<{ title: string }>(
        `update dive_form_templates set title = 'חדש' where id = $1 returning title`,
        [d.draft],
      );
      expect(draft?.title).toBe('חדש');
      await expect(
        run(`update dive_form_templates set title = 'x' where id = $1`, [d.waiver]),
      ).rejects.toThrow(/formLocked/);
    });
  });

  it('an instructor reads signatures for safety but cannot sign or review', async () => {
    await as(A.users.instructor, A.orgId, async (run) => {
      await run('select id from dive_form_signatures');
      await expect(
        run(...(sign(A.orgId, d.other, d.waiver) as [string, unknown[]])),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('another club sees nothing', async () => {
    await as(B.users.owner, B.orgId, async (run) => {
      expect(await run('select id from dive_form_templates')).toEqual([]);
      expect(await run('select id from dive_form_signatures')).toEqual([]);
    });
  });

  it('a customer uploads their own documents and sees only those', async () => {
    await as(A.users.parent, A.orgId, async (run) => {
      const [f] = await run<{ id: string }>(
        `insert into files (organization_id, bucket, path, mime, size_bytes, purpose, created_by)
         values ($1, 'dive', 'a/b.jpg', 'image/jpeg', 10, 'dive_insurance', $2) returning id`,
        [A.orgId, A.users.parent],
      );
      d.file = f?.id as string;
      await expect(
        run(
          `insert into files (organization_id, bucket, path, mime, size_bytes, purpose, created_by)
           values ($1, 'dive', 'a/c.jpg', 'image/jpeg', 10, 'logo', $2)`,
          [A.orgId, A.users.parent],
        ),
      ).rejects.toThrow(/row-level security/);
      expect(ids(await run('select id from files'))).toEqual([d.file]);
    });
  });
});
