import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@rswim/ui';
import { WhatsAppConnection } from '@/components/whatsapp/view';
import { requireSurface } from '@/lib/auth/session';

/** A swim school's own WhatsApp number: connecting it and going live (WhatsApp track W5 and W10). */
export default async function WhatsAppPage() {
  const session = await requireSurface('admin');
  const t = await getTranslations('whatsapp');
  return (
    <WhatsAppConnection
      owner={session.role === 'owner'}
      header={<PageHeader icon="💬" title={t('title')} subtitle={t('subtitle')} />}
    />
  );
}
