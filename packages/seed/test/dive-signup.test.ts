/**
 * Joining the fake Eilat club through its link: Noam (the demo newcomer) signs in, joins as a diver, sees their first
 * steps, uploads a card and fills in their emergency contact; the desk verifies the card and Noam's level follows.
 * The seed's cards agree with every diver's file and leave cards waiting for the desk.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, type Tx } from '@rswim/db';
import { ACCOUNT_PERSONAS, DIVE_ORG, DIVE_ORG_2, DIVE_PERSONAS } from '@rswim/db/personas';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import {
  CertInput,
  CertReviewInput,
  JoinClubInput,
  MyDetailsInput,
  clubForJoin,
  diverCerts,
  joinClub,
  myWelcome,
  ownerBridge,
  pendingCerts,
  reviewCert,
  submitCert,
  updateMyDetails,
} from '@rswim/domain-dive';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const noam = ACCOUNT_PERSONAS.diveNewcomer.userId;
const asNoam = <T>(fn: (tx: Tx) => Promise<T>, org: string | null = DIVE_ORG.id) =>
  asUser(t.db, { sub: noam, org_id: org }, fn);
const asOffice = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: DIVE_PERSONAS.diveOffice.userId, org_id: DIVE_ORG.id }, fn);
const ctx = (userId: string) => ({ orgId: DIVE_ORG.id, userId });

beforeAll(async () => {
  t = await createTestDatabase();
  await seedDemo(t.pool, { masterKey: randomBytes(32) });
}, 240_000);
afterAll(async () => {
  await t.drop();
});

describe('the seeded cards', () => {
  it("agree with every certified diver's level and leave three waiting for the desk", async () => {
    const { rows } = await t.pool.query<{ n: number }>(
      `select count(*)::int as n from dive_divers d
       where d.cert_level > 0 and d.cert_name is not null and not exists (
         select 1 from dive_certifications c where c.diver_id = d.id and c.status = 'verified'
           and c.level = d.cert_level)`,
    );
    expect(rows[0]?.n).toBe(0);
    await asOffice(async (tx) => {
      const pending = await pendingCerts(tx);
      expect(pending).toHaveLength(3);
      expect(pending.filter((p) => p.currentLevel < p.level)).toHaveLength(3);
      const bridge = await ownerBridge(tx);
      expect(bridge.insights.map((i) => i.kind)).toContain('certs_pending');
    });
  });
});

describe('joining through the link', () => {
  it('a visitor sees the club; Noam joins, and joining again changes nothing', async () => {
    await asAnon(t.db, async (tx) => {
      expect(await clubForJoin(tx, DIVE_ORG.slug)).toMatchObject({ id: DIVE_ORG.id, open: true });
      expect(await clubForJoin(tx, 'rswim-demo')).toBeNull();
      expect(await clubForJoin(tx, 'Bad Slug!')).toBeNull();
    });
    const input = JoinClubInput.parse({
      slug: DIVE_ORG.slug,
      firstName: 'נועם',
      lastName: 'חדש',
      phone: '050-0000203',
      dob: '1994-03-12',
      agree: 'on',
    });
    expect(input.phone).toBe('+972500000203');
    expect(await asNoam((tx) => joinClub(tx, input), null)).toBe(DIVE_ORG.id);
    expect(await asNoam((tx) => joinClub(tx, input), null)).toBe(DIVE_ORG.id);
    const { rows } = await t.pool.query<{ n: number }>(
      `select count(*)::int as n from memberships where user_id = $1`,
      [noam],
    );
    expect(rows[0]?.n).toBe(1);
    // The other club is a different club: Noam is not a customer there.
    await asNoam(async (tx) => expect(await myWelcome(tx)).toBeNull(), DIVE_ORG_2.id);
  });

  it('first steps: details, card, forms, a first dive', async () => {
    await asNoam(async (tx) => {
      const w = (await myWelcome(tx))!;
      expect(w.clubName).toBe(DIVE_ORG.name);
      expect(w.next).toBe('details');
      expect(w.steps.map((s) => s.key)).toEqual([
        'details',
        'cert',
        'health',
        'waiver',
        'insurance',
        'book',
      ]);
      await updateMyDetails(
        tx,
        MyDetailsInput.parse({ emergencyName: 'אמא של נועם', emergencyPhone: '052-1234567' }),
      );
      const card = await submitCert(
        tx,
        ctx(noam),
        CertInput.parse({
          agency: 'molchanovs',
          level: '3',
          name: 'Wave 2',
          number: 'MOL-424242',
          issuedOn: '2025-08-01',
          // A customer cannot verify their own card.
          diverId: undefined,
        }),
      );
      expect(card.status).toBe('pending');
      const after = (await myWelcome(tx))!;
      expect(after.emergencyPhone).toBe('+972521234567');
      expect(after.steps.find((s) => s.key === 'cert')?.state).toBe('waiting');
      expect(after.next).toBe('health');
    });
    expect(CertInput.safeParse({ agency: 'molchanovs', level: '0', name: 'Wave 0' }).success).toBe(
      false,
    );
    expect(MyDetailsInput.safeParse({ emergencyName: 'אמא', emergencyPhone: '123' }).success).toBe(
      false,
    );
  });

  it('the desk verifies the card and the level follows', async () => {
    const card = await asOffice(async (tx) => {
      const p = (await pendingCerts(tx)).find(
        (c) => c.name === 'Wave 2' && c.number === 'MOL-424242',
      )!;
      expect(p.currentLevel).toBe(0);
      await reviewCert(
        tx,
        ctx(DIVE_PERSONAS.diveOffice.userId),
        CertReviewInput.parse({
          certId: p.id,
          decision: 'verified',
          note: 'ראיתי את הכרטיס באפליקציה',
        }),
      );
      return p;
    });
    await expect(
      asOffice((tx) =>
        reviewCert(tx, ctx(DIVE_PERSONAS.diveOffice.userId), {
          certId: card.id,
          decision: 'rejected',
        }),
      ),
    ).rejects.toThrow(/certNotPending/);
    await asNoam(async (tx) => {
      const [c] = await diverCerts(tx, card.diverId);
      expect(c).toMatchObject({ status: 'verified', reviewNote: 'ראיתי את הכרטיס באפליקציה' });
      const w = (await myWelcome(tx))!;
      expect(w.steps.find((s) => s.key === 'cert')?.state).toBe('done');
    });
    const { rows } = await t.pool.query(
      `select cert_level, cert_name, cert_number, source from dive_divers where id = $1`,
      [card.diverId],
    );
    expect(rows[0]).toEqual({
      cert_level: 3,
      cert_name: 'Wave 2',
      cert_number: 'MOL-424242',
      source: 'join_link',
    });
  });

  it('the desk records a card it saw as verified right away', async () => {
    await asOffice(async (tx) => {
      const diver = (await pendingCerts(tx))[0]!.diverId;
      const c = await submitCert(
        tx,
        ctx(DIVE_PERSONAS.diveOffice.userId),
        CertInput.parse({
          diverId: diver,
          agency: 'aida',
          level: '2',
          name: 'AIDA 2',
          verified: 'on',
        }),
      );
      expect(c.status).toBe('verified');
    });
  });
});
