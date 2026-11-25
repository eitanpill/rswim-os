import { describe, expect, it } from 'vitest';
import { productionEnvProblems } from '../src/deployment';

const worker = {
  RSWIM_ENV: 'production',
  DATABASE_URL: 'postgresql://x',
  RSWIM_MASTER_KEY: 'k',
  RSWIM_PLATFORM_HOSTS: 'app.aqua-swim.co.il',
  RSWIM_PUBLIC_URL: 'https://app.aqua-swim.co.il',
  INNGEST_EVENT_KEY: 'e',
  INNGEST_SIGNING_KEY: 's',
};

const web = {
  RSWIM_ENV: 'production',
  DATABASE_URL: 'postgresql://x',
  RSWIM_MASTER_KEY: 'k',
  RSWIM_PLATFORM_HOSTS: 'app.aqua-swim.co.il',
  NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a',
  SUPABASE_SERVICE_ROLE_KEY: 'r',
};

describe('productionEnvProblems', () => {
  it('checks nothing outside production', () => {
    expect(productionEnvProblems('worker', { RSWIM_ENV: 'staging', RSWIM_GROW_FAKE: '1' })).toEqual(
      [],
    );
    expect(productionEnvProblems('web', {})).toEqual([]);
  });

  it('accepts a complete production environment', () => {
    expect(productionEnvProblems('worker', worker)).toEqual([]);
    expect(productionEnvProblems('web', web)).toEqual([]);
  });

  it('names missing variables, never values', () => {
    expect(productionEnvProblems('worker', { ...worker, INNGEST_SIGNING_KEY: '' })).toEqual([
      'INNGEST_SIGNING_KEY is not set',
    ]);
    expect(productionEnvProblems('web', { RSWIM_ENV: 'production' })).toHaveLength(6);
  });

  it('refuses fakes, demo and dev switches', () => {
    const problems = productionEnvProblems('worker', {
      ...worker,
      RSWIM_MESSAGING_FAKE: '1',
      RSWIM_GROW_FAKE: 'true',
      RSWIM_DEMO_MODE: '1',
      RSWIM_DEV_AUTH: '1',
      INNGEST_DEV: '1',
    });
    expect(problems).toEqual([
      'INNGEST_DEV must not be set in production',
      'RSWIM_DEMO_MODE must not be set in production',
      'RSWIM_DEV_AUTH must not be set in production',
      'RSWIM_GROW_FAKE must not be set in production',
      'RSWIM_MESSAGING_FAKE must not be set in production',
    ]);
  });

  it('lets a switch that is explicitly off through', () => {
    expect(
      productionEnvProblems('worker', {
        ...worker,
        RSWIM_GROW_FAKE: '0',
        RSWIM_FILES_FAKE: '',
        RSWIM_DEMO_MODE: 'false',
        RSWIM_SKIP_RELEASE: '1',
      }),
    ).toEqual([]);
  });

  it('wants message links over https', () => {
    expect(
      productionEnvProblems('worker', {
        ...worker,
        RSWIM_PUBLIC_URL: 'http://app.aqua-swim.co.il',
      }),
    ).toEqual(['RSWIM_PUBLIC_URL must start with https://']);
  });
});
