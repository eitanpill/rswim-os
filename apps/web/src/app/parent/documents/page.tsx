import { getTranslations } from 'next-intl/server';
import { Card, CardTitle, PageHeader } from '@rswim/ui';
import { FormsDue } from '@/components/forms-due';
import { withSession } from '@/lib/db';
import { parentAcceptFormAction } from '../actions';
import { myHousehold } from '../family';
import { formsDueFor } from '@rswim/domain-enrollment';

/** The regulations and forms the family still has to accept, each with its full text. */
export default async function ParentDocuments() {
  const t = await getTranslations('parent.documents');
  const data = await withSession(async (tx) => {
    const family = await myHousehold(tx);
    return family ? { family, forms: await formsDueFor(tx, family.household.id) } : null;
  });

  return (
    <>
      <PageHeader title={t('title')} />
      <Card data-testid="parent-forms">
        <CardTitle>{t('due')}</CardTitle>
        {!data || data.forms.due.length === 0 ? (
          <p className="text-ok">{t('allDone')}</p>
        ) : (
          <FormsDue
            due={data.forms.due}
            current={data.forms.current}
            householdId={data.family.household.id}
            studentName={(id) => data.family.students.find((s) => s.id === id)?.firstName ?? ''}
            action={parentAcceptFormAction}
          />
        )}
      </Card>
    </>
  );
}
