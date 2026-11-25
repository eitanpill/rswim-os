import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  displayPhoneIL,
  LEAD_SOURCES,
  OPEN_LEAD_STAGES,
  type LeadSource,
  type LeadStage,
} from '@rswim/contracts';
import { leadSources, listLeads, monthSteps, type LeadRow } from '@rswim/domain-crm';
import { Badge, buttonVariants, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  Field,
  inputClass,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form';
import { withSession } from '@/lib/db';
import { createLeadAction, moveLeadAction } from './actions';
import { LeadAge } from './lead-age';

/** The stage a lead moves to with one tap from the list. */
const NEXT: Partial<Record<LeadStage, LeadStage>> = {
  new: 'talking',
  talking: 'trial_booked',
  trial_booked: 'joined',
};

/**
 * Leads (WhatsApp track, stage 1): everyone who asked about the school and is not a customer yet. A new number on
 * WhatsApp opens one by itself, and so does a join request from the school's link; a trial and a child placed in a
 * group move it on. The office answers, notes and moves them here.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; month?: string }>;
}) {
  const { q = '', month: asked } = await searchParams;
  const t = await getTranslations('leads');
  const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' })
    .format(new Date())
    .slice(0, 7);
  const month =
    asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked <= thisMonth ? asked : thisMonth;
  const [list, sources] = await withSession((tx) =>
    Promise.all([listLeads(tx, { q }), leadSources(tx, month)]),
  );
  const open = (stage: LeadStage) => list.filter((l) => l.stage === stage);
  const closed = list.filter((l) => l.stage === 'joined' || l.stage === 'lost');
  const waiting = list.filter((l) => l.stage === 'new' || l.attention !== null).length;

  return (
    <>
      <PageHeader icon="🙋" title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        {waiting > 0 ? (
          <p
            className="rounded-xl bg-[color-mix(in_oklch,var(--color-warn)_12%,transparent)] px-3 py-2 text-sm font-medium"
            data-testid="leads-waiting"
          >
            {t('waiting', { n: waiting })}
          </p>
        ) : null}
        <form method="get" role="search" className="flex gap-2">
          <label htmlFor="lead-q" className="sr-only">
            {t('search')}
          </label>
          <input
            id="lead-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder={t('searchPlaceholder')}
            className={inputClass}
          />
          <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
            {t('search')}
          </button>
        </form>

        <div className="grid gap-3 lg:grid-cols-3" data-testid="lead-board">
          {OPEN_LEAD_STAGES.map((stage) => {
            const rows = open(stage);
            return (
              <Card key={stage} data-testid={`lead-column-${stage}`}>
                <CardTitle
                  aside={
                    <Badge tone={stage === 'new' && rows.length ? 'warn' : 'neutral'}>
                      {rows.length}
                    </Badge>
                  }
                >
                  {t(`stage.${stage}`)}
                </CardTitle>
                {rows.length === 0 ? (
                  <p className="text-sm text-ink-muted">{t(`emptyStage.${stage}`)}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {rows.map((l) => (
                      <LeadCard key={l.id} lead={l} t={t} />
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>

        <Card>
          <details>
            <summary className="cursor-pointer font-semibold" data-testid="lead-new-toggle">
              ➕ {t('new')}
            </summary>
            <p className="mt-1 mb-3 text-sm text-ink-muted">{t('newHint')}</p>
            <ActionForm
              action={createLeadAction}
              className="grid gap-3 md:grid-cols-2"
              testId="lead-new"
            >
              <Field name="name" label={t('fields.name')} autoComplete="off" />
              <Field
                name="phone"
                label={t('fields.phone')}
                type="tel"
                dir="ltr"
                autoComplete="off"
              />
              <SelectField
                name="source"
                label={t('fields.source')}
                defaultValue="phone"
                options={LEAD_SOURCES.filter((s) => s !== 'join_link').map((s) => ({
                  value: s,
                  label: t(`source.${s}`),
                }))}
              />
              <Field
                name="interest"
                label={t('fields.interest')}
                placeholder={t('fields.interestHint')}
              />
              <Field name="nextActionOn" label={t('fields.nextActionOn')} type="date" />
              <TextareaField name="note" label={t('fields.note')} />
              <div className="md:col-span-2">
                <SubmitButton>{t('add')}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>

        <SourcesCard month={month} thisMonth={thisMonth} report={sources} t={t} />

        {closed.length ? (
          <Card>
            <details>
              <summary className="cursor-pointer font-semibold">
                {t('closed', { n: closed.length })}
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {closed.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/admin/leads/${l.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {l.name ?? <span dir="ltr">{l.phone ? displayPhoneIL(l.phone) : ''}</span>}
                    </Link>
                    <Badge tone={l.stage === 'joined' ? 'ok' : 'neutral'}>
                      {l.stage === 'lost' && l.lostReason
                        ? `${t('stage.lost')} · ${t(`lostReason.${l.lostReason}`)}`
                        : t(`stage.${l.stage}`)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        ) : list.length === 0 && !q ? (
          <Card>
            <EmptyState icon="🙋" title={t('empty')}>
              {t('emptyHint')}
            </EmptyState>
          </Card>
        ) : null}
      </div>
    </>
  );
}

/** Where the month's leads came from (WhatsApp track W4), with the months before it a tap away. */
function SourcesCard({
  month,
  thisMonth,
  report,
  t,
}: {
  month: string;
  thisMonth: string;
  report: Awaited<ReturnType<typeof leadSources>>;
  t: Awaited<ReturnType<typeof getTranslations<'leads'>>>;
}) {
  const { prev, next } = monthSteps(month);
  const [y, m] = month.split('-');
  const rate = (r: number | null) => (r === null ? '—' : `${r}%`);
  return (
    <Card data-testid="lead-sources">
      <CardTitle
        aside={
          <span className="flex items-center gap-2 text-sm">
            <Link
              href={`?month=${prev}`}
              aria-label={t('sources.prev')}
              data-testid="lead-sources-prev"
            >
              →
            </Link>
            <span className="tabular-nums" dir="ltr">
              {m}/{y}
            </span>
            {month < thisMonth ? (
              <Link href={`?month=${next}`} aria-label={t('sources.next')}>
                ←
              </Link>
            ) : null}
          </span>
        }
      >
        {t('sources.title')}
      </CardTitle>
      {report.rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('sources.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-ink-muted">
                <th className="py-1 text-start font-medium">{t('sources.source')}</th>
                <th className="py-1 text-end font-medium">{t('sources.leads')}</th>
                <th className="py-1 text-end font-medium">{t('sources.trials')}</th>
                <th className="py-1 text-end font-medium">{t('sources.joined')}</th>
                <th className="py-1 text-end font-medium">{t('sources.rate')}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {report.rows.map((r) => (
                <tr
                  key={r.source}
                  className="border-t border-line/60"
                  data-testid={`lead-source-${r.source}`}
                >
                  <td className="py-1">{t(`source.${r.source as LeadSource}`)}</td>
                  <td className="py-1 text-end">{r.leads}</td>
                  <td className="py-1 text-end">{r.trials}</td>
                  <td className="py-1 text-end">{r.joined}</td>
                  <td className="py-1 text-end">{rate(r.rate)}</td>
                </tr>
              ))}
              <tr className="border-t border-line font-semibold">
                <td className="py-1">{t('sources.total')}</td>
                <td className="py-1 text-end">{report.total.leads}</td>
                <td className="py-1 text-end">{report.total.trials}</td>
                <td className="py-1 text-end">{report.total.joined}</td>
                <td className="py-1 text-end">{rate(report.total.rate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-muted">{t('sources.hint')}</p>
    </Card>
  );
}

function LeadCard({
  lead: l,
  t,
}: {
  lead: LeadRow;
  t: Awaited<ReturnType<typeof getTranslations<'leads'>>>;
}) {
  const next = NEXT[l.stage];
  return (
    <li
      className="flex flex-col gap-1.5 rounded-xl bg-surface p-3 ring-1 ring-line/60"
      data-testid="lead"
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/admin/leads/${l.id}`}
          className="font-semibold underline-offset-2 hover:underline"
          data-testid="lead-open"
        >
          {l.name ?? (
            <span dir="ltr" className="tabular-nums">
              {l.phone ? displayPhoneIL(l.phone) : ''}
            </span>
          )}
        </Link>
        <LeadAge at={l.lastMessageAt ?? l.createdAt} attention={l.attention} />
      </div>
      <p className="text-xs text-ink-muted">
        {t(`source.${l.source}`)}
        {l.interest ? ` · ${l.interest}` : ''}
        {l.messageCount > 1 ? ` · ${t('messages', { n: l.messageCount })}` : ''}
      </p>
      {l.lastMessage ? <p className="line-clamp-2 text-sm">“{l.lastMessage}”</p> : null}
      {l.attention ? (
        <p className="text-xs font-medium text-warn-ink">{t(`attention.${l.attention}`)}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Link
          href={`/admin/leads/${l.id}`}
          className={buttonVariants({
            size: 'sm',
            variant: l.stage === 'new' ? 'primary' : 'secondary',
          })}
        >
          {l.stage === 'new' && l.phone ? t('answer') : t('open')}
        </Link>
        {next ? (
          <ActionButton
            action={moveLeadAction}
            fields={{ id: l.id, stage: next }}
            variant="ghost"
            size="sm"
            data-testid="lead-next"
          >
            {t(`moveTo.${next}`)}
          </ActionButton>
        ) : null}
      </div>
    </li>
  );
}
