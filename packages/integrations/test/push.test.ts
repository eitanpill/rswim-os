import { generateKeyPairSync, createVerify, verify, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ApnsPushProvider,
  FakePushProvider,
  FcmPushProvider,
  PlatformPushProvider,
  PushTokenGone,
} from '../src';

const msg = { title: 'בית הספר', body: 'השיעור מחר בוטל', url: '/parent' };
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = (k: KeyObject) => k.export({ type: 'pkcs8', format: 'pem' }).toString();
const parts = (jwt: string) => jwt.split('.');
const json = (b64: string) =>
  JSON.parse(Buffer.from(b64, 'base64url').toString()) as Record<string, unknown>;

describe('FakePushProvider', () => {
  it('sends, says a dead token is gone, and fails on demand', async () => {
    const p = new FakePushProvider();
    expect(p.supports()).toBe(true);
    expect((await p.send({ platform: 'ios', token: 'abc' }, msg)).id).toMatch(/^fake_push_/);
    expect(p.sent).toHaveLength(1);
    await expect(p.send({ platform: 'android', token: 'dead-1' }, msg)).rejects.toBeInstanceOf(
      PushTokenGone,
    );
    await expect(p.send({ platform: 'android', token: 'fail-1' }, msg)).rejects.toThrow(
      'fake push',
    );
  });
});

describe('FcmPushProvider', () => {
  const account = {
    project_id: 'aqua-test',
    client_email: 'push@aqua-test.iam.gserviceaccount.com',
    private_key: pem(rsa.privateKey),
  };

  it('signs in once with a signed JWT and sends the notification', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const replies = [
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
      new Response(JSON.stringify({ name: 'projects/aqua-test/messages/1' })),
      new Response(JSON.stringify({ name: 'projects/aqua-test/messages/2' })),
    ];
    const p = new FcmPushProvider(account, {
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return replies.shift() as Response;
      }) as unknown as typeof fetch,
      now: () => 1_800_000_000_000,
    });
    expect(p.supports('android')).toBe(true);
    expect(p.supports('ios')).toBe(false);
    expect(await p.send({ platform: 'android', token: 't1' }, msg)).toEqual({
      id: 'projects/aqua-test/messages/1',
    });
    await p.send({ platform: 'android', token: 't2' }, { title: 'a', body: 'b' });
    expect(calls).toHaveLength(3);
    const assertion = new URLSearchParams(calls[0]?.init.body as string).get('assertion') as string;
    const [h, c, s] = parts(assertion);
    const v = createVerify('RSA-SHA256');
    v.update(`${h}.${c}`);
    expect(v.verify(rsa.publicKey, Buffer.from(s as string, 'base64url'))).toBe(true);
    expect(json(c as string)).toMatchObject({ iss: account.client_email, iat: 1_800_000_000 });
    expect(calls[1]?.url).toBe('https://fcm.googleapis.com/v1/projects/aqua-test/messages:send');
    expect((calls[1]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[1]?.init.body as string)).toMatchObject({
      message: {
        token: 't1',
        notification: { title: msg.title, body: msg.body },
        data: { url: '/parent' },
      },
    });
    expect(JSON.parse(calls[2]?.init.body as string).message.data).toEqual({});
  });

  it('tells a gone token from a failure, and a failed sign-in', async () => {
    const make = (...replies: Response[]) =>
      new FcmPushProvider(account, {
        fetch: (async () => replies.shift() as Response) as unknown as typeof fetch,
      });
    const ok = () => new Response(JSON.stringify({ access_token: 'tok' }));
    await expect(
      make(ok(), new Response('{"error":{"status":"NOT_FOUND"}}', { status: 404 })).send(
        { platform: 'android', token: 'x' },
        msg,
      ),
    ).rejects.toBeInstanceOf(PushTokenGone);
    await expect(
      make(
        ok(),
        new Response('{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}', { status: 400 }),
      ).send({ platform: 'android', token: 'x' }, msg),
    ).rejects.toBeInstanceOf(PushTokenGone);
    await expect(
      make(ok(), new Response('quota', { status: 429 })).send(
        { platform: 'android', token: 'x' },
        msg,
      ),
    ).rejects.toThrow('fcm 429');
    await expect(
      make(new Response('{}', { status: 401 })).send({ platform: 'android', token: 'x' }, msg),
    ).rejects.toThrow('fcm sign-in failed (401)');
  });
});

