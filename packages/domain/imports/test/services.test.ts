/**
 * SaaS stage 5: a business brings its data in from a file. Runs against a throwaway database as the signed-in owner
 * (RLS applies). All names, phones and amounts are invented.
 */
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { DomainError, toDomainError, type ServiceContext } from '@rswim/domain-core';
import {
  commitImport,
  createImportDraft,
  decodeText,
  discardImport,
  fetchSheet,
  getImport,
  importMandates,
  listImports,
  parseCsv,
  previewImport,
  readTable,
  requestMandates,
  saveMapping,
  sheetsCsvUrl,
  toTable,
  undoImport,
  MappingInput,
} from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
let groupId = '';
let tinyGroupId = '';

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const de = toDomainError(e);
    if (de) return de.code;
    throw e;
  }
  return null;
};
const TEXTS = { balanceDescription: 'יתרה ממערכת קודמת' };

beforeAll(async () => {
  t = await createTestDatabase();
  const [org] = await q(
    `insert into organizations (slug, name) values ('import', 'בית ספר לייבוא (דמו)') returning id`,
  );
  await q(`insert into org_settings (organization_id) values ($1)`, [org.id]);
  const [u] = await q(`insert into auth.users (email) values ('owner@example.test') returning id`);
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    org.id,
    u.id,
  ]);
  ctx = { orgId: org.id, userId: u.id };
  const [v] = await q(
    `insert into venues (organization_id, name) values ($1, 'בריכת בדיקה (דמו)') returning id`,
    [ctx.orgId],
  );
  const [pool] = await q(
    `insert into pools (organization_id, venue_id, name) values ($1, $2, 'ראשית') returning id`,
    [ctx.orgId, v.id],
  );
  const [p] = await q(
    `insert into programs (organization_id, code, kind, name_he, default_duration_min, default_capacity)
     values ($1, 'kids', 'group_kids', 'קבוצת ילדים', 45, 6) returning id`,
    [ctx.orgId],
  );
  await q(
    `insert into levels (organization_id, program_id, code, name_he, ordinal) values ($1, $2, 'k1', 'שלב 1', 1)`,
    [ctx.orgId, p.id],
  );
  const group = async (name: string, capacity: number) =>
    (
      await q(
        `insert into class_templates (organization_id, name, program_id, venue_id, pool_id, weekday, starts_at,
                                      duration_min, capacity, effective_from)
         values ($1, $2, $3, $4, $5, 2, '17:00', 45, $6, '2026-08-01') returning id`,
        [ctx.orgId, name, p.id, v.id, pool.id, capacity],
      )
    )[0].id as string;
  groupId = await group('כרישים א', 6);
  tinyGroupId = await group('קטנה', 1);
  // A family that is already in the system (by phone).
  const [hh] = await q(
    `insert into households (organization_id, display_name) values ($1, 'קיימים (דמו)') returning id`,
    [ctx.orgId],
  );
  await q(
    `insert into guardians (organization_id, household_id, first_name, last_name, phone_e164)
     values ($1, $2, 'קיימת', 'דמו', '+972549999999')`,
    [ctx.orgId, hh.id],
  );
});
afterAll(async () => {
  await t.drop();
});

