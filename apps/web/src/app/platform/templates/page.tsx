import { getTranslations } from 'next-intl/server';
import { listSubmittedTemplates } from '@rswim/domain-platform';
import { Badge, Card, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { withSignedIn } from '@/lib/db';
import { reviewTemplateAction } from '../actions';

/** Templates schools shared, waiting for a platform admin before any other school sees them. */
export default async function TemplateReviewPage() {
  const t = await getTranslations('platform.review');
  const tEnum = await getTranslations('enums');
  const list = await withSignedIn((tx) => listSubmittedTemplates(tx), { platform: true });
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {list.length === 0 ? (
        <Card>
          <EmptyState title={t('empty')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((x) => (
            <li key={x.id}>
              <Card>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">{x.name}</h2>
                  <Badge>{tEnum(`templateKind.${x.kind}`)}</Badge>
                </div>
                {x.description ? <p className="text-sm text-ink-muted">{x.description}</p> : null}
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-brand-700">
                    {t('payload')}
                  </summary>
                  <pre
                    dir="ltr"
                    className="mt-2 max-h-64 overflow-auto rounded-xl bg-surface p-2 text-xs"
                  >
                    {JSON.stringify(x.payload, null, 2)}
                  </pre>
                </details>
                <div className="mt-3 flex gap-2">
                  <ActionButton
                    action={reviewTemplateAction}
                    fields={{ id: x.id, decision: 'published' }}
                  >
                    {t('publish')}
                  </ActionButton>
                  <ActionButton
                    action={reviewTemplateAction}
                    fields={{ id: x.id, decision: 'rejected' }}
                    variant="ghost"
                  >
                    {t('reject')}
                  </ActionButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
