import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import he from '../../messages/he.json';

const keys = (o: object, prefix = ''): string[] =>
  Object.entries(o)
    .flatMap(([k, v]) =>
      v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    )
    .sort();

describe('message catalogs', () => {
  it('has the same keys in Hebrew and English', () => {
    expect(keys(en)).toEqual(keys(he));
  });
  it('has no empty Hebrew strings', () => {
    const flat = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : flat(v)));
    expect(flat(he).filter((s) => s.trim() === '')).toEqual([]);
  });
});
