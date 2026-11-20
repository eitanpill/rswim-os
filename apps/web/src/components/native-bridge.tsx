'use client';

import { useEffect } from 'react';
import { appLinkTarget, settle } from '@/lib/native-app';

/**
 * The few calls the page makes into the store app's native side. The Capacitor shell injects `window.Capacitor`
 * (with a proxy for each installed plugin) into every page it loads, so the site needs no extra package: in a
 * browser `window.Capacitor` is simply missing and everything here does nothing.
 */
interface Listener {
  remove?: () => unknown;
}
interface CapacitorGlobal {
  isNativePlatform: () => boolean;
  Plugins: {
    App?: {
      // The injected proxy's return values differ by Capacitor version (a promise, a handle or a callback id), so
      // the bridge treats every result as unknown and never chains on it directly.
      addListener: (event: 'appUrlOpen', cb: (e: { url: string }) => void) => unknown;
      getLaunchUrl: () => unknown;
    };
    Share?: {
      share: (o: { title?: string; text?: string; url?: string }) => Promise<unknown>;
    };
    SplashScreen?: { hide: () => unknown };
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
    void settle(() => cap.Plugins.SplashScreen?.hide());
    const app = cap.Plugins.App;
    if (!app) return;
    let listener: Listener | undefined;
    let gone = false;
    void settle<Listener>(() => app.addListener('appUrlOpen', (e) => go(e.url))).then((l) => {
      if (l && typeof l === 'object') listener = l;
      if (gone) void settle(() => listener?.remove?.());
    });
    // A cold start from a link: the shell opened its home page, so follow the link once.
    try {
      if (!sessionStorage.getItem(LAUNCH_HANDLED)) {
        sessionStorage.setItem(LAUNCH_HANDLED, '1');
        void settle<{ url?: string }>(() => app.getLaunchUrl()).then((r) => {
          if (typeof r?.url === 'string') go(r.url);
        });
      }
    } catch {
      // Storage blocked: skip the launch link rather than risk following it on every page.
    }
    return () => {
      gone = true;
      void settle(() => listener?.remove?.());
    };
  }, []);
  return null;
}
