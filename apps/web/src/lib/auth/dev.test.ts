import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDevAuthEnabled, readDevCookie, signupCookieValue, signupUserId } from './dev';

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

describe('a new owner without Supabase (fake sign-up)', () => {
  const user = '0b8f7c1e-2f55-4f0a-9d7e-5a1c3b2d4e6f';
  const org = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

  it('signs in as that user with no school, then as owner of the business they opened', () => {
    vi.stubEnv('RSWIM_DEV_AUTH', '1');
    expect(readDevCookie(signupCookieValue(user))).toMatchObject({
      userId: user,
      orgId: null,
      role: null,
    });
    expect(readDevCookie(signupCookieValue(user, org, 'freediving'))).toMatchObject({
      userId: user,
      orgId: org,
      role: 'owner',
      vertical: 'freediving',
    });
    expect(signupUserId(signupCookieValue(user, org))).toBe(user);
  });

  it('refuses malformed values, and everything outside persona sign-in', () => {
    vi.stubEnv('RSWIM_DEV_AUTH', '1');
    expect(readDevCookie('signup.not-a-uuid')).toBeNull();
    expect(readDevCookie(`signup.${user}@${org}@surfing`)).toBeNull();
    expect(readDevCookie(`signup.${user}@nope`)).toBeNull();
    expect(readDevCookie(`signup.${user}@${org}@swim@x`)).toBeNull();
    vi.stubEnv('RSWIM_ENV', 'production');
    expect(readDevCookie(signupCookieValue(user))).toBeNull();
  });
});
