import { getTranslations } from 'next-intl/server';
import { DIVE_FORM_KINDS } from '@rswim/contracts';
import { listFormTemplates, paperworkQueue, type FormTemplate } from '@rswim/domain-dive';
import { ActionButton, ActionForm, Field, SubmitButton, TextareaField } from '@/components/form';
import { withSession } from '@/lib/db';
import { fileStore } from '@/lib/dive-files';
import { publishFormAction, saveDraftAction } from '../forms-actions';
import { canEditForms, requireDivePage } from '../_ui/access';
import { dateShort } from '../_ui/format';
import { di } from '../_ui/icons';
import { Chip, Empty, Hero, Panel } from '../_ui/kit';
import { ReviewForm } from '../_ui/review-form';
import { PersonLine } from '../_ui/widgets';

const questionsText = (t: FormTemplate) =>
  t.questions.map((q) => `${q.flag ? '! ' : ''}${q.he}`).join('\n');

/**
 * The club's paperwork in one place: health declarations waiting for clearance, divers booked this week with a form
 * missing, insurance running out, and the texts of the forms (the owner and the manager edit and publish them).
 */
export default async function FormsCenter() {
  const { role } = await requireDivePage('forms');
  const t = await getTranslations('dive.forms');
  const [queue, templates] = await withSession((tx) =>
    Promise.all([paperworkQueue(tx), listFormTemplates(tx)]),
  );
  const uploads = fileStore() !== null;
  const editable = canEditForms(role);
  return (
    <div className="flex flex-col gap-5" data-testid="forms-center">
      <Hero
        kicker={t('kicker')}
        title={t('centerTitle')}
        sub={t('centerSub', {
          pending: queue.pending.length,
          missing: queue.unsignedBooked.length,
          insurance: queue.insurance.length,
        })}
      />

      <Panel title={t('pendingTitle')} icon={di.shield} testId="pending-reviews">
        {queue.pending.length === 0 ? (
          <Empty>{t('noPending')}</Empty>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {queue.pending.map((p) => (
              <li
                key={p.signatureId}
                className="flex flex-col gap-3 rounded-xl border border-line p-3"
                data-testid="pending-review"
              >
                <div className="flex items-start justify-between gap-2">
                  <a href={`/dive/divers/${p.diverId}`} className="min-w-0 hover:underline">
                    <PersonLine
                      name={p.name}
                      sub={`${t('signedOn', { date: dateShort(p.signedAt) })}${
                        p.nextOn ? ` · ${t('nextDive', { date: dateShort(p.nextOn) })}` : ''
                      }`}
                    />
                  </a>
                  <a
                    href={`/dive/signed/${p.signatureId}`}
                    className="shrink-0 text-sm text-[var(--dive-sea)] hover:underline"
                  >
                    {t('viewSigned')}
                  </a>
                </div>
                <ul className="flex flex-col gap-1 text-sm">
                  {p.flagged.map((q) => (
                    <li key={q} className="flex items-start gap-1.5">
                      <span className="mt-0.5 text-[var(--dive-nogo)] [&_svg]:size-4">
                        {di.bang}
                      </span>
                      {q}
                    </li>
                  ))}
                </ul>
                <ReviewForm signatureId={p.signatureId} uploads={uploads} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('missingTitle')} icon={di.calendar} testId="unsigned-booked" flush>
          {queue.unsignedBooked.length === 0 ? (
            <Empty>{t('noMissing')}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {queue.unsignedBooked.map((u) => (
                <li key={u.diverId}>
                  <a
                    href={`/dive/divers/${u.diverId}`}
                    className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-[color-mix(in_oklch,var(--dive-sea)_5%,transparent)]"
                  >
                    <PersonLine name={u.name} sub={t('nextDive', { date: dateShort(u.nextOn) })} />
                    <span className="flex shrink-0 gap-1">
                      {u.waiver ? <Chip tone="nogo">{t('kind.waiver')}</Chip> : null}
                      {u.medical ? <Chip tone="nogo">{t('kind.health')}</Chip> : null}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t('insuranceTitle')} icon={di.shield} testId="insurance-expiring" flush>
          {queue.insurance.length === 0 ? (
            <Empty>{t('noInsurance')}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {queue.insurance.map((u) => (
                <li key={u.diverId}>
                  <a
                    href={`/dive/divers/${u.diverId}`}
                    className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-[color-mix(in_oklch,var(--dive-sea)_5%,transparent)]"
                  >
                    <PersonLine
                      name={u.name}
                      sub={u.nextOn ? t('nextDive', { date: dateShort(u.nextOn) }) : undefined}
                    />
                    {u.until ? (
                      <Chip
                        tone={u.until < new Date().toISOString().slice(0, 10) ? 'nogo' : 'caution'}
                      >
                        {t('until', { date: dateShort(u.until) })}
                      </Chip>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section className="flex flex-col gap-3" data-testid="form-texts">
        <h2 className="text-lg font-bold">{t('textsTitle')}</h2>
        <p className="text-sm text-ink-muted">{editable ? t('textsSub') : t('textsReadOnly')}</p>
        <div className="grid gap-4 lg:grid-cols-3">
          {DIVE_FORM_KINDS.map((kind) => {
            const versions = templates.filter((x) => x.kind === kind);
            const live = versions.find((x) => x.publishedAt !== null) ?? null;
            const draft = versions.find((x) => x.publishedAt === null) ?? null;
            const base = draft ?? live;
            return (
              <Panel
                key={kind}
                title={t(`kind.${kind}`)}
                icon={di.doc}
                testId={`texts-${kind}`}
                action={
                  live ? (
                    <Chip tone="go">{t('liveVersion', { v: live.version })}</Chip>
                  ) : (
                    <Chip tone="nogo">{t('notPublished')}</Chip>
                  )
                }
              >
                <div className="flex flex-col gap-3">
                  {live ? (
                    <p className="text-xs text-ink-muted">
                      {t('liveLine', {
                        date: dateShort(live.publishedAt as string),
                        count: live.signatures,
                        questions: live.questions.length,
                      })}
                    </p>
                  ) : null}
                  {draft ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[color-mix(in_oklch,var(--dive-caution)_10%,transparent)] p-2.5 text-sm">
                      <span>{t('draftLine', { v: draft.version })}</span>
                      {editable ? (
                        <ActionButton
                          action={publishFormAction}
                          fields={{ templateId: draft.id }}
                          confirm={t('publishConfirm')}
                          className="min-h-9 text-sm"
                          data-testid={`publish-${kind}`}
                        >
                          {t('publish')}
                        </ActionButton>
                      ) : null}
                    </div>
                  ) : null}
                  {editable ? (
                    <details className="rounded-xl border border-line" open={draft !== null}>
                      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-[var(--dive-sea)]">
                        {draft ? t('editDraft') : t('newVersion')}
                      </summary>
                      <ActionForm action={saveDraftAction} className="p-3" testId={`draft-${kind}`}>
                        <input type="hidden" name="kind" value={kind} />
                        <Field
                          name="title"
                          label={t('textTitle')}
                          defaultValue={base?.title ?? ''}
                        />
                        <TextareaField
                          name="body"
                          label={t('textBody')}
                          rows={10}
                          defaultValue={base?.body ?? ''}
                        />
                        {kind === 'health' ? (
                          <TextareaField
                            name="questions"
                            label={t('textQuestions')}
                            hint={t('textQuestionsHint')}
                            rows={8}
                            defaultValue={base ? questionsText(base) : ''}
                          />
                        ) : null}
                        <div>
                          <SubmitButton variant="secondary">{t('saveDraft')}</SubmitButton>
                        </div>
                      </ActionForm>
                    </details>
                  ) : live ? (
                    <details className="rounded-xl border border-line">
                      <summary className="cursor-pointer px-3 py-2 text-sm">
                        {t('readText')}
                      </summary>
                      <p className="max-h-64 overflow-y-auto px-3 pb-3 text-sm whitespace-pre-line">
                        {live.body}
                      </p>
                    </details>
                  ) : null}
                </div>
              </Panel>
            );
          })}
        </div>
      </section>
    </div>
  );
}
