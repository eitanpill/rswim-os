import { getTranslations } from 'next-intl/server';
import { Card, CardTitle, EmptyState, Money, PageHeader } from '@rswim/ui';
import { agorot } from '@rswim/money';
import { TodayLine } from '@/components/today-card';

/** Owner "Command Center" (brief §6.1). Phase 0: the frame; data arrives with Phases 2–4. */
export default async function CommandCenter() {
  const t = await getTranslations('admin.home');
  const tc = await getTranslations('common');
  return (
    <>
      <PageHeader title={t('title')} subtitle={<TodayLine />} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>{t('today')}</CardTitle>
          <EmptyState title={t('todayEmpty')}>{tc('comingSoon')}</EmptyState>
        </Card>
        <Card>
          <CardTitle>{t('needsYou')}</CardTitle>
          <EmptyState title={t('needsYouEmpty')} />
        </Card>
        <Card>
          <CardTitle>{t('money')}</CardTitle>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-sm text-ink-muted">{t('expected')}</dt>
              <dd className="text-xl font-semibold">
                <Money agorot={agorot(0)} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">{t('collected')}</dt>
              <dd className="text-xl font-semibold">
                <Money agorot={agorot(0)} />
              </dd>
            </div>
          </dl>
        </Card>
        <Card>
          <CardTitle>{t('growth')}</CardTitle>
          <EmptyState title={tc('comingSoon')} />
        </Card>
      </div>
    </>
  );
}