describe('reading files', () => {
  it('reads Hebrew CSV in UTF-8 (with a BOM) and in the Windows Hebrew encoding', () => {
    const utf8 = new TextEncoder().encode('﻿שם הילד,טלפון\r\nנועה,050-1234567\r\n');
    expect(decodeText(utf8)).toBe('שם הילד,טלפון\r\nנועה,050-1234567\r\n');
    // "שלום" in windows-1255.
    expect(decodeText(new Uint8Array([0xf9, 0xec, 0xe5, 0xed]))).toBe('שלום');
  });

  it('parses quoted fields, semicolons and tabs, and builds a table', () => {
    expect(parseCsv('a;b\n"x;1";"he said ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x;1', 'he said "hi"'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,"line\nbreak"\r\n')).toEqual([['a', 'line\nbreak']]);
    expect(toTable([[''], ['שם', '', ''], ['דנה', '1', ''], ['', '', '']])).toEqual({
      headers: ['שם', '#2'],
      rows: [['דנה', '1']],
    });
    expect(() => toTable([['שם']])).toThrow(DomainError);
    expect(() => toTable([])).toThrow(DomainError);
    expect(() => toTable([['שם'], ...Array.from({ length: 3001 }, () => ['x'])])).toThrow(
      'imports.errors.tooManyRows',
    );
  });

  it('reads the first sheet of an Excel file, dates included', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('משפחות');
    sheet.addRow(['שם הילד', 'תאריך לידה', 'טלפון', 'נוסחה']);
    sheet.addRow([
      'נועה',
      new Date(Date.UTC(2018, 2, 5)),
      '0501234567',
      { formula: '1+1', result: 2 },
    ]);
    sheet.addRow([{ richText: [{ text: 'יו' }, { text: 'אב' }] }, null, 501234568, null]);
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    const table = await readTable('families.xlsx', bytes);
    expect(table.headers).toEqual(['שם הילד', 'תאריך לידה', 'טלפון', 'נוסחה']);
    expect(table.rows).toEqual([
      ['נועה', '2018-03-05', '0501234567', '2'],
      ['יואב', '', '501234568', ''],
    ]);
    expect(await code(readTable('families.xlsx', new Uint8Array([1, 2, 3])))).toBe(
      'imports.errors.unreadable',
    );
    expect(await code(readTable('old.xls', bytes))).toBe('imports.errors.format');
    expect((await readTable('f.csv', new TextEncoder().encode('שם\nדנה'))).rows).toEqual([['דנה']]);
  });

  it('reads only Google Sheets links, shared by link', async () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    expect(sheetsCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=42`)).toBe(
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=42`,
    );
    expect(sheetsCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit`)).toBe(
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`,
    );
    expect(sheetsCsvUrl('http://docs.google.com/spreadsheets/d/x')).toBeNull();
    expect(sheetsCsvUrl('https://evil.example.test/spreadsheets/d/' + id)).toBeNull();
    expect(sheetsCsvUrl('https://docs.google.com/document/d/' + id)).toBeNull();
    expect(sheetsCsvUrl('not a url')).toBeNull();
    const link = `https://docs.google.com/spreadsheets/d/${id}/edit`;
    const reply = (body: string, type: string, status = 200) =>
      (async () =>
        new Response(body, { status, headers: { 'content-type': type } })) as typeof fetch;
    expect((await fetchSheet(link, reply('שם\nדנה', 'text/csv'))).rows).toEqual([['דנה']]);
    expect(await code(fetchSheet(link, reply('<html>', 'text/html')))).toBe(
      'imports.errors.sheetPrivate',
    );
    expect(await code(fetchSheet(link, reply('', 'text/csv', 404)))).toBe(
      'imports.errors.sheetPrivate',
    );
    const broken = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await code(fetchSheet(link, broken))).toBe('imports.errors.sheetPrivate');
    expect(await code(fetchSheet('https://example.test/x'))).toBe('imports.errors.sheetLink');
    const huge = reply('x'.repeat(5 * 1024 * 1024 + 1), 'text/csv');
    expect(await code(fetchSheet(link, huge))).toBe('imports.errors.tooLarge');
  });
});

