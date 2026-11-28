import { getTranslations } from 'next-intl/server';
import { WhatsAppConnection } from '@/components/whatsapp/view';
import { requireDivePage } from '../_ui/access';
import { Hero } from '../_ui/kit';

/** A freediving club's own WhatsApp number: connecting it and going live (WhatsApp track W5 and W10). */
export default async function DiveWhatsAppPage() {
  const { role } = await requireDivePage('whatsapp');
  const t = await getTranslations('whatsapp');
  return (
    <div className="flex flex-col gap-5" data-testid="dive-whatsapp">
      <WhatsAppConnection
        owner={role === 'owner'}
        ghlHref="/dive/ghl"
        header={<Hero kicker={t('kickerDive')} title={t('title')} sub={t('subtitle')} />}
      />
    </div>
  );
}
