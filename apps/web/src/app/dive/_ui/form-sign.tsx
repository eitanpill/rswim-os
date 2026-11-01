import { getTranslations } from 'next-intl/server';
import type { FormTemplate } from '@rswim/domain-dive';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { signFormAction } from '../forms-actions';
import { di } from './icons';
import { Chip, Panel } from './kit';
import { AgreeBox, SignaturePad } from './signature-pad';

/**
 * One of the club's forms, ready to read and sign: the text, the questions (health), the policy details (insurance),
 * an optional document, the signer's name, "I have read" and the signature pad. On the desk's tablet the page names
 * the diver (`diverId`); online the diver signs for themself.
 */
export async function FormSign({
  template,
  diverId,
  signerName,
  today,
  uploads,
}: {
  template: FormTemplate;
  diverId?: string;
  signerName: string;
  today: string;
  /** Whether documents can be attached (a file store is configured). */
  uploads: boolean;
}) {
  const t = await getTranslations('dive.forms');
  const kind = template.kind;
  return (
    <ActionForm action={signFormAction} className="gap-4" testId={`sign-${kind}`} keepValues>
      <input type="hidden" name="templateId" value={template.id} />
      <input type="hidden" name="kind" value={kind} />
      {diverId ? <input type="hidden" name="diverId" value={diverId} /> : null}

      <Panel
        title={template.title}
        icon={di.doc}
        action={
          <Chip tone="muted" icon={false}>
            {t('version', { v: template.version })}
          </Chip>
        }
      >
        <div
          className="max-h-[45vh] overflow-y-auto rounded-xl bg-[color-mix(in_oklch,var(--ink)_3%,transparent)] p-3 text-sm leading-relaxed whitespace-pre-line"
          tabIndex={0}
          data-testid="form-body"
        >
          {template.body}
        </div>
      </Panel>

      {template.questions.length > 0 ? (
        <Panel title={t('questionsTitle')} icon={di.shield} testId="form-questions">
          <p className="mb-3 text-sm text-ink-muted">{t('questionsHint')}</p>
          <ol className="flex flex-col divide-y divide-line">
            {template.questions.map((q, i) => (
              <li
                key={q.code}
                className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-sm">
                  <span className="me-1.5 text-ink-muted tabular-nums">{i + 1}.</span>
                  {q.he}
                </span>
                <span className="flex shrink-0 gap-2" role="radiogroup" aria-label={q.he}>
                  {(['no', 'yes'] as const).map((v) => (
                    <label
                      key={v}
                      className="flex min-h-tap cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm has-[:checked]:border-[var(--dive-sea)] has-[:checked]:bg-[color-mix(in_oklch,var(--dive-sea)_10%,transparent)]"
                    >
                      <input
                        type="radio"
                        name={`q_${q.code}`}
                        value={v}
                        className="size-4 accent-[var(--dive-sea)]"
                        data-testid={`q-${q.code}-${v}`}
                      />
                      {t(v)}
                    </label>
                  ))}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      {kind === 'insurance' ? (
        <Panel title={t('policyTitle')} icon={di.shield} testId="form-policy">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="insurer" label={t('insurer')} placeholder={t('insurerPlaceholder')} />
            <Field name="policyNumber" label={t('policyNumber')} dir="ltr" />
            <Field
              name="insuranceValidUntil"
              label={t('validUntil')}
              type="date"
              min={today}
              dir="ltr"
            />
          </div>
        </Panel>
      ) : null}

      {kind !== 'waiver' && uploads ? (
        <Panel testId="form-document">
          <Field
            name="document"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            label={kind === 'insurance' ? t('uploadPolicy') : t('uploadDoctor')}
            hint={t('uploadHint')}
            className="py-2 text-sm"
          />
        </Panel>
      ) : null}

      <Panel title={t('signTitle')} icon={di.pen} testId="form-signature">
        <div className="flex flex-col gap-3">
          <Field
            name="signerName"
            label={t('signerName')}
            defaultValue={signerName}
            autoComplete="name"
          />
          <AgreeBox label={t(`agree.${kind}`)} />
          <SignaturePad label={t('signHere')} hint={t('signHint')} clear={t('clear')} />
          <div>
            <SubmitButton data-testid="sign-submit">{t('submit')}</SubmitButton>
          </div>
          {diverId ? <p className="text-xs text-ink-muted">{t('deskNote')}</p> : null}
        </div>
      </Panel>
    </ActionForm>
  );
}
