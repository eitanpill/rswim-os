import { describe, expect, it } from 'vitest';
import { HEADER_SYNONYMS, IMPORT_FIELDS, IMPORT_KINDS, normalizeHeader } from '../src/imports';

describe('import headers', () => {
  it('compares headers without punctuation, niqqud, quotes or extra spaces', () => {
    expect(normalizeHeader(' שם  האמא: ')).toBe('שם האמא');
    expect(normalizeHeader('ת"ז')).toBe('תז');
    expect(normalizeHeader('שֵׁם')).toBe('שם');
    expect(normalizeHeader('Phone #')).toBe('phone');
    expect(normalizeHeader('תאריך/לידה')).toBe('תאריך/לידה');
  });

  it('names only fields of their own kind', () => {
    for (const kind of IMPORT_KINDS) {
      for (const field of Object.keys(HEADER_SYNONYMS[kind])) {
        expect(IMPORT_FIELDS[kind]).toContain(field);
      }
    }
  });
});
