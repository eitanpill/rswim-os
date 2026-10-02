'use client';

import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

export function OfflineBanner() {
  const t = useTranslations('common');
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <div role="status" className="bg-warn px-4 py-2 text-center text-sm font-medium text-ink">
      {t('offline')}
    </div>
  );
}
