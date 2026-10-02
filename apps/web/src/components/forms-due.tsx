import { getTranslations } from 'next-intl/server';
import type { FormDue, FormTemplateRow } from '@rswim/domain-enrollment';
import { ActionForm, CheckboxField, SelectField, SubmitButton } from '@/components/form';
import type { Action } from '@/components/form';
import { issueText } from '@/lib/scheduling';

/**
 * The forms a household still owes, each with its text and an accept form. The office picks how the acceptance came
 * (paper, phone); the family accepts in the portal.
 */
export async function FormsDue({
  due,
  current,
  householdId,
  studentName,
  action,
  channels,
}: {
  due: readonly FormDue[];
  current: readonly FormTemplateRow[];
  householdId: string;
  studentName: (id: string) => string;
  action: Action;
  channels?: { value: string; label: string }[];
}) {
  const t = await getTranslations('enrollment.forms');
  const why = await issueText();
  return (
    <ul className="flex flex-col gap-3">
      {due.map((d) => {
        const form = current.find((f) => f.id === d.formTemplateId);
        if (!form) return null;
        const questions = form.questions as { code: string; he: string }[];
        return (
          <li
            key={`${d.formTemplateId}:${d.studentId ?? ''}`}
            className="rounded-xl border border-warn p-3"
            data-testid="form-due"
          >
            <p className="font-medium">
              {form.title}
              {d.studentId ? ` · ${studentName(d.studentId)}` : ''}
            </p>
            <p className="text-sm text-ink-muted">{why(d.why)}</p>
            <details className="mt-1">
              <summary className="min-h-tap cursor-pointer py-2 text-sm text-brand-700">
                {t('text')}
              </summary>
              <p className="whitespace-pre-line text-sm">{form.body}</p>
            </details>
            <ActionForm action={action} className="mt-2">
              <input type="hidden" name="formTemplateId" value={form.id} />
              <input type="hidden" name="householdId" value={householdId} />
              <input type="hidden" name="studentId" value={d.studentId ?? ''} />
              <input type="hidden" name="codes" value={questions.map((q) => q.code).join(',')} />
              {questions.length ? (
                <fieldset className="flex flex-col gap-1">
                  <legend className="text-sm font-medium">{t('tickYes')}</legend>
                  {questions.map((q) => (
                    <CheckboxField key={q.code} name={`answer_${q.code}`} label={q.he} />
                  ))}
                </fieldset>
              ) : null}
              {channels ? (
                <SelectField name="channel" label={t('channel')} options={channels} />
              ) : null}
              <div>
                <SubmitButton variant={channels ? 'secondary' : 'primary'}>
                  {channels ? t('record') : t('accept')}
                </SubmitButton>
              </div>
            </ActionForm>
          </li>
        );
      })}
    </ul>
  );
}
