import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDevAuthEnabled } from './dev';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('persona sign-in', () => {
  it('is on locally with RSWIM_DEV_AUTH=1 and on the live demo', () => {
    vi.stubEnv('RSWIM_DEV_AUTH', '1');
    expect(isDevAuthEnabled()).toBe(true);
    vi.stubEnv('RSWIM_DEV_AUTH', '');
    vi.stubEnv('RSWIM_DEMO_MODE', '1');
    expect(isDevAuthEnabled()).toBe(true);
  });

  it('is never on in staging or production, even when the dev or demo switch is set by mistake', () => {
    vi.stubEnv('RSWIM_DEV_AUTH', '1');
    vi.stubEnv('RSWIM_DEMO_MODE', '1');
    for (const env of ['staging', 'production']) {
      vi.stubEnv('RSWIM_ENV', env);
      expect(isDevAuthEnabled()).toBe(false);
    }
  });

  it('is off on a Vercel production deployment', () => {
    vi.stubEnv('RSWIM_DEV_AUTH', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(isDevAuthEnabled()).toBe(false);
  });
});
