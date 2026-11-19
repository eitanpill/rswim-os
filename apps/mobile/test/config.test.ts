import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../capacitor.config';

const file = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('the app shell', () => {
  it('loads the live site over https and tells it that it is the app', () => {
    expect(config.server?.url).toMatch(/^https:\/\/[^/]+$/);
    expect(config.appendUserAgent).toMatch(/^AquaSwimApp\//);
    expect(config.appId).toBe('il.co.aquaswim.app');
  });

  it('has its own no-connection screen', () => {
    expect(config.server?.errorPath).toBe('offline.html');
    expect(existsSync(new URL(`../www/${config.server?.errorPath}`, import.meta.url))).toBe(true);
  });

  it('keeps our hosts and the payment pages inside the app', () => {
    const allowed = config.server?.allowNavigation ?? [];
    expect(allowed).toEqual(expect.arrayContaining(['aqua-swim.co.il', '*.aqua-swim.co.il']));
    // A processor page that left the app would strand a parent outside it after paying.
    expect(allowed.some((h) => h.includes('meshulam'))).toBe(true);
  });

  it('opens the same link hosts on iPhone and Android', () => {
    const hosts = ['app.aqua-swim.co.il', 'staging.aqua-swim.co.il', '*.aqua-swim.co.il'];
    const ios = file('ios/App/App/App.entitlements');
    const android = file('android/app/src/main/AndroidManifest.xml');
    for (const h of hosts) {
      expect(ios).toContain(`applinks:${h}`);
      expect(android).toContain(`android:host="${h}"`);
    }
  });

  it('explains every phone permission it asks for', () => {
    const plist = file('ios/App/App/Info.plist');
    for (const key of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription']) {
      expect(plist).toContain(key);
    }
  });

  it('targets the Android version Google Play requires of new apps (API 36)', () => {
    expect(file('android/variables.gradle')).toMatch(/targetSdkVersion = 3[6-9]/);
  });
});
