/**
 * A throwaway RSA key pair standing in for GHL's webhook signing key in E2E runs. It is generated on the machine
 * (never committed) and cached in the temp directory, so the Playwright config, the web server and the test
 * workers all agree on it.
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FILE = join(tmpdir(), 'rswim-e2e-ghl-webhook-key.json');

export function e2eGhlKey(): { publicKey: string; privateKey: string } {
  if (existsSync(FILE))
    return JSON.parse(readFileSync(FILE, 'utf8')) as { publicKey: string; privateKey: string };
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  writeFileSync(FILE, JSON.stringify({ publicKey, privateKey }), { mode: 0o600 });
  return { publicKey, privateKey };
}
