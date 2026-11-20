import { describe, expect, it } from 'vitest';
import {
  isSupabaseAuthCookie,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  sessionCookieOptions,
  sessionTooOld,
  signedInAt,
} from './session-policy';

const DAY = 24 * 60 * 60;

describe('sessionCookieOptions', () => {
  it('keeps people signed in for 400 days with httpOnly, Secure, Lax cookies in production', () => {
    expect(sessionCookieOptions({ NODE_ENV: 'production' })).toEqual({
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: true,
      maxAge: 400 * DAY,
    });
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(400 * DAY);
  });

  it('drops Secure for local http (dev, or an explicit opt-out for a plain-http demo)', () => {
    expect(sessionCookieOptions({ NODE_ENV: 'development' }).secure).toBe(false);
    expect(
      sessionCookieOptions({ NODE_ENV: 'production', RSWIM_INSECURE_COOKIES: '1' }).secure,
    ).toBe(false);
    expect(sessionCookieOptions({ NODE_ENV: 'development' }).httpOnly).toBe(true);
  });
});

describe('isSupabaseAuthCookie', () => {
  it.each([
    ['sb-vcibkalclwvrkubcqkei-auth-token', true],
    ['sb-vcibkalclwvrkubcqkei-auth-token.0', true],
    ['sb-vcibkalclwvrkubcqkei-auth-token.1', true],
    ['sb-127-auth-token-code-verifier', true],
    ['sb-localhost-auth-token', true],
    ['NEXT_LOCALE', false],
    ['rswim_dev', false],
    ['sb-x-other', false],
  ])('%s → %s', (name, expected) => {
    expect(isSupabaseAuthCookie(name)).toBe(expected);
  });
});

describe('signedInAt / sessionTooOld', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const ts = (daysAgo: number) => Math.floor(now.getTime() / 1000) - daysAgo * DAY;

  it('reads the earliest sign-in method time from amr', () => {
    const claims = {
      amr: [
        { method: 'password', timestamp: ts(10) },
        { method: 'otp', timestamp: ts(3) },
      ],
    };
    expect(signedInAt(claims)?.toISOString()).toBe(new Date(ts(10) * 1000).toISOString());
  });

  it('keeps a session signed in up to a year, then ends it', () => {
    expect(sessionTooOld({ amr: [{ method: 'password', timestamp: ts(1) }] }, now)).toBe(false);
    expect(sessionTooOld({ amr: [{ method: 'password', timestamp: ts(364) }] }, now)).toBe(false);
    expect(sessionTooOld({ amr: [{ method: 'password', timestamp: ts(366) }] }, now)).toBe(true);
  });

  it('never signs anyone out for a token without a usable sign-in time', () => {
    for (const claims of [
      null,
      undefined,
      'x',
      {},
      { amr: 'password' },
      { amr: [] },
      { amr: [{}] },
      { amr: [null] },
      { amr: [{ timestamp: 'x' }] },
      { amr: [{ timestamp: 0 }] },
    ])
      expect(sessionTooOld(claims, now)).toBe(false);
  });
});
