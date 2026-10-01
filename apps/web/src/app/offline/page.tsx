import { getTranslations } from 'next-intl/server';

export default async function OfflinePage() {
  const t = await getTranslations('common');
  return <main className="mx-auto max-w-md px-4 py-16 text-center text-lg">{t('offline')}</main>;
}
