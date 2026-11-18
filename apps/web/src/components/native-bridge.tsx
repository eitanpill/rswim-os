'use client';

import { useEffect } from 'react';
import { appLinkTarget } from '@/lib/native-app';

/**
 * The few calls the page makes into the store app's native side. The Capacitor shell injects `window.Capacitor`
 * (with a proxy for each installed plugin) into every page it loads, so the site needs no extra package: in a
 * browser `window.Capacitor` is simply missing and everything here does nothing.
 */
interface Listener {
  remove: () => Promise<void>;
}
interface CapacitorGlobal {
  isNativePlatform: () => boolean;
  Plugins: {
    App?: {
      addListener: (event: 'appUrlOpen', cb: (e: { url: string }) => void) => Promise<Listener>;
      getLaunchUrl: () => Promise<{ url?: string } | undefined>;
    };
    Share?: {
      share: (o: { title?: string; text?: string; url?: string }) => Promise<unknown>;
    };
    SplashScreen?: { hide: () => Promise<void> };
  };
}

export function nativeApp(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.isNativePlatform() ? cap : null;
}

const LAUNCH_HANDLED = 'aqua.launchUrlHandled';

function go(link: string) {
  const target = appLinkTarget(link, window.location.host);
  if (!target) return;
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (target !== here) window.location.assign(target);
}

/**
 * In the store app: a link that opens the app (a school's join link, a payment link, a link in a WhatsApp message)
 * lands on that page, whether the app was running or not; and the splash screen goes once the first page is up.
 */
export function NativeBridge() {
  useEffect(() => {
    const cap = nativeApp();
    if (!cap) return;
    void cap.Plugins.SplashScreen?.hide();
    const app = cap.Plugins.App;
    if (!app) return;
    let listener: Listener | undefined;
    void app.addListener('appUrlOpen', (e) => go(e.url)).then((l) => (listener = l));
    // A cold start from a link: the shell opened its home page, so follow the link once.
    try {
      if (!sessionStorage.getItem(LAUNCH_HANDLED)) {
        sessionStorage.setItem(LAUNCH_HANDLED, '1');
        void app.getLaunchUrl().then((r) => r?.url && go(r.url));
      }
    } catch {
      // Storage blocked: skip the launch link rather than risk following it on every page.
    }
    return () => void listener?.remove();
  }, []);
  return null;
}
