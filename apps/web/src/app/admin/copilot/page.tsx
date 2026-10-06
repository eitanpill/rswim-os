import { getTranslations } from 'next-intl/server';
import { copilotAvailable, listCopilot, type CopilotActionRow } from '@rswim/domain-copilot';
import { todayIL } from '@rswim/domain-scheduling';
import { Badge, Card, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, SubmitButton, TextareaField } from '@/components/form';
import { explainer } from '@/lib/billing';
import { copilotModel } from '@/lib/copilot';
import { withSession } from '@/lib/db';
import { dmy, enumLabel } from '@/lib/options';
import {
  askCopilotAction,
  confirmCopilotActionAction,
  dismissCopilotActionAction,
  undoCopilotActionAction,
} from './actions';

const TONE = {
  proposed: 'warn',
  confirmed: 'ok',
  failed: 'danger',
  dismissed: 'neutral',
  undone: 'neutral',
} as const;

/**
 * The owner's copilot (brief §6.15): ask in Hebrew; the model reads and proposes, and nothing happens until the owner
 * taps confirm. A confirmed move can be undone here.
 */
export default async function CopilotPage() {
  const t = await getTranslations('copilot');
  const label = await enumLabel();
  const explain = await explainer();
  const { gate, exchanges } = await withSession(async (tx) => ({
    gate: await copilotAvailable(tx, copilotModel(await todayIL(tx))),
    exchanges: await listCopilot(tx),
  }));
  const summary = (a: CopilotActionRow) => {
    const p = { ...a.summary.params };
    if (typeof p.date === 'string') p.date = dmy(p.date);
    return explain({ code: a.summary.code, params: p });
  };

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        {gate.ok ? (
          <Card>
            <ActionForm action={askCopilotAction} testId="copilot-form" resetOnSuccess>
              <TextareaField name="prompt" label={t('prompt')} hint={t('promptHint')} rows={3} />
              <div>
                <SubmitButton>{t('ask')}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ) : (
          <Card data-testid="copilot-off">
            <p className="text-sm">{explain({ code: gate.code, params: {} })}</p>
          </Card>
        )}

        {exchanges.length === 0 ? (
          <Card>
            <EmptyState title={t('empty')} />
          </Card>
        ) : null}
        {exchanges.map((x) => (
          <Card key={x.id} data-testid="copilot-exchange">
            <p className="text-sm font-semibold">{x.prompt}</p>
            <p className="mt-2 whitespace-pre-line text-sm" data-testid="copilot-answer">
              {x.answer ||
                explain({ code: x.errorCode ?? 'copilot.errors.modelFailed', params: {} })}
            </p>
            {x.trace.length ? (
              <details className="mt-2">
                <summary className="min-h-tap cursor-pointer py-2 text-xs text-brand-700">
                  {t('trace', { n: x.trace.length })}
                </summary>
                <ul className="ms-4 list-disc text-xs text-ink-muted">
                  {x.trace.map((s, i) => (
                    <li key={i}>
                      {t.has(`tools.${s.tool}`) ? t(`tools.${s.tool}`) : s.tool}
                      {s.error ? ` · ${explain({ code: String(s.output), params: {} })}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {x.actions.length ? (
              <ul className="mt-3 flex flex-col gap-2">
                {x.actions.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-xl border border-line p-3"
                    data-testid="copilot-action"
                    data-status={a.status}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">{summary(a)}</span>
                      <Badge tone={TONE[a.status]}>{label('copilotActionStatus', a.status)}</Badge>
                    </div>
                    {a.errorCode ? (
                      <p className="mt-1 text-sm text-danger">
                        {explain({
                          code: a.errorCode,
                          params: (a.result as { params?: object } | null)?.params ?? {},
                        })}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {a.status === 'proposed' ? (
                        <>
                          <ActionButton
                            action={confirmCopilotActionAction}
                            fields={{ id: a.id }}
                            data-testid="copilot-confirm"
                          >
                            {t('confirm')}
                          </ActionButton>
                          <ActionButton
                            action={dismissCopilotActionAction}
                            fields={{ id: a.id }}
                            variant="ghost"
                            data-testid="copilot-dismiss"
                          >
                            {t('dismiss')}
                          </ActionButton>
                        </>
                      ) : null}
                      {a.status === 'confirmed' && a.kind === 'move_student' ? (
                        <ActionButton
                          action={undoCopilotActionAction}
                          fields={{ id: a.id }}
                          variant="secondary"
                          confirm={t('undoConfirm')}
                          data-testid="copilot-undo"
                        >
                          {t('undo')}
                        </ActionButton>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ))}
        <p className="text-xs text-ink-muted">{t('note')}</p>
      </div>
    </>
  );
}
