import { describe, expect, it } from 'vitest';
import type { GhlContact } from '@rswim/integrations';
import {
  inboundUpdate,
  normaliseContact,
  planContactImport,
  profileFromTags,
  RSWIM_TAG_MAP,
  shouldPush,
  syncHash,
  type ExistingGuardian,
} from '../src/policies';
import fixture from './fixtures/ghl-contacts.json';

const contacts = fixture.contacts as GhlContact[];

const guardians: ExistingGuardian[] = [
  {
    id: 'g-michal',
    householdId: 'h-cohen',
    phoneE164: '+972500000106',
    email: null,
    ghlContactId: null,
  },
  {
    id: 'g-ronit',
    householdId: 'h-shemesh',
    phoneE164: null,
    email: 'ronit@example.test',
    ghlContactId: null,
  },
  {
    id: 'g-gil',
    householdId: 'h-gil',
    phoneE164: '+972500000203',
    email: null,
    ghlContactId: 'c-009',
  },
  {
    id: 'g-neta',
    householdId: 'h-neta',
    phoneE164: '+972500000204',
    email: null,
    ghlContactId: 'c-gone',
  },
  {
    id: 'g-noname',
    householdId: 'h-noname',
    phoneE164: '+972500000205',
    email: null,
    ghlContactId: null,
  },
];

describe('profileFromTags', () => {
  it('maps R-SWIM tags to fields and keeps unknown tags', () => {
    expect(
      profileFromTags(
        [' שחיית תינוקות', '3-9 חודשים', 'יש פחד מים', 'תג לא מוכר', 'שחיית תינוקות'],
        RSWIM_TAG_MAP,
      ),
    ).toEqual({
      programInterest: ['baby'],
      ageBands: ['3-9m'],
      waterFear: true,
      branches: [],
      flags: [],
      unmappedTags: ['תג לא מוכר'],
    });
  });
  it('lets "has fear" win over "no fear", and records branch and flags', () => {
    expect(
      profileFromTags(
        ['אין פחד ממים', 'יש פחד מים', 'אין פחד ממים', 'שיעורי שחייה הר חומה', 'ליד חם'],
        RSWIM_TAG_MAP,
      ),
    ).toMatchObject({
      waterFear: true,
      branches: ['הר חומה'],
      flags: ['warm_lead'],
    });
    expect(profileFromTags(['אין פחד ממים'], RSWIM_TAG_MAP).waterFear).toBe(false);
    expect(profileFromTags(['ANY'], { any: { field: 'flag', value: 'x' } }).flags).toEqual(['x']);
  });
});

describe('normaliseContact', () => {
  it('normalises Israeli phones and lower-cases emails', () => {
    expect(
      normaliseContact({
        id: 'x',
        firstName: 'א',
        lastName: 'ב',
        phone: '050-000-0106',
        email: ' A@B.test ',
      }),
    ).toEqual({
      ghlId: 'x',
      firstName: 'א',
      lastName: 'ב',
      phoneE164: '+972500000106',
      email: 'a@b.test',
      tags: [],
      dateAdded: '',
    });
  });
  it('splits a full name found in contactName or in firstName alone', () => {
    expect(normaliseContact({ id: 'x', contactName: 'יוסי בן אברהם' })).toMatchObject({
      firstName: 'יוסי',
      lastName: 'בן אברהם',
    });
    expect(normaliseContact({ id: 'x', firstName: 'דנה לוי' })).toMatchObject({
      firstName: 'דנה',
      lastName: 'לוי',
    });
    expect(normaliseContact({ id: 'x', firstName: 'דנה' })).toMatchObject({
      firstName: 'דנה',
      lastName: '',
    });
    expect(normaliseContact({ id: 'x' })).toMatchObject({
      firstName: '',
      lastName: '',
      phoneE164: null,
      email: null,
    });
  });
});

