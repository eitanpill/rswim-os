'use client';

import { Button } from '@rswim/ui';
import { nativeApp } from './native-bridge';

/**
 * Shares a link: the phone's own share sheet in the store app or a browser that has one, otherwise WhatsApp
 * (where families are). Hidden on the printed page.
 */
export function ShareButton({ label, text, url }: { label: string; text: string; url: string }) {
  async function share() {
    const cap = nativeApp();
    try {
      if (cap?.Plugins.Share) return void (await cap.Plugins.Share.share({ text, url }));
      if (typeof navigator.share === 'function') return void (await navigator.share({ text, url }));
    } catch {
      // The person closed the share sheet.
      return;
    }
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`,
      '_blank',
      'noopener',
    );
  }
  return (
    <Button variant="secondary" className="print:hidden" onClick={() => void share()}>
      {label}
    </Button>
  );
}
