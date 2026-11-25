/**
 * Push notifications to the store app (store launch, stage 6): FCM HTTP v1 for Android, APNs for the iPhone, and an
 * in-memory fake for tests and demos (`RSWIM_PUSH_FAKE=1`). The dispatcher sends a family's message here first and
 * falls back to WhatsApp, so a provider throws on any failure and throws `PushTokenGone` when the platform says the
 * token no longer reaches a phone (the app was removed, or the person turned notifications off for good).
 * Written against Google's and Apple's public API descriptions (2026-11); not yet exercised against a real device.
 */
import { createHash, createSign, sign as signData } from 'node:crypto';
import { connect, type ClientHttp2Session } from 'node:http2';
import type { PushPlatform } from '@rswim/contracts';

export interface PushTarget {
  platform: PushPlatform;
  token: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** The page the app opens when the person taps the notification. */
  url?: string;
}

export interface PushProvider {
  supports(platform: PushPlatform): boolean;
  send(target: PushTarget, message: PushMessage): Promise<{ id: string }>;
}

/** The platform says this token reaches no phone any more: forget it. */
export class PushTokenGone extends Error {
  constructor(readonly platform: PushPlatform) {
    super(`push token no longer valid (${platform})`);
    this.name = 'PushTokenGone';
  }
}

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');
const short = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** A fake: remembers what it sent; a token containing "dead" is gone, one containing "fail" fails. */
export class FakePushProvider implements PushProvider {
  readonly sent: { target: PushTarget; message: PushMessage }[] = [];
  supports() {
    return true;
  }
  async send(target: PushTarget, message: PushMessage) {
    if (target.token.includes('dead')) throw new PushTokenGone(target.platform);
    if (target.token.includes('fail')) throw new Error('fake push: platform unavailable');
    this.sent.push({ target, message });
    return { id: `fake_push_${short(`${target.token}:${this.sent.length}`)}` };
  }
}

export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Firebase Cloud Messaging (HTTP v1), signed in with a Google service account's key. Android only here. */
export class FcmPushProvider implements PushProvider {
  private token: { value: string; until: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly account: FcmServiceAccount,
    opts: { fetch?: typeof fetch; now?: () => number } = {},
  ) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  supports(platform: PushPlatform) {
    return platform === 'android';
  }