const FAMILIES = {
  headers: ['שם הילד', 'תאריך לידה', 'שם ההורה', 'נייד', 'קבוצה', 'רמה', 'יתרת חוב', 'מגדר'],
  rows: [
    ['נועה כהן', '5/3/2018', 'מיכל כהן', '050-1234567', 'כרישים א', 'שלב 1', '300', 'בת'],
    ['יואב כהן', '1/1/2019', 'מיכל כהן', '050-1234567', 'קטנה', '', '300', 'בן'],
    ['תמר לוי', '2/2/2017', 'שירה לוי', '052-7654321', 'קטנה', '', '', ''],
    ['אורי רז', '', 'דני רז', '053-1111111', '', '', '-50', ''],
    ['עדי', '', 'קיימת', '054-9999999', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['גיל', '', '', '', '', '', '', ''],
  ],
};

describe('a families file', () => {
  let importId = '';

  it('keeps the upload as a draft with its columns guessed, and previews it', async () => {
    importId = await owner((tx) =>
      createImportDraft(tx, ctx, { kind: 'families', fileName: 'משפחות.csv', table: FAMILIES }),
    );
    const { run, plan, missing } = await owner((tx) => previewImport(tx, importId));
    expect(run.status).toBe('draft');
    expect(run.mapping).toEqual({
      '0': 'childFullName',
      '1': 'childDob',
      '2': 'parentFullName',
      '3': 'phone',
      '4': 'group',
      '5': 'level',
      '6': 'balance',
      '7': 'childGender',
    });
    expect(missing).toEqual([]);
    expect(plan).toMatchObject({ rows: 6, ready: 4, skipped: 2, records: 3, children: 4 });
    expect(plan.issues.map((i) => `${i.row}:${i.code}`)).toEqual(['6:exists', '8:noContact']);
    // Nobody else sees the draft in the list of imports.
    expect(await owner((tx) => listImports(tx))).toEqual([]);
  });

  it("takes the owner's corrections to the columns", async () => {
    const input = MappingInput.parse({ importId, col_0: 'childFullName', col_3: '', other: 'x' });
    await owner((tx) => saveMapping(tx, input));
    const { missing } = await owner((tx) => previewImport(tx, importId));
    expect(missing).toEqual(['phone']);
    expect(
      await code(owner((tx) => commitImport(tx, ctx, { importId, whatsappOptIn: true }, TEXTS))),
    ).toBe('imports.errors.mapping');
    await owner((tx) =>
      saveMapping(
        tx,
        MappingInput.parse({
          importId,
          col_0: 'childFullName',
          col_1: 'childDob',
          col_2: 'parentFullName',
          col_3: 'phone',
          col_4: 'group',
          col_5: 'level',
          col_6: 'balance',
          col_7: 'childGender',
        }),
      ),
    );
  });

  it('saves families, children, groups and balances in one go, and drops the file rows', async () => {
    const started = Date.now();
    const r = await owner((tx) => commitImport(tx, ctx, { importId, whatsappOptIn: true }, TEXTS));
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(r).toEqual({ importId, records: 3, children: 4 });
    const fams = await q(
      `select h.display_name, g.first_name, g.phone_e164, g.whatsapp_opt_in,
              (select count(*)::int from students s where s.household_id = h.id) kids,
              (select coalesce(sum(amount_agorot), 0)::int from ledger_entries l where l.household_id = h.id) balance
       from households h join guardians g on g.household_id = h.id
       where h.organization_id = $1 and h.display_name <> 'קיימים (דמו)' order by h.display_name`,
      [ctx.orgId],
    );
    expect(fams).toEqual([
      {
        display_name: 'כהן',
        first_name: 'מיכל',
        phone_e164: '+972501234567',
        whatsapp_opt_in: true,
        kids: 2,
        balance: 30000,
      },
      {
        display_name: 'לוי',
        first_name: 'שירה',
        phone_e164: '+972527654321',
        whatsapp_opt_in: true,
        kids: 1,
        balance: 0,
      },
      {
        display_name: 'רז',
        first_name: 'דני',
        phone_e164: '+972531111111',
        whatsapp_opt_in: true,
        kids: 1,
        balance: -5000,
      },
    ]);
    const noa = (
      await q(
        `select s.dob::text, s.gender, l.code level, (select ct.name from enrollments e
           join class_templates ct on ct.id = e.class_template_id where e.student_id = s.id) as grp
         from students s left join levels l on l.id = s.level_id where s.first_name = 'נועה'`,
      )
    )[0];
    expect(noa).toEqual({ dob: '2018-03-05', gender: 'female', level: 'k1', grp: 'כרישים א' });
    // The small group took the first child; the second is in, but not in the group, and that is reported.
    expect(
      await q(`select count(*)::int n from enrollments where class_template_id = $1`, [
        tinyGroupId,
      ]),
    ).toEqual([{ n: 1 }]);
    const run = await owner((tx) => getImport(tx, importId));
    expect(run).toMatchObject({ status: 'succeeded', rows: [], canUndo: true });
    expect(run!.headers).toHaveLength(8);
    expect(run!.stats).toMatchObject({
      records: 3,
      children: 4,
      placed: 2,
      notPlaced: 1,
      balanceAgorot: 25000,
    });
    expect(run!.report.find((i) => i.code === 'notPlaced')?.value).toMatch(/^קטנה\|/);
    expect(await owner((tx) => listImports(tx))).toHaveLength(1);
    expect(groupId).toBeTruthy();
    // A saved import cannot be saved twice.
    expect(
      await code(owner((tx) => commitImport(tx, ctx, { importId, whatsappOptIn: true }, TEXTS))),
    ).toBe('common.errors.notFound');
  });

  it('sends each family a personal link to sign a standing order, and shows who signed', async () => {
    const send = () =>
      owner((tx) =>
        requestMandates(tx, ctx, {
          importId,
          publicUrl: 'https://app.example.test/',
          description: 'הוראת קבע',
        }),
      );
    expect(await code(send())).toBe('payments.errors.notConnected');
    await q(
      `insert into payment_connections (organization_id, provider, methods, enc_credentials, enc_webhook_secret)
       values ($1, 'grow', '{card,standing_order}', '\\x00', '\\x00')`,
      [ctx.orgId],
    );
    const [cohen] = await q(`select id from households where display_name = 'כהן'`);
    await q(
      `insert into standing_orders (organization_id, household_id, mandate_id) values ($1, $2, 'demo-mandate-1')`,
      [ctx.orgId, cohen.id],
    );
    expect(await send()).toBe(2);
    expect(await send()).toBe(0);
    const states = await owner((tx) => importMandates(tx, importId));
    expect(states.map((s) => [s.name, s.state])).toEqual([
      ['כהן', 'signed'],
      ['לוי', 'sent'],
      ['רז', 'sent'],
    ]);
    const events = await q(
      `select payload from outbox where organization_id = $1 and event_type = 'billing.mandate_requested'`,
      [ctx.orgId],
    );
    expect(events).toHaveLength(2);
    expect(events[0].payload.url).toMatch(
      /^https:\/\/app\.example\.test\/pay\/[A-Za-z0-9_-]{30,}$/,
    );
    expect(await owner((tx) => importMandates(tx, '00000000-0000-4000-8000-000000000000'))).toEqual(
      [],
    );
  });

  it('takes the import back, keeping the families that were used since', async () => {
    // The Levi family paid something by hand after the import: it stays.
    const [levi] = await q(`select id from households where display_name = 'לוי'`);
    await q(
      `insert into ledger_entries (organization_id, household_id, type, amount_agorot, description, occurred_on,
                                   source, idempotency_key)
       values ($1, $2, 'charge', 1000, 'חיוב ידני (דמו)', current_date, 'manual', 'demo-manual-1')`,
      [ctx.orgId, levi.id],
    );
    const r = await owner((tx) => undoImport(tx, importId));
    // Cohen has a signed standing order and Levi a manual charge; Raz goes with its opening balance.
    expect(r).toEqual({ removed: 1, kept: 2 });
    expect(await q(`select display_name from households where display_name = 'רז'`)).toEqual([]);
    expect(await q(`select count(*)::int n from ledger_entries where source = 'import'`)).toEqual([
      { n: 1 },
    ]);
    expect(await owner((tx) => getImport(tx, importId))).toMatchObject({
      status: 'undone',
      canUndo: false,
      stats: expect.objectContaining({ removed: 1, kept: 2 }),
    });
    expect(await code(owner((tx) => undoImport(tx, importId)))).toBe('imports.errors.undoClosed');
    expect(await code(owner((tx) => undoImport(tx, '00000000-0000-4000-8000-000000000000')))).toBe(
      'common.errors.notFound',
    );
    // The ledger still refuses any other delete.
    await expect(q(`delete from ledger_entries where source = 'manual'`)).rejects.toThrow(
      /append-only/,
    );
  });

  it('cannot take an import back after a day', async () => {
    const id = await owner((tx) =>
      createImportDraft(tx, ctx, {
        kind: 'families',
        fileName: 'later.csv',
        table: { headers: ['שם ההורה', 'טלפון'], rows: [['רינה', '058-7777777']] },
      }),
    );
    await owner((tx) => commitImport(tx, ctx, { importId: id, whatsappOptIn: false }, TEXTS));
    expect(
      await q(`select whatsapp_opt_in from guardians where phone_e164 = '+972587777777'`),
    ).toEqual([{ whatsapp_opt_in: false }]);
    await q(`update import_runs set committed_at = now() - interval '25 hours' where id = $1`, [
      id,
    ]);
    expect(await code(owner((tx) => undoImport(tx, id)))).toBe('imports.errors.undoClosed');
  });

  it('refuses a file with nothing to bring in, and drops drafts on request or after a week', async () => {
    const id = await owner((tx) =>
      createImportDraft(tx, ctx, {
        kind: 'families',
        fileName: 'empty.csv',
        table: { headers: ['שם ההורה', 'טלפון'], rows: [['קיימת', '054-9999999']] },
      }),
    );
    expect(
      await code(
        owner((tx) => commitImport(tx, ctx, { importId: id, whatsappOptIn: true }, TEXTS)),
      ),
    ).toBe('imports.errors.nothing');
    await owner((tx) => discardImport(tx, id));
    expect(await code(owner((tx) => previewImport(tx, id)))).toBe('common.errors.notFound');
    expect(await code(owner((tx) => saveMapping(tx, MappingInput.parse({ importId: id }))))).toBe(
      'common.errors.notFound',
    );
    const old = await owner((tx) =>
      createImportDraft(tx, ctx, {
        kind: 'staff',
        fileName: 'old.csv',
        table: { headers: ['שם'], rows: [['דן']] },
      }),
    );
    await q(`update import_runs set created_at = now() - interval '8 days' where id = $1`, [old]);
    await owner((tx) =>
      createImportDraft(tx, ctx, {
        kind: 'staff',
        fileName: 'new.csv',
        table: { headers: ['שם'], rows: [['דן']] },
      }),
    );
    expect(await q(`select status, source from import_runs where id = $1`, [old])).toEqual([
      { status: 'failed', source: null },
    ]);
  });
});

describe('divers and staff', () => {
  it('brings divers and team members in, and takes back only the unused ones', async () => {
    const divers = await owner((tx) =>
      createImportDraft(tx, ctx, {
        kind: 'divers',
        fileName: 'divers.xlsx',
        table: {
          headers: ['שם מלא', 'נייד', 'רמה', 'מייל'],
          rows: [
            ['רוני אבן', '050-4444444', 'AIDA 2', 'roni@example.test'],
            ['סתיו', '', '', ''],
          ],
        },
      }),
    );
    expect(
      await owner((tx) => commitImport(tx, ctx, { importId: divers, whatsappOptIn: true }, TEXTS)),
    ).toMatchObject({ records: 2 });
    expect(
      await q(`select first_name, cert_level, source from dive_divers order by first_name`),
    ).toEqual([
      { first_name: 'סתיו', cert_level: 0, source: 'import' },
      { first_name: 'רוני', cert_level: 2, source: 'import' },
    ]);
    expect(await owner((tx) => importMandates(tx, divers))).toEqual([]);
    expect(await owner((tx) => undoImport(tx, divers))).toEqual({ removed: 2, kept: 0 });

    const staff = await owner((tx) =>
      createImportDraft(tx, ctx, {
        kind: 'staff',
        fileName: 'team.csv',
        table: {
          headers: ['שם', 'טלפון', 'סוג העסקה'],
          rows: [
            ['יעל מור', '050-6666666', 'עצמאית'],
            ['דן גל', '', 'שכיר'],
          ],
        },
      }),
    );
    await owner((tx) => commitImport(tx, ctx, { importId: staff, whatsappOptIn: true }, TEXTS));
    const [yael] = await q(
      `select id, employment_type from staff_members where first_name = 'יעל'`,
    );
    expect(yael.employment_type).toBe('freelancer_exempt');
    // Yael leads a group now: she stays.
    await q(`update class_templates set lead_staff_id = $1 where id = $2`, [yael.id, groupId]);
    expect(await owner((tx) => undoImport(tx, staff))).toEqual({ removed: 1, kept: 1 });
  });

  it('saves nothing when the plan has no room for the file', async () => {
    await q(
      `insert into plans (code, name_he, name_en, price_agorot, max_students) values ('tiny', 'זעיר', 'Tiny', 0, 6)`,
    );
    await q(`insert into org_subscriptions (organization_id, plan_code) values ($1, 'tiny')`, [
      ctx.orgId,
    ]);
    const id = await owner((tx) =>
      createImportDraft(tx, ctx, {
        kind: 'divers',
        fileName: 'many.csv',
        table: {
          headers: ['שם'],
          rows: Array.from({ length: 10 }, (_, i) => [`צולל ${i + 1}`]),
        },
      }),
    );
    expect(
      await code(
        owner((tx) => commitImport(tx, ctx, { importId: id, whatsappOptIn: true }, TEXTS)),
      ),
    ).toBe('platform.errors.limit.divers');
    expect(await q(`select count(*)::int n from dive_divers`)).toEqual([{ n: 0 }]);
    expect(await q(`select status from import_runs where id = $1`, [id])).toEqual([
      { status: 'draft' },
    ]);
  });
});

describe('a large file', () => {
  it('saves 200 families with 400 children well within two minutes, and takes them all back', async () => {
    await q(`delete from org_subscriptions where organization_id = $1`, [ctx.orgId]);
    const rows: string[][] = [];
    for (let i = 0; i < 200; i++) {
      const phone = `0537${String(100_000 + i).padStart(6, '0')}`;
      for (const child of ['א', 'ב']) {
        rows.push([
          `הורה${i} משפחה${i}`,
          phone,
          `ילד${child} משפחה${i}`,
          '01/02/2018',
          'שלב 1',
          '50',
        ]);
      }
    }
    const table = toTable([['שם ההורה', 'טלפון', 'שם הילד', 'תאריך לידה', 'רמה', 'יתרה'], ...rows]);
    const id = await owner((tx) =>
      createImportDraft(tx, ctx, { kind: 'families', fileName: 'גדול.csv', table }),
    );
    const started = Date.now();
    await owner((tx) => commitImport(tx, ctx, { importId: id, whatsappOptIn: false }, TEXTS));
    const ms = Date.now() - started;
    const run = await owner((tx) => getImport(tx, id));
    expect(run?.stats).toMatchObject({ records: 200, children: 400, skipped: 0 });
    expect(ms).toBeLessThan(120_000);
    expect(await owner((tx) => undoImport(tx, id))).toEqual({ removed: 200, kept: 0 });
  }, 150_000);
});