describe('ApnsPushProvider', () => {
  const base = {
    keyP8: pem(ec.privateKey),
    keyId: 'KEY123',
    teamId: '6ZNNQLACFA',
    topic: 'il.co.aquaswim.app',
  };

  it('sends with a signed token, reused until it ages', async () => {
    const seen: { path: string; headers: Record<string, string>; body: string }[] = [];
    let now = 1_800_000_000_000;
    const p = new ApnsPushProvider({
      ...base,
      now: () => now,
      request: async (path, headers, body) => {
        seen.push({ path, headers, body });
        return { status: 200, body: '', id: seen.length === 1 ? 'apns-1' : undefined };
      },
    });
    expect(p.supports('ios')).toBe(true);
    expect(p.supports('android')).toBe(false);
    expect(await p.send({ platform: 'ios', token: 'abc' }, msg)).toEqual({ id: 'apns-1' });
    expect(await p.send({ platform: 'ios', token: 'abc' }, { title: 'a', body: 'b' })).toEqual({
      id: 'apns',
    });
    now += 41 * 60_000;
    await p.send({ platform: 'ios', token: 'abc' }, msg);
    expect(seen[0]?.path).toBe('/3/device/abc');
    expect(seen[0]?.headers['apns-topic']).toBe('il.co.aquaswim.app');
    expect(seen[0]?.headers.authorization).toBe(seen[1]?.headers.authorization);
    expect(seen[2]?.headers.authorization).not.toBe(seen[0]?.headers.authorization);
    const [h, c, s] = parts((seen[0]?.headers.authorization as string).slice('bearer '.length));
    expect(json(h as string)).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(
      verify(
        'sha256',
        Buffer.from(`${h}.${c}`),
        { key: ec.publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(s as string, 'base64url'),
      ),
    ).toBe(true);
    expect(JSON.parse(seen[0]?.body as string)).toEqual({
      aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' },
      url: '/parent',
    });
    expect(JSON.parse(seen[1]?.body as string).url).toBeUndefined();
  });

  it('tells a gone token from a failure', async () => {
    const reply = (status: number, body = '') =>
      new ApnsPushProvider({ ...base, request: async () => ({ status, body }) });
    await expect(reply(410).send({ platform: 'ios', token: 'x' }, msg)).rejects.toBeInstanceOf(
      PushTokenGone,
    );
    await expect(
      reply(400, '{"reason":"BadDeviceToken"}').send({ platform: 'ios', token: 'x' }, msg),
    ).rejects.toBeInstanceOf(PushTokenGone);
    await expect(reply(500, 'oops').send({ platform: 'ios', token: 'x' }, msg)).rejects.toThrow(
      'apns 500',
    );
  });
});

describe('PlatformPushProvider', () => {
  it('routes by platform and supports only what it has', async () => {
    const android = new FakePushProvider();
    const only = {
      supports: (p: string) => p === 'android',
      send: android.send.bind(android),
    };
    const p = new PlatformPushProvider([only]);
    expect(p.supports('android')).toBe(true);
    expect(p.supports('ios')).toBe(false);
    await p.send({ platform: 'android', token: 'a' }, msg);
    expect(android.sent).toHaveLength(1);
    await expect(p.send({ platform: 'ios', token: 'a' }, msg)).rejects.toThrow(
      'no push provider for ios',
    );
  });
});

describe('defaults', () => {
  it('builds with the real clock, fetch and HTTP/2 when nothing is passed', () => {
    expect(
      new FcmPushProvider({ project_id: 'p', client_email: 'e', private_key: 'k' }).supports(
        'android',
      ),
    ).toBe(true);
    expect(
      new ApnsPushProvider({
        keyP8: 'k',
        keyId: 'i',
        teamId: 't',
        topic: 'x',
        sandbox: true,
      }).supports('ios'),
    ).toBe(true);
  });
});