  private async accessToken(): Promise<string> {
    const now = this.now();
    if (this.token && this.token.until > now) return this.token.value;
    const iat = Math.floor(now / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat,
        exp: iat + 3600,
      }),
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${head}.${claims}`);
    const jwt = `${head}.${claims}.${b64url(signer.sign(this.account.private_key))}`;
    const res = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!res.ok || !body.access_token) throw new Error(`fcm sign-in failed (${res.status})`);
    // Renewed five minutes before Google's expiry.
    this.token = {
      value: body.access_token,
      until: now + ((body.expires_in ?? 3600) - 300) * 1000,
    };
    return body.access_token;
  }

  async send(target: PushTarget, message: PushMessage) {
    const res = await this.fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: target.token,
            notification: { title: message.title, body: message.body },
            data: message.url ? { url: message.url } : {},
            android: { priority: 'high', notification: { sound: 'default' } },
          },
        }),
      },
    );
    const text = await res.text();
    if (res.ok) return { id: (JSON.parse(text) as { name: string }).name };
    // FCM says UNREGISTERED (404) for a removed app, and INVALID_ARGUMENT for a token that was never valid.
    if (res.status === 404 || /UNREGISTERED|registration token is not a valid/i.test(text))
      throw new PushTokenGone('android');
    throw new Error(`fcm ${res.status}: ${text.slice(0, 300)}`);
  }
}

export interface ApnsOptions {
  /** The .p8 key's whole text (Apple Developer → Keys, with Apple Push Notifications service). */
  keyP8: string;
  keyId: string;
  teamId: string;
  /** The app's bundle id. */
  topic: string;
  /** Xcode builds run from a cable use the sandbox; TestFlight and the App Store use production. */
  sandbox?: boolean;
  /** For tests: one HTTP/2 request. */
  request?: (
    path: string,
    headers: Record<string, string>,
    body: string,
  ) => Promise<{ status: number; body: string; id?: string }>;
  now?: () => number;
}

/** Apple Push Notification service over HTTP/2, with a token (.p8) key. iPhone only. */
export class ApnsPushProvider implements PushProvider {
  private jwt: { value: string; until: number } | null = null;
  private session: ClientHttp2Session | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: ApnsOptions) {
    this.now = opts.now ?? Date.now;
  }

  supports(platform: PushPlatform) {
    return platform === 'ios';
  }

  /** Apple wants the token renewed at most every 60 minutes and at least every 20. */
  private bearer(): string {
    const now = this.now();
    if (this.jwt && this.jwt.until > now) return this.jwt.value;
    const head = b64url(JSON.stringify({ alg: 'ES256', kid: this.opts.keyId }));
    const claims = b64url(JSON.stringify({ iss: this.opts.teamId, iat: Math.floor(now / 1000) }));
    const sig = signData('sha256', Buffer.from(`${head}.${claims}`), {
      key: this.opts.keyP8,
      dsaEncoding: 'ieee-p1363',
    });
    this.jwt = { value: `${head}.${claims}.${b64url(sig)}`, until: now + 40 * 60_000 };
    return this.jwt.value;
  }

  /* c8 ignore start -- the real HTTP/2 connection to Apple; tests pass `request` */
  private http2(path: string, headers: Record<string, string>, body: string) {
    const host = this.opts.sandbox
      ? 'https://api.sandbox.push.apple.com'
      : 'https://api.push.apple.com';
    if (!this.session || this.session.closed || this.session.destroyed) {
      this.session = connect(host);
      this.session.on('error', () => {
        this.session = null;
      });
      this.session.unref();
    }
    const session = this.session;
    return new Promise<{ status: number; body: string; id?: string }>((resolve, reject) => {
      const req = session.request({ ':method': 'POST', ':path': path, ...headers });
      let status = 0;
      let id: string | undefined;
      let data = '';
      req.setEncoding('utf8');
      req.on('response', (h) => {
        status = Number(h[':status']);
        id = typeof h['apns-id'] === 'string' ? h['apns-id'] : undefined;
      });
      req.on('data', (chunk: string) => (data += chunk));
      req.on('end', () => resolve({ status, body: data, id }));
      req.on('error', reject);
      req.setTimeout(15_000, () => req.close());
      req.end(body);
    });
  }
  /* c8 ignore stop */

  async send(target: PushTarget, message: PushMessage) {
    /* c8 ignore next -- the real connection; tests pass `request` */
    const request = this.opts.request ?? ((p, h, b) => this.http2(p, h, b));
    const res = await request(
      `/3/device/${target.token}`,
      {
        authorization: `bearer ${this.bearer()}`,
        'apns-topic': this.opts.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      JSON.stringify({
        aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
        ...(message.url ? { url: message.url } : {}),
      }),
    );
    if (res.status === 200) return { id: res.id ?? 'apns' };
    // 410: the token is no longer active; 400 BadDeviceToken: it never was (or belongs to the other environment).
    if (res.status === 410 || /BadDeviceToken|Unregistered/.test(res.body))
      throw new PushTokenGone('ios');
    throw new Error(`apns ${res.status}: ${res.body.slice(0, 300)}`);
  }
}

/** One provider for both platforms; a platform with no provider is not supported (the message goes by WhatsApp). */
export class PlatformPushProvider implements PushProvider {
  constructor(private readonly providers: PushProvider[]) {}
  supports(platform: PushPlatform) {
    return this.providers.some((p) => p.supports(platform));
  }
  async send(target: PushTarget, message: PushMessage) {
    const p = this.providers.find((x) => x.supports(target.platform));
    if (!p) throw new Error(`no push provider for ${target.platform}`);
    return p.send(target, message);
  }
}
