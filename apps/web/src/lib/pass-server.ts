import 'server-only';
import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { parseMasterKey } from '@rswim/domain-core';

/** The master key, or null when this deployment has none (the pass then shows without a code). */
export function passMasterKey(): Buffer | null {
  try {
    return parseMasterKey(process.env.RSWIM_MASTER_KEY);
  } catch {
    return null;
  }
}

/** The public URL that checks a pass, as an SVG QR code. */
export async function passQr(token: string): Promise<{ url: string; svg: string }> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const url = `${proto}://${host}/pass/${token}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { url, svg };
}
