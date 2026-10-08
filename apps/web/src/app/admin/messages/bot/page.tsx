import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { commsRules } from '@rswim/domain-comms';
import { botStats, listBotReplies, listKnowledge } from '@rswim/domain-copilot';
import { Badge, Card, CardTitle, EmptyState, PageHeader, cn } from '@rswim/ui';
import { ActionButton, ActionForm, SubmitButton, TextareaField } from '@/components/form';
import { withSession } from '@/lib/db';
import { enumLabel } from '@/lib/options';
import { MessagesTabs, when } from '../tabs';
import { knowledgeStatusAction, reviewBotReplyAction, saveKnowledgeAction } from './actions';

/** One entry's form: a new one, an edit, or a learned suggestion approved in the same step. */
async function KnowledgeForm({
  entry,
  approve = false,
  testId,
}: {
  entry?: { id: string; question: string; answer: string };
  approve?: boolean;
  testId?: string;
}) {
  const t = await getTranslations('comms.bot');
  return (
    <ActionForm action={saveKnowledgeAction} resetOnSuccess={!entry} testId={testId}>
      <input type="hidden" name="id" value={entry?.id ?? ''} />
      {approve ? <input type="hidden" name="approve" value="on" /> : null}
      <TextareaField
        name="question"
        label={t('question')}
        defaultValue={entry?.question}
        rows={2}
        dir="auto"
      />
      <TextareaField
        name="answer"
        label={t('answer')}
        defaultValue={entry?.answer}
        rows={3}
        dir="auto"
      />
      <div>
        <SubmitButton>{approve ? t('approve') : t('save')}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * The parents' bot: whether it is on, the answers it learned from the office waiting for approval, what it did with
 * recent messages (the office marks answers good or bad), and the questions and answers it works from.
 */
export default async function BotPage() {
  const t = await getTranslations('comms.bot');
  const label = await enumLabel();
  const { enabled, stats, replies, suggestions, knowledge } = await withSession(async (tx) => ({
    enabled: (await commsRules(tx)).botEnabled,
    stats: await botStats(tx),
    replies: await listBotReplies(tx, { limit: 50 }),
    suggestions: await listKnowledge(tx, ['suggested']),
    knowledge: await listKnowledge(tx, ['active']),
  }));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <MessagesTabs active="bot" />
      <div className="flex flex-col gap-4">
        <Card data-testid="bot-status">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={enabled ? 'ok' : 'neutral'}>{enabled ? t('on') : t('off')}</Badge>
            <Link
              href="/admin/policies"
              className="min-h-tap py-2 text-sm text-brand-700 underline"
            >
              {t('turnOn')}
            </Link>
          </div>
          <p className="mt-2 text-sm">{t('stats', stats)}</p>
          <p className="mt-1 text-sm text-ink-muted">{t('howItWorks')}</p>
        </Card>

        <Card data-testid="bot-suggestions">
          <CardTitle>{t('suggestions', { n: suggestions.length })}</CardTitle>
          <p className="mt-1 text-sm text-ink-muted">{t('suggestionsHint')}</p>
          {suggestions.length === 0 ? (
            <p className="mt-3 text-sm">{t('noSuggestions')}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-4">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  className="rounded-xl border border-line p-3"
                  data-testid="bot-suggestion"
                >
                  <KnowledgeForm entry={s} approve />
                  <div className="mt-2">
                    <ActionButton
                      action={knowledgeStatusAction}
                      fields={{ id: s.id, status: 'archived' }}
                      variant="ghost"
                    >
                      {t('reject')}
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('replies')}</CardTitle>
          {replies.length === 0 ? (
            <EmptyState title={t('noReplies')} />
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {replies.map((r) => (
                <li
                  key={r.id}
                  className={cn(
                    'rounded-xl border border-line p-3',
                    r.review === 'bad' && 'border-danger',
                  )}
                  data-testid="bot-reply"
                  data-outcome={r.outcome}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {r.family ? <p className="font-semibold">{r.family}</p> : null}
                    <span className="text-sm text-ink-muted">{when(r.receivedAt)}</span>
                    <Badge tone={r.outcome === 'answered' ? 'ok' : 'warn'}>
                      {label('botOutcome', r.outcome)}
                    </Badge>
                    {r.handoffReason ? (
                      <span className="text-xs text-ink-muted">
                        {label('botHandoffReason', r.handoffReason)}
                      </span>
                    ) : null}
                    {r.review !== 'unreviewed' ? (
                      <Badge tone={r.review === 'good' ? 'ok' : 'danger'}>
                        {label('botReview', r.review)}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">{t('parentWrote')}</p>
                  <p className="whitespace-pre-wrap rounded-xl bg-surface p-2 text-sm" dir="auto">
                    {r.body}
                  </p>
                  <p className="mt-2 text-xs text-ink-muted">
                    {r.outcome === 'answered' ? t('botAnswered') : t('handoffSummary')}
                  </p>
                  <p className="whitespace-pre-wrap text-sm" dir="auto">
                    {r.answer ?? r.handoffSummary}
                  </p>
                  {r.outcome === 'answered' ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ActionButton
                        action={reviewBotReplyAction}
                        fields={{ id: r.id, review: 'good' }}
                        variant="ghost"
                      >
                        {t('good')}
                      </ActionButton>
                      <ActionButton
                        action={reviewBotReplyAction}
                        fields={{ id: r.id, review: 'bad' }}
                        variant="ghost"
                      >
                        {t('bad')}
                      </ActionButton>
                    </div>
                  ) : null}
                  {r.review === 'bad' ? (
                    <p className="mt-1 text-xs text-ink-muted">{t('badHint')}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card data-testid="bot-knowledge">
          <CardTitle>{t('knowledge', { n: knowledge.length })}</CardTitle>
          <p className="mt-1 text-sm text-ink-muted">{t('knowledgeHint')}</p>
          <details className="mt-3">
            <summary className="min-h-tap cursor-pointer py-2 text-sm font-medium text-brand-700">
              {t('add')}
            </summary>
            <KnowledgeForm testId="bot-knowledge-form" />
          </details>
          {knowledge.length === 0 ? (
            <p className="mt-3 text-sm">{t('empty')}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {knowledge.map((k) => (
                <li
                  key={k.id}
                  className="rounded-xl border border-line p-3"
                  data-testid="bot-entry"
                >
                  <p className="font-medium" dir="auto">
                    {k.question}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm" dir="auto">
                    {k.answer}
                  </p>
                  {k.source === 'learned' ? (
                    <p className="mt-1 text-xs text-ink-muted">{t('learned')}</p>
                  ) : null}
                  <details className="mt-2">
                    <summary className="min-h-tap cursor-pointer py-2 text-sm text-brand-700">
                      {t('edit')}
                    </summary>
                    <KnowledgeForm entry={k} />
                  </details>
                  <ActionButton
                    action={knowledgeStatusAction}
                    fields={{ id: k.id, status: 'archived' }}
                    variant="ghost"
                  >
                    {t('archive')}
                  </ActionButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
