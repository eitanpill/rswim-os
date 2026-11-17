import { describe, expect, it } from 'vitest';
import type { ImportMapping } from '@rswim/contracts';
import {
  canUndo,
  cleanMapping,
  guessMapping,
  headerScore,
  mergeSuggestion,
  missingFields,
  parseDate,
  parseDiveLevel,
  parseEmployment,
  parseGender,
  parseMoney,
  planImport,
  readEmail,
  splitName,
  type ImportContext,
} from '../src/policies';

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  phones: new Set(),
  levels: new Map([['שלב 1', 'lvl-1']]),
  groups: new Map([['כרישים א', 'grp-1']]),
  today: '2026-11-17',
  ...over,
});

describe('column mapping', () => {
  it('scores exact synonyms above contained ones, ignores short or empty headers', () => {
    expect(headerScore('families', 'שם האמא', 'parentFullName')).toBe(1000);
    expect(headerScore('families', 'נייד של אמא', 'phone')).toBe(4);
    expect(headerScore('families', '', 'phone')).toBe(0);
    expect(headerScore('families', 'xyz', 'phone')).toBe(0);
    // A field with no synonyms scores nothing.
    expect(headerScore('staff', 'משהו', 'childDob' as never)).toBe(0);
  });

  it('guesses a typical Hebrew families file, each field once', () => {
    const m = guessMapping('families', [
      'שם הילד',
      'תאריך לידה',
      'שם האמא',
      'טלפון',
      'טלפון 2',
      'קבוצה',
      'יתרה',
      'טלפון',
      'עמודה מוזרה',
    ]);
    expect(m).toEqual({
      '0': 'childFullName',
      '1': 'childDob',
      '2': 'parentFullName',
      '3': 'phone',
      '4': 'parent2Phone',
      '5': 'group',
      '6': 'balance',
      '7': '',
      '8': '',
    });
  });

  it('cleans a mapping to known fields and real columns, first column wins', () => {
    expect(
      cleanMapping('divers', 4, { '0': 'fullName', '1': 'fullName', '2': 'balance', '5': 'phone' }),
    ).toEqual({ '0': 'fullName', '1': '', '2': '', '3': '' });
  });

  it('merges a suggestion only into empty columns with unused fields', () => {
    const base: ImportMapping = { '0': 'fullName', '1': '', '2': '', '3': '' };
    expect(
      mergeSuggestion('divers', base, {
        '0': 'phone',
        '1': 'fullName',
        '2': 'city',
        '3': 'nonsense',
        '9': 'email',
      }),
    ).toEqual({ '0': 'fullName', '1': '', '2': 'city', '3': '' });
  });

  it('names the fields a file must still map', () => {
    expect(missingFields('families', { '0': 'notes' })).toEqual(['childFullName', 'phone']);
    expect(missingFields('families', { '0': 'parentFirstName', '1': 'email' })).toEqual([]);
    expect(missingFields('staff', { '0': 'phone' })).toEqual(['fullName']);
    expect(missingFields('divers', { '0': 'firstName' })).toEqual([]);
  });
});

describe('reading cells', () => {
  it('reads dates day-first, ISO and as Excel day numbers', () => {
    expect(parseDate('5/3/2018')).toBe('2018-03-05');
    expect(parseDate('05.03.18')).toBe('2018-03-05');
    expect(parseDate('05-03-85')).toBe('1985-03-05');
    expect(parseDate('2018-03-05')).toBe('2018-03-05');
    expect(parseDate('2018-03-05T00:00:00')).toBe('2018-03-05');
    expect(parseDate('43164')).toBe('2018-03-05');
    expect(parseDate('31/02/2018')).toBeNull();
    expect(parseDate('2018-13-01')).toBeNull();
    expect(parseDate('300')).toBeNull();
    expect(parseDate('0366')).toBeNull();
    expect(parseDate('99999')).toBeNull();
    expect(parseDate('אתמול')).toBeNull();
  });

  it('reads money in its usual spellings', () => {
    expect(parseMoney('₪1,250.50')).toBe(125050);
    expect(parseMoney('300 ש"ח')).toBe(30000);
    expect(parseMoney('-200')).toBe(-20000);
    expect(parseMoney('(200)')).toBe(-20000);
    expect(parseMoney('200-')).toBe(-20000);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney('הרבה')).toBeNull();
  });

  it('reads gender, names, levels, employment and email', () => {
    expect(parseGender('בת')).toBe('female');
    expect(parseGender('M')).toBe('male');
    expect(parseGender('?')).toBeNull();
    expect(splitName('  דנה  בר לב ')).toEqual({ first: 'דנה', last: 'בר לב' });
    expect(splitName('')).toEqual({ first: '', last: '' });
    expect(parseDiveLevel('AIDA 2')).toBe(2);
    expect(parseDiveLevel('3')).toBe(3);
    expect(parseDiveLevel('מתחיל')).toBeNull();
    expect(parseDiveLevel('12')).toBeNull();
    expect(parseEmployment('עוסק מורשה')).toBe('freelancer_licensed');
    expect(parseEmployment('עצמאית')).toBe('freelancer_exempt');
    expect(parseEmployment('שכיר')).toBe('employee');
    expect(parseEmployment('')).toBe('employee');
    expect(readEmail('Dana@Example.test')).toBe('dana@example.test');
    expect(readEmail('dana@')).toBeNull();
  });

  it('allows taking an import back only within its window', () => {
    const at = new Date('2026-11-17T10:00:00Z');
    expect(canUndo(at, new Date('2026-11-18T09:00:00Z'), 24)).toBe(true);
    expect(canUndo(at, new Date('2026-11-18T11:00:00Z'), 24)).toBe(false);
    expect(canUndo(null, at, 24)).toBe(false);
  });
});

