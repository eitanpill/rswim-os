/**
 * A link a school sent (WhatsApp, a QR code at the pool) turned into the place in the app it leads to: a school's
 * join page or a staff invite. Anything else is refused, so the box can't be used to send people elsewhere.
 * Pure (unit tested).
 */
const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function joinPathFromLink(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  // A full link, a link without https:// (as people copy it), or just the path.
  const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : /^[^/\s]+\.[^/\s]+\//.test(raw)
      ? `https://${raw}`
      : `https://x.invalid/${raw.replace(/^\/+/, '')}`;
  let path: string;
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    path = url.pathname;
  } catch {
    return null;
  }
  const [, kind, value, ...rest] = path.split('/');
  if (rest.some((p) => p !== '') || !value) return null;
  if (kind === 'join' && SLUG.test(value.toLowerCase())) return `/join/${value.toLowerCase()}`;
  if (kind === 'invite' && TOKEN.test(value)) return `/invite/${value}`;
  return null;
}
