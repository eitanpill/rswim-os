/** The Supabase Management API adapter, against a recorded-shape fake (never the real API in tests). */
import { describe, expect, it } from 'vitest';
import { DatabaseHostError, SupabaseManagementHost } from '../src/supabase';

type Call = { method: string; url: string; body?: unknown; auth?: string | null };

function fakeApi(routes: Record<string, (body: unknown) => { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname}`;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method: String(init.method),
      url: u.pathname,
      body,
      auth: new Headers(init.headers).get('authorization'),
    });
    const route = routes[key];
    const r = route ? route(body) : { status: 404, json: { message: 'nope' } };
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const opts = (fetchImpl: typeof fetch) => ({
  accessToken: 'sbp_test',
  organizationSlug: 'leadyourway',
  region: 'eu-central-1',
  instanceSize: 'micro',
  baseUrl: 'https://api.test',
  fetch: fetchImpl,
});

describe('SupabaseManagementHost', () => {
  it('creates a project in the organization with the sealed password', async () => {
    const api = fakeApi({
      'GET /v1/projects': () => ({ json: [] }),
      'POST /v1/projects': () => ({
        status: 201,
        json: { ref: 'abcd', region: 'eu-central-1', status: 'COMING_UP' },
      }),
    });
    const host = new SupabaseManagementHost(opts(api.fetchImpl));
    expect(await host.createDatabase({ name: 'rswim-x-1234', dbPass: 'pw' })).toEqual({
      ref: 'abcd',
      region: 'eu-central-1',
    });
    expect(api.calls[1]).toMatchObject({
      method: 'POST',
      auth: 'Bearer sbp_test',
      body: {
        name: 'rswim-x-1234',
        organization_slug: 'leadyourway',
        db_pass: 'pw',
        region: 'eu-central-1',
        desired_instance_size: 'micro',
      },
    });
  });

  it('finds a project it already created instead of making a second one', async () => {
    const api = fakeApi({
      'GET /v1/projects': () => ({
        json: [{ ref: 'old', name: 'rswim-x-1234', region: 'eu-central-1' }],
      }),
    });
    const host = new SupabaseManagementHost(opts(api.fetchImpl));
    expect(await host.createDatabase({ name: 'rswim-x-1234', dbPass: 'pw' })).toEqual({
      ref: 'old',
      region: 'eu-central-1',
    });
    expect(api.calls).toHaveLength(1);
  });

  it('reads the project status', async () => {
    let status = 'COMING_UP';
    const api = fakeApi({ 'GET /v1/projects/abcd': () => ({ json: { ref: 'abcd', status } }) });
    const host = new SupabaseManagementHost(opts(api.fetchImpl));
    expect(await host.status('abcd')).toBe('creating');
    status = 'ACTIVE_HEALTHY';
    expect(await host.status('abcd')).toBe('ready');
    status = 'INIT_FAILED';
    expect(await host.status('abcd')).toBe('failed');
  });

  it('builds a session-mode pooler URL with the password', async () => {
    const api = fakeApi({
      'GET /v1/projects/abcd/config/database/pooler': () => ({
        json: [
          {
            database_type: 'PRIMARY',
            db_user: 'postgres.abcd',
            db_host: 'aws-0-eu-central-1.pooler.supabase.com',
            db_port: 6543,
            db_name: 'postgres',
            pool_mode: 'transaction',
          },
        ],
      }),
    });
    const host = new SupabaseManagementHost(opts(api.fetchImpl));
    const url = new URL(await host.connectionUrl('abcd', 'p@ss/word'));
    expect(url.hostname).toBe('aws-0-eu-central-1.pooler.supabase.com');
    expect(url.port).toBe('5432');
    expect(url.username).toBe('postgres.abcd');
    expect(decodeURIComponent(url.password)).toBe('p@ss/word');
    expect(url.searchParams.get('sslmode')).toBe('require');
  });

  it('reports errors without echoing the project, marking rate limits as retryable', async () => {
    const api = fakeApi({
      'GET /v1/projects/abcd': () => ({ status: 429, json: { message: 'slow down' } }),
    });
    const host = new SupabaseManagementHost(opts(api.fetchImpl));
    const err = await host.status('abcd').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatabaseHostError);
    expect((err as DatabaseHostError).retryable).toBe(true);
    expect((err as Error).message).toContain('/projects/:ref');
  });

  it('deletes a project', async () => {
    const api = fakeApi({ 'DELETE /v1/projects/abcd': () => ({ json: { ref: 'abcd' } }) });
    await new SupabaseManagementHost(opts(api.fetchImpl)).deleteDatabase('abcd');
    expect(api.calls[0]?.method).toBe('DELETE');
  });
});
