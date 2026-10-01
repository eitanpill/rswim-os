import { getTranslations } from 'next-intl/server';
import { Card, EmptyState, PageHeader } from '@rswim/ui';
import { TodayLine } from '@/components/today-card';

/** Instructor PWA "My day" (brief §6.8). Lineups and offline attendance arrive in Phase 3. */
export default async function InstructorDay() {
  const t = await getTranslations('instructor.home');
  return (
    <>
      <PageHeader title={t('title')} subtitle={<TodayLine />} />
      <Card>
        <EmptyState title={t('empty')}>{t('emptyHint')}</EmptyState>
      </Card>
    </>
  );
}