describe('planning a families file', () => {
  const mapping: ImportMapping = {
    '0': 'childFullName',
    '1': 'childDob',
    '2': 'parentFullName',
    '3': 'phone',
    '4': 'email',
    '5': 'group',
    '6': 'level',
    '7': 'balance',
    '8': 'childGender',
    '9': 'parent2FullName',
    '10': 'parent2Phone',
    '11': 'notes',
  };
  const row = (...cells: string[]) => cells;

  it('groups siblings by phone, reports every problem, and counts', () => {
    const plan = planImport(
      'families',
      [
        row('נועה כהן', '5/3/2018', 'מיכל כהן', '050-1234567', '', 'כרישים א', 'שלב 1', '300', 'בת', 'אבי', '052-7654321', 'אלרגיה'),
        row('יואב כהן', '1.1.2020', 'מיכל כהן', '0501234567', '', 'דולפינים', 'שלב 9', '300', 'בן', '', '', 'מגיע באוטובוס'),
        row('נועה כהן', '', 'מיכל כהן', '0501234567', '', '', '', '', '', '', '', ''),
        row('', '', '', '', '', '', '', '', '', '', '', ''),
        row('תמר', '', '', '123', '', '', '', '', '', '', '', ''),
        row('רון לוי', '2030-01-01', 'שירה לוי', 'abc', 'shira@example.test', '', '', 'הרבה', '?', '', 'xx', ''),
        row('גיל', '', '', '', '', '', '', '', '', '', '', ''),
        row('', '', '', '', '', '', '', '', '', '', '', 'הערה בלבד'),
        row('אורי', '', 'דני רז', '053-1111111', 'nope', '', '', '-50', '', '', '', ''),
        row('', '', 'דני רז', '053-1111111', '', '', '', '-80', '', '', '', ''),
        row('עדי', '', 'קיימת', '054-9999999', '', '', '', '', '', '', '', ''),
        row('אלה שמש', '', '', '055-2222222', '', '', '', '', '', '', '', ''),
      ],
      mapping,
      ctx({ phones: new Set(['+972549999999']) }),
    );
    expect(plan.rows).toBe(11);
    expect(plan.skipped).toBe(4);
    expect(plan.ready).toBe(7);
    expect(plan.records).toBe(4);
    expect(plan.children).toBe(5);
    const cohen = plan.families[0]!;
    expect(cohen.displayName).toBe('כהן');
    expect(cohen.parent).toEqual({
      firstName: 'מיכל',
      lastName: 'כהן',
      phone: '+972501234567',
      email: null,
    });
    expect(cohen.parent2).toEqual({ firstName: 'אבי', lastName: 'כהן', phone: '+972527654321' });
    expect(cohen.children.map((c) => [c.firstName, c.lastName, c.dob, c.gender, c.levelId, c.groupId])).toEqual([
      ['נועה', 'כהן', '2018-03-05', 'female', 'lvl-1', 'grp-1'],
      ['יואב', 'כהן', '2020-01-01', 'male', null, null],
    ]);
    expect(cohen.children[0]!.groupName).toBe('כרישים א');
    expect(cohen.balanceAgorot).toBe(30000);
    expect(cohen.notes).toBe('אלרגיה\nמגיע באוטובוס');
    // Wrong phone, but reachable by email: comes in without the phone.
    const levi = plan.families[1]!;
    expect(levi.parent.phone).toBeNull();
    expect(levi.parent.email).toBe('shira@example.test');
    expect(levi.parent2).toBeNull();
    expect(levi.children[0]!.dob).toBeNull();
    // Two rows of the same family with different balances are added together.
    expect(plan.families[2]!.balanceAgorot).toBe(-13000);
    expect(plan.families[2]!.parent.email).toBeNull();
    // No parent name: the child's last name names the family.
    const shemesh = plan.families[3]!;
    expect(shemesh.parent.firstName).toBe('');
    expect(shemesh.displayName).toBe('שמש');
    expect(plan.balanceAgorot).toBe(30000 - 13000);
    expect(plan.issues.map((i) => `${i.row}:${i.code}:${i.severity}`)).toEqual([
      '3:unknownLevel:warning',
      '3:unknownGroup:warning',
      '4:duplicate:warning',
      '6:badPhone:error',
      '7:badPhone:warning',
      '7:badPhone:warning',
      '7:badMoney:warning',
      '7:badDate:warning',
      '7:badGender:warning',
      '8:noContact:error',
      '9:missingName:error',
      '9:noContact:error',
      '10:badEmail:warning',
      '10:balanceSummed:warning',
      '12:exists:error',
      '13:parentNameMissing:warning',
    ]);
  });

  it('keeps a family with no children, named by the parent', () => {
    const plan = planImport(
      'families',
      [['דנה', '050-3333333']],
      { '0': 'parentFirstName', '1': 'phone' },
      ctx(),
    );
    expect(plan.families[0]).toMatchObject({ displayName: 'דנה', children: [] });
    expect(plan.families[0]!.parent2).toBeNull();
  });
});

