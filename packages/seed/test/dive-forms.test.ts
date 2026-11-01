/**
 * The club's forms on the fake Eilat club: the seed's signatures agree with every diver's file, a diver signs from
 * their phone, the desk signs on its tablet, the office clears a pending health declaration, the manager publishes a
 * new text, and the owner's feed counts what waits.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { DIVE_ORG, DIVE_PERSONAS } from '@rswim/db/personas';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import {
  currentForm,
  diverPaperwork,
  listFormTemplates,
  myDiverId,
  ownerBridge,
  paperworkQueue,
  publishForm,
  reviewHealth,
  saveFormDraft,
  FormDraftInput,
  SignFormInput,
  signForm,
  signatureView,
} from '@rswim/domain-dive';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const as = <T>(persona: keyof typeof DIVE_PERSONAS, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: DIVE_PERSONAS[persona].userId, org_id: DIVE_ORG.id }, fn);
const ctx = (persona: keyof typeof DIVE_PERSONAS) => ({
  orgId: DIVE_ORG.id,
  userId: DIVE_PERSONAS[persona].userId,
});
const SIG = JSON.stringify([
  [
    [10, 10],
    [60, 80],
    [120, 30],
    [180, 120],
    [240, 60],
  ],
  [
    [300, 90],
    [360, 40],
    [420, 110],
  ],
]);

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('the seeded paperwork', () => {
  it("agrees with every diver's file", async () => {
    const { rows } = await t.pool.query<{ n: number }>(
      `select count(*)::int as n from dive_divers d where d.organization_id = $1 and (
         d.waiver_signed_on is distinct from (select max((s.signed_at at time zone 'Asia/Jerusalem')::date)
           from dive_form_signatures s where s.diver_id = d.id and s.kind = 'waiver')
         or d.insurance_expires_on is distinct from (select s.valid_until from dive_form_signatures s
           where s.diver_id = d.id and s.kind = 'insurance' order by s.signed_at desc limit 1))`,
      [DIVE_ORG.id],
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('has published texts, a draft, health declarations waiting and insurance ending', async () => {
    await as('diveManager', async (tx) => {
      const templates = await listFormTemplates(tx);
      expect(
        templates
          .filter((x) => x.publishedAt)
          .map((x) => x.kind)
          .sort(),
      ).toEqual(['health', 'insurance', 'waiver']);
      expect(templates.some((x) => !x.publishedAt && x.kind === 'waiver')).toBe(true);
      const q = await paperworkQueue(tx);
      expect(q.pending).toHaveLength(2);
      expect(q.pending.every((p) => p.flagged.length === 1 && p.nextOn !== null)).toBe(true);
      expect(q.insurance.length).toBeGreaterThan(0);
      const bridge = await ownerBridge(tx);
      expect(bridge.insights.map((i) => i.kind)).toEqual(
        expect.arrayContaining(['forms_pending', 'insurance']),
      );
    });
  });
});

describe('signing', () => {
  it("Dana's insurance is ending; she renews it from her phone and the file follows", async () => {
    await as('diveCustomer', async (tx) => {
      const me = (await myDiverId(tx)) as string;
      const before = await diverPaperwork(tx, me);
      expect(before.items.find((i) => i.kind === 'insurance')?.state).toBe('warn');
      expect(before.toSign).toContain('insurance');
      const tpl = (await currentForm(tx, 'insurance'))!;
      const signed = await signForm(
        tx,
        ctx('diveCustomer'),
        SignFormInput.parse({
          templateId: tpl.id,
          signerName: 'דנה אביב',
          signature: SIG,
          agree: 'on',
          insurer: 'DAN Europe',
          policyNumber: 'DV-555123',
          insuranceValidUntil: '2099-06-30',
        }),
      );
      expect(signed).toMatchObject({ kind: 'insurance', review: 'none', validUntil: '2099-06-30' });
      const after = await diverPaperwork(tx, me);
      expect(after.items.find((i) => i.kind === 'insurance')?.state).toBe('ok');
      expect(after.toSign).not.toContain('insurance');
      const view = (await signatureView(tx, signed.id))!;
      expect(view.channel).toBe('online');
      expect(view.textHash).toMatch(/^[0-9a-f]{64}$/);
      expect(view.signature).toHaveLength(2);
    });
  });

  it('a "yes" on a medical question waits; the office clears it and the medical counts', async () => {
    const { rows } = await t.pool.query<{ id: string }>(
      `select id from dive_divers where organization_id = $1 and medical_expires_on is null limit 1`,
      [DIVE_ORG.id],
    );
    const diver = rows[0]?.id as string;
    const sigId = await as('diveOffice', async (tx) => {
      const tpl = (await currentForm(tx, 'health'))!;
      const answers = Object.fromEntries(tpl.questions.map((q) => [q.code, 'no']));
      answers.lungs = 'yes';
      const signed = await signForm(
        tx,
        ctx('diveOffice'),
        SignFormInput.parse({
          templateId: tpl.id,
          diverId: diver,
          signerName: 'צולל בדיקה',
          signature: SIG,
          agree: 'on',
          answers,
        }),
      );
      expect(signed.review).toBe('pending');
      const view = (await signatureView(tx, signed.id))!;
      expect(view.channel).toBe('desk');
      expect(view.recordedByName).toBe('שני אלון');
      return signed.id;
    });
    await as('diveOffice', async (tx) => {
      expect((await diverPaperwork(tx, diver)).items[0]?.state).toBe('pending');
      await reviewHealth(tx, ctx('diveOffice'), {
        signatureId: sigId,
        decision: 'cleared',
        note: 'אישור רופא ריאות',
      });
      const p = await diverPaperwork(tx, diver);
      expect(p.items[0]).toMatchObject({ kind: 'health', state: 'ok' });
      await expect(
        reviewHealth(tx, ctx('diveOffice'), { signatureId: sigId, decision: 'refused' }),
      ).rejects.toThrow(/reviewNotPending/);
    });
  });

  it('a signature without the pad, the agreement or every answer is refused', () => {
    expect(
      SignFormInput.safeParse({
        templateId: crypto.randomUUID(),
        signerName: 'דנה',
        signature: '[]',
        agree: 'on',
      }).success,
    ).toBe(false);
    expect(
      SignFormInput.safeParse({
        templateId: crypto.randomUUID(),
        signerName: 'דנה',
        signature: SIG,
      }).success,
    ).toBe(false);
    expect(
      SignFormInput.safeParse({
        templateId: crypto.randomUUID(),
        signerName: 'דנה',
        signature: 'x',
        agree: 'on',
      }).success,
    ).toBe(false);
  });
});

describe('the texts', () => {
  it('the manager edits the draft and publishes it; the desk cannot', async () => {
    const draft = FormDraftInput.parse({
      kind: 'waiver',
      title: 'כתב ויתור 2027',
      body: 'נוסח חדש וארוך מספיק של כתב הוויתור לשנה הבאה.',
    });
    await expect(
      as('diveOffice', (tx) => saveFormDraft(tx, ctx('diveOffice'), draft)),
    ).rejects.toThrow();
    await as('diveManager', async (tx) => {
      const id = await saveFormDraft(tx, ctx('diveManager'), draft);
      await publishForm(tx, ctx('diveManager'), { templateId: id });
      const live = (await currentForm(tx, 'waiver'))!;
      expect(live).toMatchObject({ id, version: 2, title: 'כתב ויתור 2027' });
      await expect(publishForm(tx, ctx('diveManager'), { templateId: id })).rejects.toThrow(
        /formLocked/,
      );
      const health = FormDraftInput.parse({
        kind: 'health',
        title: 'הצהרה',
        body: 'נוסח הצהרת בריאות חדש וארוך מספיק.',
        questions: '! מחלת לב?\nהצטננות?\n',
      });
      expect(health.questions).toEqual([
        { code: 'q1', he: 'מחלת לב?', flag: true },
        { code: 'q2', he: 'הצטננות?', flag: false },
      ]);
    });
  });
});
