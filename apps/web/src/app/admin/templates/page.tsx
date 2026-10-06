import { getTranslations } from 'next-intl/server';
import { TEMPLATE_KINDS } from '@rswim/contracts';
import { listTemplates } from '@rswim/domain-platform';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  Field,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form';
import { withSession } from '@/lib/db';
import { enumOptions } from '@/lib/options';
import { installTemplateAction, shareTemplateAction } from './actions';

/** Ready-made regulations, catalogs and message wording, installed in one tap; the school can share its own. */
export default async function TemplatesPage() {
  const t = await getTranslations('platform.templates');
  const tEnum = await getTranslations('enums');
  const list = await withSession((tx) => listTemplates(tx));
  const published = list.filter((x) => x.status === 'published');
  const mine = list.filter((x) => x.status !== 'published');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {published.length === 0 ? (
        <Card>
          <EmptyState title={t('empty')} />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {published.map((x) => (
            <li key={x.id}>
              <Card data-testid={`template-${x.kind}`}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">{x.name}</h2>
                  <Badge>{tEnum(`templateKind.${x.kind}`)}</Badge>
                </div>
                {x.description ? (
                  <p className="mt-1 text-sm text-ink-muted">{x.description}</p>
                ) : null}
                <p className="mt-2 text-sm">{t(`effect.${x.kind}`)}</p>
                <div className="mt-3 flex items-center gap-3">
                  <ActionButton
                    action={installTemplateAction}
                    fields={{ id: x.id }}
                    confirm={t('installConfirm')}
                  >
                    {x.installedAt ? t('installAgain') : t('install')}
                  </ActionButton>
                  {x.installedAt ? (
                    <Badge tone="ok" data-testid="installed">
                      {t('installedBadge')}
                    </Badge>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>{t('share')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('shareHint')}</p>
          <ActionForm action={shareTemplateAction} resetOnSuccess>
            <SelectField
              name="kind"
              label={t('kind')}
              options={await enumOptions('templateKind', TEMPLATE_KINDS)}
            />
            <Field name="name" label={t('name')} />
            <TextareaField name="description" label={t('description')} />
            <div>
              <SubmitButton variant="secondary">{t('submit')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
        {mine.length > 0 ? (
          <Card>
            <CardTitle>{t('mine')}</CardTitle>
            <ul className="flex flex-col gap-2">
              {mine.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2">
                  <span>{x.name}</span>
                  <Badge tone={x.status === 'rejected' ? 'danger' : 'neutral'}>
                    {tEnum(`templateStatus.${x.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