describe('planContactImport', () => {
  const plan = planContactImport(contacts, guardians, RSWIM_TAG_MAP);
  const byId = Object.fromEntries(plan.actions.map((a) => [a.ghlId, a]));

  it('links an existing guardian by phone, even in a local format', () => {
    expect(byId['c-001']).toMatchObject({
      action: 'link',
      guardianId: 'g-michal',
      matchedBy: 'phone',
    });
    expect(byId['c-001']).toMatchObject({
      profile: { programInterest: ['group_kids'], ageBands: ['5-7y'] },
    });
  });
  it('treats a second GHL contact with the same phone as a duplicate of the older one', () => {
    expect(byId['c-002']).toEqual({
      action: 'duplicate_in_ghl',
      ghlId: 'c-002',
      primaryGhlId: 'c-001',
    });
    expect(byId['c-010']).toEqual({
      action: 'duplicate_in_ghl',
      ghlId: 'c-010',
      primaryGhlId: 'c-008',
    });
  });
  it('links by email when there is no phone', () => {
    expect(byId['c-005']).toMatchObject({
      action: 'link',
      guardianId: 'g-ronit',
      matchedBy: 'email',
    });
  });
  it('creates new households for new people, with structured fields from tags', () => {
    expect(byId['c-003']).toMatchObject({
      action: 'create',
      contact: { firstName: 'דנה', lastName: 'לוי', phoneE164: '+972500000201' },
      profile: {
        programInterest: ['baby'],
        ageBands: ['3-9m'],
        waterFear: true,
        unmappedTags: ['תג לא מוכר'],
      },
    });
    expect(byId['c-004']).toMatchObject({
      action: 'create',
      contact: { firstName: 'יוסי', lastName: 'בן אברהם' },
    });
    expect(byId['c-008']).toMatchObject({
      action: 'create',
      contact: { email: 'orit@example.test', phoneE164: null },
    });
  });
  it('reports contacts that cannot be imported', () => {
    expect(byId['c-006']).toMatchObject({ action: 'skipped', reason: 'no_phone_or_email' });
    expect(byId['c-007']).toMatchObject({ action: 'skipped', reason: 'no_phone_or_email' });
    expect(byId['c-013']).toMatchObject({ action: 'skipped', reason: 'no_name' });
    expect(byId['c-012']).toMatchObject({ action: 'link', guardianId: 'g-noname' }); // a match needs no name
  });
  it('flags a guardian linked to a GHL contact that no longer exists', () => {
    expect(byId['c-011']).toEqual({
      action: 'conflict',
      ghlId: 'c-011',
      guardianId: 'g-neta',
      linkedGhlId: 'c-gone',
    });
  });
  it('keeps already-linked contacts primary, ahead of older duplicates', () => {
    const p = planContactImport(
      [
        { id: 'old', firstName: 'א', lastName: 'ב', phone: '0500000203', dateAdded: '2020-01-01' },
        {
          id: 'c-009',
          firstName: 'גיל',
          lastName: 'מקושר',
          phone: '0500000203',
          dateAdded: '2025-01-01',
        },
      ],
      guardians,
      {},
    );
    expect(p.actions).toEqual([
      { action: 'already_linked', ghlId: 'c-009', guardianId: 'g-gil' },
      { action: 'duplicate_in_ghl', ghlId: 'old', primaryGhlId: 'c-009' },
    ]);
  });
  it('breaks ties on the same creation time by GHL id, so runs are deterministic', () => {
    const same = (id: string) => ({
      id,
      firstName: 'א',
      lastName: 'ב',
      phone: '0500000400',
      dateAdded: '2025-01-01',
    });
    const p = planContactImport([same('b'), same('a')], [], {});
    expect(p.actions.map((a) => [a.ghlId, a.action])).toEqual([
      ['a', 'create'],
      ['b', 'duplicate_in_ghl'],
    ]);
  });
  it('counts every outcome', () => {
    expect(plan.stats).toEqual({
      already_linked: 1,
      link: 3,
      create: 4,
      duplicate_in_ghl: 2,
      conflict: 1,
      skipped: 3,
    });
    expect(plan.actions).toHaveLength(contacts.length);
  });

  it('is idempotent: applying the plan and planning again links nothing new', () => {
    const after: ExistingGuardian[] = [...guardians];
    plan.actions.forEach((a, i) => {
      if (a.action === 'link') {
        const g = after.findIndex((x) => x.id === a.guardianId);
        after[g] = { ...(after[g] as ExistingGuardian), ghlContactId: a.ghlId };
      }
      if (a.action === 'create') {
        after.push({
          id: `new-${i}`,
          householdId: `h-new-${i}`,
          phoneE164: a.contact.phoneE164,
          email: a.contact.email,
          ghlContactId: a.ghlId,
        });
      }
    });
    const again = planContactImport(contacts, after, RSWIM_TAG_MAP);
    expect(again.stats).toEqual({
      already_linked: 8,
      link: 0,
      create: 0,
      duplicate_in_ghl: 2,
      conflict: 1,
      skipped: 3,
    });
  });

  it('links two GHL contacts sharing a phone to two guardians only when both guardians exist', () => {
    // A couple sharing one phone: two guardians, but GHL dedupes on phone so the second contact is a duplicate.
    const p = planContactImport(
      [{ id: 'x1', firstName: 'א', lastName: 'ב', phone: '0500000300', dateAdded: '1' }],
      [
        {
          id: 'g1',
          householdId: 'h',
          phoneE164: '+972500000300',
          email: null,
          ghlContactId: 'other',
        },
        { id: 'g2', householdId: 'h', phoneE164: '+972500000300', email: null, ghlContactId: null },
      ],
      {},
    );
    expect(p.actions[0]).toMatchObject({ action: 'link', guardianId: 'g2' });
  });
});

