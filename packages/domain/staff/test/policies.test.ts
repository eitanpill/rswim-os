import { describe, expect, it } from 'vitest';
import { certificationStatus } from '../src/policies';

describe('certificationStatus', () => {
  it('is valid without an expiry or far from it, expiring within 60 days, expired after', () => {
    expect(certificationStatus(null, '2026-10-02')).toBe('valid');
    expect(certificationStatus('2027-06-30', '2026-10-02')).toBe('valid');
    expect(certificationStatus('2026-12-01', '2026-10-02')).toBe('expiring');
    expect(certificationStatus('2026-10-02', '2026-10-02')).toBe('expiring');
    expect(certificationStatus('2026-10-01', '2026-10-02')).toBe('expired');
  });
});
