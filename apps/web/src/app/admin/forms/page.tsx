import { getTranslations } from 'next-intl/server';
import { FORM_KINDS } from '@rswim/contracts';
import { listFormTemplates } from '@rswim/domain-enrollment';
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
import { dmy, enumLabel, enumOptions, todayIL } from '@/lib/options';
import { AttendanceTabs } from '../attendance/tabs';
import { createFormVersionAction, publishFormAction } from './actions';

/**
 * The regulations and the forms (brief §6.2): each version is a fixed text; publishing it asks every family to accept
 * it again, and an acceptance stores the hash of the exact text the family saw.
 */
export default async function FormsPage() {
  const t = await getTranslations('enrollment.forms');
  const label = await enumLabel();
  const forms = await withSession((tx) => listFormTemplates(tx));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <AttendanceTabs active="forms" />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t('versions')}</CardTitle>
          {forms.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {forms.map((f) => (
                <li
                  key={f.id}
                  className="rounded-xl border border-line p-3"
                  data-testid="form-version"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {f.title}{' '}
                      <span className="text-sm text-ink-muted">
                        {label('formKind', f.kind)} · {t('version', { n: f.version })} ·{' '}
                        {t('from', { date: dmy(f.effectiveFrom) })}
                      </span>
                    </p>
                    {f.publishedAt ? (
                      <Badge tone="ok">{t('published')}</Badge>
                    ) : (
                      <ActionButton
                        action={publishFormAction}
                        fields={{ id: f.id }}
                        confirm={t('publishConfirm')}
                      >
                        {t('publish')}
                      </ActionButton>
                    )}
                  </div>
                  <details className="mt-1">
                    <summary className="min-h-tap cursor-pointer py-2 text-sm text-brand-700">
                      {t('text')}
                    </summary>
                    <p className="whitespace-pre-line text-sm">{f.body}</p>
                    {(f.questions as { code: string; he: string }[]).length ? (
                      <ol className="mt-2 list-decimal ps-5 text-sm">
                        {(f.questions as { code: string; he: string }[]).map((q) => (
                          <li key={q.code}>{q.he}</li>
                        ))}
                      </ol>
                    ) : null}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('newVersion')}</CardTitle>
          <ActionForm action={createFormVersionAction} resetOnSuccess testId="form-version-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                name="kind"
                label={t('kind')}
                options={await enumOptions('formKind', FORM_KINDS)}
              />
              <Field
                name="effectiveFrom"
                type="date"
                label={t('effectiveFrom')}
                defaultValue={todayIL()}
              />
            </div>
            <Field name="title" label={t('formTitle')} />
            <TextareaField name="body" label={t('body')} rows={8} />
            <TextareaField name="questions" label={t('questions')} hint={t('questionsHint')} />
            <div>
              <SubmitButton>{t('saveDraft')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
