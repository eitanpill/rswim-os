/**
 * Importing a file (SaaS stage 5), the pure part: which column is which field, how a cell is read (dates, money,
 * gender, levels), and what each row will become, with every problem found before anything is saved. Nothing here
 * touches the database: the services hand in what already exists (phones, levels, groups).
 */
import {
  HEADER_SYNONYMS,
  IMPORT_FIELDS,
  normalizeHeader,
  toE164IL,
  type EmploymentType,
  type ImportField,
  type ImportKind,
  type ImportMapping,
} from '@rswim/contracts';

// ─── Column mapping ─────────────────────────────────────────────────────────

/**
 * How strongly a header points at a field: 1000 for an exact synonym, else the length of the longest synonym of 3
 * letters or more that it contains, else 0.
 */
export function headerScore(kind: ImportKind, header: string, field: ImportField): number {
  const h = normalizeHeader(header);
  if (!h) return 0;
  let best = 0;
  for (const raw of HEADER_SYNONYMS[kind][field] ?? []) {
    const s = normalizeHeader(raw);
    if (s === h) return 1000;
    if (s.length >= 3 && h.includes(s)) best = Math.max(best, s.length);
  }
  return best;
}

/** The likeliest field for each column: the strongest matches first, each field and each column used once. */
export function guessMapping(kind: ImportKind, headers: readonly string[]): ImportMapping {
  const pairs: { col: number; field: ImportField; score: number }[] = [];
  headers.forEach((header, col) => {
    for (const field of IMPORT_FIELDS[kind]) {
      const score = headerScore(kind, header, field);
      if (score > 0) pairs.push({ col, field, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.col - b.col);
  const mapping: ImportMapping = Object.fromEntries(headers.map((_, i) => [String(i), '']));
  const used = new Set<ImportField>();
  const taken = new Set<number>();
  for (const p of pairs) {
    if (used.has(p.field) || taken.has(p.col)) continue;
    mapping[String(p.col)] = p.field;
    used.add(p.field);
    taken.add(p.col);
  }
  return mapping;
}

/** Keeps a mapping to known fields of the kind and to columns that exist, each field once (the first column wins). */
export function cleanMapping(
  kind: ImportKind,
  columns: number,
  raw: Record<string, string>,
): ImportMapping {
  const known = new Set<string>(IMPORT_FIELDS[kind]);
  const used = new Set<string>();
  const out: ImportMapping = {};
  for (let i = 0; i < columns; i++) {
    const f = raw[String(i)] ?? '';
    if (known.has(f) && !used.has(f)) {
      out[String(i)] = f as ImportField;
      used.add(f);
    } else {
      out[String(i)] = '';
    }
  }
  return out;
}

/** Fills only the columns the rules left empty with a suggestion (Claude's), never overriding a rule's match. */
export function mergeSuggestion(
  kind: ImportKind,
  base: ImportMapping,
  suggestion: Record<string, string>,
): ImportMapping {
  const known = new Set<string>(IMPORT_FIELDS[kind]);
  const out = { ...base };
  const used = new Set(Object.values(out).filter(Boolean));
  for (const [col, field] of Object.entries(suggestion)) {
    if (!(col in out) || out[col] || !known.has(field) || used.has(field as ImportField)) continue;
    out[col] = field as ImportField;
    used.add(field as ImportField);
  }
  return out;
}

// ─── Reading cells ──────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * A date as Israelis write it (day first: 5/3/2018, 05.03.18), ISO (2018-03-05), or an Excel day number (43164).
 * Two-digit years up to 30 are 20xx, the rest 19xx. Anything else is null.
 */
export function parseDate(value: string): string | null {
  const v = value.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(v);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(v);
  if (m) {
    let y = Number(m[3]);
    if (m[3]!.length === 2) y += y <= 30 ? 2000 : 1900;
    return isoDate(y, Number(m[2]), Number(m[1]));
  }
  if (/^\d{4,5}$/.test(v)) {
    const serial = Number(v);
    // Excel's day 1 is 1900-01-01, counting the 1900 leap day that never was.
    if (serial < 367 || serial > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}

/** Shekels as written ("₪1,250.50", "-200", "(200)", "200-", "300 ש"ח") into agorot; blank is 0, junk is null. */
export function parseMoney(value: string): number | null {
  let v = value.replace(/[₪\s,]|ש"ח|ש״ח|nis|ils/gi, '');
  if (v === '') return 0;
  let sign = 1;
  if (/^\(.*\)$/.test(v)) {
    sign = -1;
    v = v.slice(1, -1);
  } else if (v.endsWith('-')) {
    sign = -1;
    v = v.slice(0, -1);
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(v)) return null;
  return sign * Math.round(Number(v) * 100);
}

const FEMALE = new Set(['נ', 'נקבה', 'בת', 'אישה', 'f', 'female', 'woman', 'girl']);
const MALE = new Set(['ז', 'זכר', 'בן', 'גבר', 'm', 'male', 'man', 'boy']);

/** female | male from the usual Hebrew and English words; null when blank or unclear. */
export function parseGender(value: string): 'female' | 'male' | null {
  const v = normalizeHeader(value);
  if (FEMALE.has(v)) return 'female';
  if (MALE.has(v)) return 'male';
  return null;
}

/** First word is the first name, the rest the last name ("דנה בר לב" → דנה / בר לב). */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

/** A freediving certification level 0..5 from "2", "AIDA 2", "כוכב 3", "Wave 1"; null when there is no such digit. */
export function parseDiveLevel(value: string): number | null {
  const m = /(?:^|\D)([0-5])(?:\D|$)/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

/** Employment as written: שכיר → employee, עוסק מורשה → licensed, עצמאי / פטור → exempt; blank or unknown → employee. */
export function parseEmployment(value: string): EmploymentType {
  const v = normalizeHeader(value);
  if (v.includes('מורשה') || v.includes('licensed')) return 'freelancer_licensed';
  if (v.includes('פטור') || v.includes('עצמאי') || v.includes('freelance') || v.includes('exempt')) {
    return 'freelancer_exempt';
  }
  return 'employee';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An email address, lowercased; null when it is not one. */
export function readEmail(value: string): string | null {
  return EMAIL.test(value) ? value.toLowerCase() : null;
}

/** A date that is not later than `today` (a birth date in the future is a typo). */
function notAfter(date: string | null, today: string): string | null {
  return date && date <= today ? date : null;
}

// ─── Rows into records ──────────────────────────────────────────────────────

export type IssueCode =
  | 'missingName'
  | 'noContact'
  | 'badPhone'
  | 'badEmail'
  | 'badDate'
  | 'badGender'
  | 'badMoney'
  | 'badLevel'
  | 'unknownLevel'
  | 'unknownGroup'
  | 'exists'
  | 'duplicate'
  | 'parentNameMissing'
  | 'balanceSummed'
  /** Saved, but its group did not take the child (full, age, level): set by the service. */
  | 'notPlaced';

/** error: the row is left out; warning: the row comes in, without the value named. */
export interface Issue {
  /** 1-based, as in the file (the header is row 1, so data starts at 2). */
  row: number;
  code: IssueCode;
  severity: 'error' | 'warning';
  value?: string;
}

/** What already exists, read by the service. Keys are normalized (`normalizeHeader`) names. */
export interface ImportContext {
  phones: ReadonlySet<string>;
  levels: ReadonlyMap<string, string>;
  groups: ReadonlyMap<string, string>;
  today: string;
}

export interface PlannedChild {
  row: number;
  firstName: string;
  lastName: string;
  dob: string | null;
  gender: 'female' | 'male' | null;
  levelId: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface PlannedFamily {
  rows: number[];
  displayName: string;
  parent: { firstName: string; lastName: string; phone: string | null; email: string | null };
  parent2: { firstName: string; lastName: string; phone: string | null } | null;
  children: PlannedChild[];
  balanceAgorot: number;
  notes: string | null;
}

export interface PlannedPerson {
  row: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  gender: 'female' | 'male' | null;
  certLevel: number;
  certAgency: string | null;
  certNumber: string | null;
  city: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  employmentType: EmploymentType;
  startDate: string | null;
  notes: string | null;
}

export interface ImportPlan {
  kind: ImportKind;
  families: PlannedFamily[];
  people: PlannedPerson[];
  issues: Issue[];
  /** Data rows (blank ones are not counted), rows that will come in, rows left out. */
  rows: number;
  ready: number;
  skipped: number;
  /** Records to create: families, divers or team members; and children for families. */
  records: number;
  children: number;
  balanceAgorot: number;
}

type Cells = Partial<Record<ImportField, string>>;

function cellsOf(row: readonly string[], mapping: ImportMapping): Cells {
  const out: Cells = {};
  for (const [col, field] of Object.entries(mapping)) {
    if (!field) continue;
    const v = (row[Number(col)] ?? '').trim();
    if (v) out[field] = v;
  }
  return out;
}

function nameOf(c: Cells, full: ImportField, first: ImportField, last: ImportField) {
  const split = splitName(c[full] ?? '');
  return { first: c[first] ?? split.first, last: c[last] ?? split.last };
}

/** Reads one optional cell; a value that does not parse is dropped with a warning. */
function readOptional<T>(
  raw: string | undefined,
  parse: (v: string) => T | null,
  issue: (code: IssueCode, value: string) => void,
  code: IssueCode,
): T | null {
  if (raw === undefined) return null;
  const v = parse(raw);
  if (v === null) issue(code, raw);
  return v;
}

/** Families file: one row per child (or per family), siblings found by the parent's phone, email or name. */
function planFamilies(
  rows: readonly (readonly string[])[],
  mapping: ImportMapping,
  ctx: ImportContext,
  issues: Issue[],
) {
  const families: PlannedFamily[] = [];
  const byKey = new Map<string, PlannedFamily & { balances: number[] }>();
  let dataRows = 0;
  let skipped = 0;
  rows.forEach((row, i) => {
    const n = i + 2;
    const c = cellsOf(row, mapping);
    if (Object.keys(c).length === 0) return;
    dataRows++;
    const errors: IssueCode[] = [];
    const warn = (code: IssueCode, value: string) =>
      issues.push({ row: n, code, severity: 'warning', value });
    const pastDate = (v: string) => notAfter(parseDate(v), ctx.today);
    const parentName = nameOf(c, 'parentFullName', 'parentFirstName', 'parentLastName');
    const childName = nameOf(c, 'childFullName', 'childFirstName', 'childLastName');
    if (!parentName.first && !parentName.last && !childName.first) errors.push('missingName');
    const phone = c.phone ? toE164IL(c.phone) : null;
    const email = readOptional(c.email, readEmail, warn, 'badEmail');
    if (c.phone && !phone) {
      // A wrong phone is only a warning when the family can still be reached by email.
      if (email) warn('badPhone', c.phone);
      else errors.push('badPhone');
    } else if (!phone && !email) {
      errors.push('noContact');
    }
    if (phone && ctx.phones.has(phone)) errors.push('exists');
    if (errors.length) {
      skipped++;
      for (const code of errors) {
        issues.push({ row: n, code, severity: 'error', value: code === 'badPhone' ? c.phone : undefined });
      }
      return;
    }
    const key = (phone ?? email) as string;
    let fam = byKey.get(key);
    if (!fam) {
      if (!parentName.first) warn('parentNameMissing', childName.first);
      const lastName = parentName.last || childName.last;
      const p2 = splitName(c.parent2FullName ?? '');
      const p2Phone = readOptional(c.parent2Phone, toE164IL, warn, 'badPhone');
      fam = {
        rows: [],
        displayName: lastName || parentName.first,
        parent: { firstName: parentName.first, lastName, phone, email },
        parent2:
          p2.first || p2Phone ? { firstName: p2.first, lastName: p2.last || lastName, phone: p2Phone } : null,
        children: [],
        balanceAgorot: 0,
        balances: [],
        notes: null,
      };
      byKey.set(key, fam);
      families.push(fam);
    }
    fam.rows.push(n);
    if (c.notes) fam.notes = fam.notes ? `${fam.notes}\n${c.notes}` : c.notes;
    const balance = readOptional(c.balance, parseMoney, warn, 'badMoney');
    if (balance) fam.balances.push(balance);
    if (!childName.first) return;
    if (fam.children.some((k) => k.firstName === childName.first)) {
      issues.push({ row: n, code: 'duplicate', severity: 'warning', value: childName.first });
      return;
    }
    const dob = readOptional(c.childDob, pastDate, warn, 'badDate');
    const level = c.level ? ctx.levels.get(normalizeHeader(c.level)) : undefined;
    if (c.level && !level) warn('unknownLevel', c.level);
    const group = c.group ? ctx.groups.get(normalizeHeader(c.group)) : undefined;
    if (c.group && !group) warn('unknownGroup', c.group);
    fam.children.push({
      row: n,
      firstName: childName.first,
      lastName: childName.last || fam.parent.lastName,
      dob,
      gender: readOptional(c.childGender, parseGender, warn, 'badGender'),
      levelId: level ?? null,
      groupId: group ?? null,
      groupName: group ? (c.group as string) : null,
    });
  });
  for (const fam of byKey.values()) {
    const distinct = [...new Set(fam.balances)];
    fam.balanceAgorot = distinct.reduce((a, b) => a + b, 0);
    if (distinct.length > 1) {
      issues.push({ row: fam.rows[0] as number, code: 'balanceSummed', severity: 'warning' });
    }
    delete (fam as Partial<typeof fam>).balances;
  }
  return { families, dataRows, skipped };
}

/** Divers or staff: one row per person, matched on their own phone. */
function planPeople(
  kind: 'divers' | 'staff',
  rows: readonly (readonly string[])[],
  mapping: ImportMapping,
  ctx: ImportContext,
  issues: Issue[],
) {
  const people: PlannedPerson[] = [];
  const seen = new Set<string>();
  let dataRows = 0;
  let skipped = 0;
  rows.forEach((row, i) => {
    const n = i + 2;
    const c = cellsOf(row, mapping);
    if (Object.keys(c).length === 0) return;
    dataRows++;
    const warn = (code: IssueCode, value: string) =>
      issues.push({ row: n, code, severity: 'warning', value });
    const pastDate = (v: string) => notAfter(parseDate(v), ctx.today);
    const name = nameOf(c, 'fullName', 'firstName', 'lastName');
    const phone = readOptional(c.phone, toE164IL, warn, 'badPhone');
    const fail = (code: IssueCode) => {
      skipped++;
      issues.push({ row: n, code, severity: 'error' });
    };
    if (!name.first) return fail('missingName');
    if (phone && ctx.phones.has(phone)) return fail('exists');
    const dupKey = phone ?? `${name.first} ${name.last}`;
    if (seen.has(dupKey)) return fail('duplicate');
    seen.add(dupKey);
    const email = readOptional(c.email, readEmail, warn, 'badEmail');
    const dob = readOptional(kind === 'divers' ? c.dob : undefined, pastDate, warn, 'badDate');
    people.push({
      row: n,
      firstName: name.first,
      lastName: name.last,
      phone,
      email,
      dob,
      gender: readOptional(c.gender, parseGender, warn, 'badGender'),
      certLevel: readOptional(c.certLevel, parseDiveLevel, warn, 'badLevel') ?? 0,
      certAgency: c.certAgency ?? null,
      certNumber: c.certNumber ?? null,
      city: c.city ?? null,
      emergencyName: c.emergencyName ?? null,
      emergencyPhone: readOptional(c.emergencyPhone, toE164IL, warn, 'badPhone'),
      employmentType: parseEmployment(c.employmentType ?? ''),
      startDate: readOptional(c.startDate, parseDate, warn, 'badDate'),
      notes: c.notes ?? null,
    });
  });
  return { people, dataRows, skipped };
}

/** Everything the file will become, and every problem, before anything is saved. */
export function planImport(
  kind: ImportKind,
  rows: readonly (readonly string[])[],
  mapping: ImportMapping,
  ctx: ImportContext,
): ImportPlan {
  const issues: Issue[] = [];
  if (kind === 'families') {
    const { families, dataRows, skipped } = planFamilies(rows, mapping, ctx, issues);
    return {
      kind,
      families,
      people: [],
      issues: issues.sort((a, b) => a.row - b.row),
      rows: dataRows,
      ready: dataRows - skipped,
      skipped,
      records: families.length,
      children: families.reduce((a, f) => a + f.children.length, 0),
      balanceAgorot: families.reduce((a, f) => a + f.balanceAgorot, 0),
    };
  }
  const { people, dataRows, skipped } = planPeople(kind, rows, mapping, ctx, issues);
  return {
    kind,
    families: [],
    people,
    issues: issues.sort((a, b) => a.row - b.row),
    rows: dataRows,
    ready: dataRows - skipped,
    skipped,
    records: people.length,
    children: 0,
    balanceAgorot: 0,
  };
}

/** The fields a file must map before it can be imported: a name, and for families a way to reach the parent. */
export function missingFields(kind: ImportKind, mapping: ImportMapping): ImportField[] {
  const has = new Set(Object.values(mapping));
  const any = (...f: ImportField[]) => f.some((x) => has.has(x));
  const missing: ImportField[] = [];
  if (kind === 'families') {
    if (!any('childFullName', 'childFirstName', 'parentFullName', 'parentFirstName')) {
      missing.push('childFullName');
    }
    if (!any('phone', 'email')) missing.push('phone');
  } else if (!any('fullName', 'firstName')) {
    missing.push('fullName');
  }
  return missing;
}

/** Whether an import saved at `committedAt` can still be taken back at `now`. */
export function canUndo(committedAt: Date | null, now: Date, hours: number): boolean {
  return committedAt !== null && now.getTime() - committedAt.getTime() <= hours * 3_600_000;
}
