import { getTranslations } from 'next-intl/server';
import { GhlConnectionView } from '@/components/ghl/connection';
import { requireDivePage } from '../_ui/access';
import { Hero } from '../_ui/kit';

/** A freediving club's own GHL sub-account: connecting it and seeing what it holds (feature A1). */
export default async function DiveGhlPage() {
  const { role } = await requireDivePage('ghl');
  const t = await getTranslations('ghlConnection');
  return (
    <div className="flex flex-col gap-5" data-testid="dive-ghl">
      <Hero kicker={t('kickerDive')} title={t('title')} sub={t('subtitle')} />
      <GhlConnectionView owner={role === 'owner'} whatsappHref="/dive/whatsapp" />
    </div>
  );
}
