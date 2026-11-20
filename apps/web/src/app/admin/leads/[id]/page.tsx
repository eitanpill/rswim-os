import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { displayPhoneIL, LEAD_LOST_REASONS, LEAD_STAGES } from '@rswim/contracts';
import { isDomainError } from '@rswim/domain-core';
import { getLead } from '@rswim/domain-crm';
import { Badge, buttonVariants, Card, CardTitle, PageHeader } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  Field,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form';
import { withSession } from '@/lib/db';
import { moveLeadAction, replyToLeadAction, updateLeadAction } from '../actions';

const TIME = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** One lead: what they wrote and what we answered, a reply box, the office's notes and where the lead stands. */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const t = await getTranslations('leads');
  const data = await withSession((tx) => getLead(tx, id)).catch((e: unknown) => {
    if (isDomainError(e)) notFound();
    throw e;
  });
  const { lead, conversation } = data;
  const phone = lead.phone ? displayPhoneIL(lead.phone) : null;
  const title = lead.name ?? phone ?? '';

  return (
    <>
      <PageHeader
        icon="🙋"
        title={title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge
              tone={lead.stage === 'joined' ? 'ok' : lead.stage === 'new' ? 'warn' : 'neutral'}
            >
              {t(`stage.${lead.stage}`)}
            </Badge>
            <span>{t(`source.${lead.source}`)}</span>
            {lead.name && phone ? (
              <span dir="ltr" className="tabular-nums">
                {phone}
              </span>
            ) : null}
          </span>
        }
        actions={
          <Link
            href="/admin/leads"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            {t('back')}
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="lead-conversation">
          <CardTitle>{t('conversation')}</CardTitle>
          {conversation.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('noConversation')}</p>
          ) : (
            <ol className="mb-3 flex flex-col gap-2">
              {conversation.map((m) => (
                <li
                  key={m.id}
                  className={
                    m.direction === 'in'
                      ? 'me-8 rounded-2xl rounded-ss-sm bg-surface p-3 text-sm ring-1 ring-line/60'
                      : 'ms-8 rounded-2xl rounded-se-sm bg-brand-50 p-3 text-sm dark:bg-surface-raised'
                  }
                  data-testid={`lead-message-${m.direction}`}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {TIME.format(m.at)}
                    {m.direction === 'out' && m.status ? ` · ${t(`sendStatus.${m.status}`)}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {lead.phone ? (
            <ActionForm action={replyToLeadAction} resetOnSuccess testId="lead-reply">
              <input type="hidden" name="leadId" value={lead.id} />
              <TextareaField name="text" label={t('reply')} placeholder={t('replyHint')} required />
              <SubmitButton>{t('send')}</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-sm text-ink-muted">{t('noPhone')}</p>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card data-testid="lead-stage">
            <CardTitle>{t('where')}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {LEAD_STAGES.filter((s) => s !== lead.stage && s !== 'lost').map((s) => (
                <ActionButton
                  key={s}
                  action={moveLeadAction}
                  fields={{ id: lead.id, stage: s }}
                  variant="secondary"
                  size="sm"
                >
                  {t(`moveTo.${s}`)}
                </ActionButton>
              ))}
            </div>
            {lead.householdId ? (
              <p className="mt-3 text-sm">
                <Link
                  href={`/admin/families/${lead.householdId}`}
                  className="font-medium underline"
                >
                  {t('openFamily')}
                </Link>
              </p>
            ) : null}
            {lead.stage !== 'lost' ? (
              <ActionForm
                action={moveLeadAction}
                className="mt-4 flex flex-wrap items-end gap-2"
                testId="lead-lost"
              >
                <input type="hidden" name="id" value={lead.id} />
                <input type="hidden" name="stage" value="lost" />
                <SelectField
                  name="lostReason"
                  label={t('lostWhy')}
                  options={LEAD_LOST_REASONS.map((r) => ({
                    value: r,
                    label: t(`lostReason.${r}`),
                  }))}
                />
                <SubmitButton variant="ghost">{t('moveTo.lost')}</SubmitButton>
              </ActionForm>
            ) : lead.lostReason ? (
              <p className="mt-3 text-sm text-ink-muted">
                {t('lostBecause', { reason: t(`lostReason.${lead.lostReason}`) })}
              </p>
            ) : null}
          </Card>

          <Card>
            <CardTitle>{t('details')}</CardTitle>
            <ActionForm
              action={updateLeadAction}
              className="flex flex-col gap-3"
              testId="lead-edit"
            >
              <input type="hidden" name="id" value={lead.id} />
              <Field name="name" label={t('fields.name')} defaultValue={lead.name ?? ''} />
              <Field
                name="interest"
                label={t('fields.interest')}
                defaultValue={lead.interest ?? ''}
                placeholder={t('fields.interestHint')}
              />
              <Field
                name="nextActionOn"
                label={t('fields.nextActionOn')}
                type="date"
                defaultValue={lead.nextActionOn ?? ''}
              />
              <TextareaField name="note" label={t('fields.note')} defaultValue={lead.note ?? ''} />
              <SubmitButton>{t('save')}</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
