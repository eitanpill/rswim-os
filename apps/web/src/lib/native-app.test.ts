import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NATIVE_APP_TOKEN,
  appLinkIdentity,
  appLinkTarget,
  appleAppSiteAssociation,
  assetLinks,
  isNativeApp,
} from './native-app';

describe('native app', () => {
  it('knows the app by its user agent token', () => {
    expect(isNativeApp(`Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 ${NATIVE_APP_TOKEN}/1`)).toBe(
      true,
    );
    expect(isNativeApp('Mozilla/5.0 (iPhone) Safari/604.1')).toBe(false);
    expect(isNativeApp(null)).toBe(false);
  });

  it('uses the same token the app appends', () => {
    const config = readFileSync(
      new URL('../../../mobile/capacitor.config.ts', import.meta.url),
      'utf8',
    );
    expect(config).toContain(`'${NATIVE_APP_TOKEN}`);
  });

  it('publishes nothing until the app identity is configured', () => {
    const id = appLinkIdentity({});
    expect(appleAppSiteAssociation(id).applinks.details).toEqual([]);
    expect(assetLinks(id)).toEqual([]);
  });

  it('lets every screen open in the app but never the plumbing', () => {
    const id = appLinkIdentity({
      RSWIM_IOS_APP_IDS: 'ABCDE12345.il.co.aquaswim.app',
      RSWIM_ANDROID_CERT_SHA256: 'AA:BB, CC:DD',
    });
    const [detail] = appleAppSiteAssociation(id).applinks.details;
    expect(detail?.appIDs).toEqual(['ABCDE12345.il.co.aquaswim.app']);
    expect(detail?.components.at(-1)).toEqual({ '/': '/*' });
    expect(detail?.components).toContainEqual({ '/': '/api/*', exclude: true });
    const [link] = assetLinks(id);
    expect(link?.target.package_name).toBe('il.co.aquaswim.app');
    expect(link?.target.sha256_cert_fingerprints).toEqual(['AA:BB', 'CC:DD']);
  });

  it('follows only links to our own hosts', () => {
    const here = 'app.aqua-swim.co.il';
    expect(appLinkTarget('https://app.aqua-swim.co.il/join/gal?x=1', here)).toBe('/join/gal?x=1');
    expect(appLinkTarget('https://gal.aqua-swim.co.il/pay/abc', here)).toBe(
      'https://gal.aqua-swim.co.il/pay/abc',
    );
    expect(appLinkTarget('https://evil.example/join/gal', here)).toBeNull();
    expect(appLinkTarget('http://app.aqua-swim.co.il/join/gal', here)).toBeNull();
    expect(appLinkTarget('not a url', here)).toBeNull();
  });
});
