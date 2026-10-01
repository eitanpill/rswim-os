import { getTranslations } from 'next-intl/server';
import { Button, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';

/** Parent portal home (brief §6.13). Real data arrives in Phase 7; actions are shown disabled until then. */
export default async function ParentHome() {
  const t = await getTranslations('parent.home');
  const tc = await getTranslations('common');
  return (
    <>
      <PageHeader title={t('title')} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>{t('nextLesson')}</CardTitle>
          <EmptyState title={t('nextLessonEmpty')} />
        </Card>
        <Card>
          <CardTitle>{t('actions')}</CardTitle>
          <div className="flex flex-col gap-2">
            {(['reportAbsence', 'bookMakeup', 'payments'] as const).map((k) => (
              <Button key={k} variant="secondary" size="full" disabled title={tc('comingSoon')}>
                {t(k)}
              </Button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