describe('two-way sync', () => {
  const g = { firstName: 'מיכל', lastName: 'כהן', phoneE164: '+972500000106', email: null };

  it('pushes only when the guardian changed since the last exchange', () => {
    expect(shouldPush({ ...g, ghlSyncedHash: null })).toBe(true);
    expect(shouldPush({ ...g, ghlSyncedHash: syncHash(g) })).toBe(false);
    expect(shouldPush({ ...g, lastName: 'לוי', ghlSyncedHash: syncHash(g) })).toBe(true);
  });

  it('applies a real change from GHL and ignores an echo of our own push', () => {
    const synced = { ...g, ghlSyncedHash: syncHash(g) };
    expect(
      inboundUpdate(synced, { id: 'c', firstName: 'מיכל', lastName: 'כהן', phone: '050-000-0106' }),
    ).toBeNull();
    const update = inboundUpdate(synced, {
      id: 'c',
      firstName: 'מיכל',
      lastName: 'כהן-לוי',
      email: 'M@x.test',
    });
    expect(update).toEqual({
      firstName: 'מיכל',
      lastName: 'כהן-לוי',
      phoneE164: '+972500000106',
      email: 'm@x.test',
      ghlSyncedHash: syncHash({ ...g, lastName: 'כהן-לוי', email: 'm@x.test' }),
    });
    // The push that follows our own edit comes back as a webhook: same hash, no change.
    const afterEdit = {
      ...g,
      lastName: 'כהן-לוי',
      email: 'm@x.test',
      ghlSyncedHash: update?.ghlSyncedHash ?? null,
    };
    expect(
      inboundUpdate(afterEdit, {
        id: 'c',
        firstName: 'מיכל',
        lastName: 'כהן-לוי',
        email: 'm@x.test',
      }),
    ).toBeNull();
  });

  it('never erases data with empty GHL fields', () => {
    expect(
      inboundUpdate(
        { ...g, ghlSyncedHash: 'old' },
        { id: 'c', firstName: '', lastName: '', phone: null },
      ),
    ).toBeNull();
  });
});
