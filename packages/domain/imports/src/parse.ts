/**
 * Reading the uploaded file into a table of strings: Excel (.xlsx), CSV in UTF-8 or the Windows Hebrew encoding that
 * Excel still saves, with commas, semicolons or tabs, and a Google sheet shared by link (read as CSV).
 */
import ExcelJS from 'exceljs';
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from '@rswim/contracts';
import { DomainError } from '@rswim/domain-core';

export interface Table {
  headers: string[];
  rows: string[][];
}

/** UTF-8 when it is valid UTF-8, otherwise Windows-1255 (Hebrew Excel's "CSV"). A BOM is dropped. */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1255').decode(bytes);
  }
  return text.replace(/^\uFEFF/, '');
}

/** The separator the first line uses most: comma, semicolon or tab. */
function separatorOf(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((s) => [s, first.split(s).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return (counts[0] as readonly [string, number])[0];
}

/** RFC 4180 CSV: quoted fields may hold separators, line breaks and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const sep = separatorOf(text);
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return String(value.text);
    if ('error' in value) return '';
    return '';
  }
  return String(value);
}

/** The first worksheet of an .xlsx file, as strings (dates as YYYY-MM-DD). */
export async function parseXlsx(bytes: Uint8Array): Promise<string[][]> {
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  } catch {
    throw new DomainError('imports.errors.unreadable');
  }
  const sheet = book.worksheets[0];
  if (!sheet) return [];
  const out: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cellText(cell.value).trim();
    });
    out[n - 1] = Array.from(cells, (c) => c ?? '');
  });
  return Array.from(out, (r) => r ?? []);
}

/**
 * Rows into a table: the first row with text is the header row, empty rows and empty trailing columns go, and a file
 * too long for one import is refused.
 */
export function toTable(raw: string[][]): Table {
  const rows = raw.map((r) => r.map((c) => (c ?? '').trim()));
  const start = rows.findIndex((r) => r.some(Boolean));
  if (start < 0) throw new DomainError('imports.errors.empty');
  const body = rows.slice(start + 1).filter((r) => r.some(Boolean));
  if (body.length === 0) throw new DomainError('imports.errors.empty');
  if (body.length > IMPORT_MAX_ROWS) {
    throw new DomainError('imports.errors.tooManyRows', { max: IMPORT_MAX_ROWS });
  }
  const header = rows[start] as string[];
  const width = Math.max(
    ...[header, ...body].map((r) => {
      let w = r.length;
      while (w > 0 && !r[w - 1]) w--;
      return w;
    }),
  );
  const headers = Array.from({ length: width }, (_, i) => header[i] || `#${i + 1}`);
  return { headers, rows: body.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')) };
}

/** Reads an uploaded file by its name: .xlsx, or anything else as CSV text. */
export async function readTable(fileName: string, bytes: Uint8Array): Promise<Table> {
  if (/\.xlsx$/i.test(fileName)) return toTable(await parseXlsx(bytes));
  if (/\.(xls|numbers|ods)$/i.test(fileName)) throw new DomainError('imports.errors.format');
  return toTable(parseCsv(decodeText(bytes)));
}

/**
 * A Google Sheets share link into its CSV export address (the sheet must be shared "anyone with the link"). Only
 * docs.google.com spreadsheet links are accepted; anything else is null.
 */
export function sheetsCsvUrl(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null;
  const m = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(u.pathname);
  if (!m) return null;
  const gid = /gid=(\d+)/.exec(u.hash + u.search)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

/** Downloads a shared Google sheet as CSV. A sheet that is not shared by link answers with a sign-in page. */
export async function fetchSheet(link: string, fetchImpl: typeof fetch = fetch): Promise<Table> {
  const url = sheetsCsvUrl(link);
  if (!url) throw new DomainError('imports.errors.sheetLink');
  let res: Response;
  try {
    res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new DomainError('imports.errors.sheetPrivate');
  }
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) {
    throw new DomainError('imports.errors.sheetPrivate');
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > IMPORT_MAX_BYTES) throw new DomainError('imports.errors.tooLarge');
  return toTable(parseCsv(decodeText(bytes)));
}