describe('planning divers and staff', () => {
  it('reads divers with levels, and refuses known or repeated people', () => {
    const plan = planImport(
      'divers',
      [
        ['רוני', 'אבן', '050-4444444', 'AIDA 2', '1/1/1990', 'ז', 'Eilat', 'r@example.test', 'AIDA', '123', 'אמא', '050-5555555', 'הערה'],
        ['רוני', 'אבן', '050-4444444', '', '', '', '', '', '', '', '', '', ''],
        ['סתיו', '', '', 'מתחיל', '1/1/2090', '', '', 'bad', '', '', '', 'xx', ''],
        ['סתיו', '', '', '', '', '', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', '', '', '', '', '', 'רק הערה'],
        ['ליה', '', '054-9999999', '', '', '', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', '', '', '', '', '', ''],
      ],
      {
        '0': 'firstName',
        '1': 'lastName',
        '2': 'phone',
        '3': 'certLevel',
        '4': 'dob',
        '5': 'gender',
        '6': 'city',
        '7': 'email',
        '8': 'certAgency',
        '9': 'certNumber',
        '10': 'emergencyName',
        '11': 'emergencyPhone',
        '12': 'notes',
      },
      ctx({ phones: new Set(['+972549999999']) }),
    );
    expect(plan.rows).toBe(6);
    expect(plan.records).toBe(2);
    expect(plan.skipped).toBe(4);
    expect(plan.people[0]).toMatchObject({
      firstName: 'רוני',
      phone: '+972504444444',
      certLevel: 2,
      dob: '1990-01-01',
      gender: 'male',
      city: 'Eilat',
      email: 'r@example.test',
      certAgency: 'AIDA',
      certNumber: '123',
      emergencyName: 'אמא',
      emergencyPhone: '+972505555555',
      notes: 'הערה',
    });
    expect(plan.people[1]).toMatchObject({ firstName: 'סתיו', certLevel: 0, dob: null, email: null });
    expect(plan.issues.map((i) => `${i.row}:${i.code}`)).toEqual([
      '3:duplicate',
      '4:badEmail',
      '4:badDate',
      '4:badLevel',
      '4:badPhone',
      '5:duplicate',
      '6:missingName',
      '7:exists',
    ]);
  });

  it('reads a team list with employment and start dates (no birth dates for staff)', () => {
    const plan = planImport(
      'staff',
      [['יעל מור', 'עצמאית', '2024-09-01', '1/1/1990'], ['דן']],
      { '0': 'fullName', '1': 'employmentType', '2': 'startDate', '3': 'notes', '4': '' },
      ctx(),
    );
    expect(plan.people[0]).toMatchObject({
      firstName: 'יעל',
      lastName: 'מור',
      employmentType: 'freelancer_exempt',
      startDate: '2024-09-01',
      dob: null,
    });
    expect(plan.people[1]).toMatchObject({ firstName: 'דן', employmentType: 'employee' });
    expect(plan.balanceAgorot).toBe(0);
  });
});
