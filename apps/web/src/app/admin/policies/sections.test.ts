import { describe, expect, it } from 'vitest';
import { policyFields } from '@rswim/contracts';
import { SECTION_ORDER } from './sections';

describe('policy sections', () => {
  it('shows every policy field on the policies screen', () => {
    const sections = new Set(policyFields().map((f) => f.path.split('.')[0]));
    expect([...sections].filter((s) => !(SECTION_ORDER as readonly string[]).includes(s!))).toEqual(
      [],
    );
  });
});
