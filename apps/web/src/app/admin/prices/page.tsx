import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PRICE_ITEM_KINDS, type PriceItemKind } from '@rswim/contracts';
import { listPriceLists, listPrograms, priceFor } from '@rswim/domain-settings';
import { listVenues } from '@rswim/domain-venues';
import { agorot } from '@rswim/money';
import { Badge, buttonVariants, Card, CardTitle, EmptyState, Money, PageHeader } from '@rswim/ui';
import { inputClass } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions, todayIL } from '@/lib/options';
import { createPriceListAction } from './actions';
import { PriceListForm } from './price-list-form';

const STATUS_TONE = { draft: 'warn', published: 'ok', archived: 'neutral' } as const;

type Search = {
  venue?: string;
  program?: string;
  kind?: string;
  date?: string;
  duration?: string;
  sessions?: string;
};

export default async function PricesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const t = await getTranslations('prices');
  const label = await enumLabel();
  const today = todayIL();
  const kind = (PRICE_ITEM_KINDS as readonly string[]).includes(q.kind ?? '')
    ? (q.kind as PriceItemKind)
    : 'monthly';
  const checkDate = /^\d{4}-\d{2}-\d{2}$/.test(q.date ?? '') ? (q.date as string) : today;

  const { lists, venues, programs, answer } = await withSession(async (tx) => {
    const [lists, venues, programs] = await Promise.all([
      listPriceLists(tx),
      listVenues(tx),
      listPrograms(tx),
    ]);
    const answer = q.program
      ? await priceFor(tx, {
          date: checkDate,
          venueId: q.venue || null,
          programId: q.program,
          kind,
          durationMin: q.duration ? Number(q.duration) : undefined,
          sessionsCount: q.sessions ? Number(q.sessions) : undefined,
        })
      : undefined;
    return { lists, venues, programs, answer };
  });
  const venueName = (id: string | null) =>
    id ? (venues.find((v) => v.id === id)?.name ?? '') : t('allVenues');

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t('check.title')}</CardTitle>
          <form method="get" className="flex flex-col gap-3" data-testid="price-check">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t('check.venue')}
                <select name="venue" defaultValue={q.venue ?? ''} className={inputClass}>
                  <option value="">{t('allVenues')}</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t('check.program')}
                <select
                  name="program"
                  defaultValue={q.program ?? programs[0]?.id}
                  className={inputClass}
                >
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nameHe}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t('check.kind')}
                <select name="kind" defaultValue={kind} className={inputClass}>
                  {(await enumOptions('priceKind', PRICE_ITEM_KINDS)).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t('check.date')}
                <input type="date" name="date" defaultValue={checkDate} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t('check.duration')}
                <input
                  type="number"
                  name="duration"
                  defaultValue={q.duration}
                  inputMode="numeric"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t('check.sessions')}
                <input
                  type="number"
                  name="sessions"
                  defaultValue={q.sessions}
                  inputMode="numeric"
                  className={inputClass}
                />
              </label>
            </div>
            <div>
              <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
                {t('check.submit')}
              </button>
            </div>
          </form>
          {answer !== undefined ? (
            <div
              role="status"
              className="mt-3 rounded-xl bg-brand-50 p-3 dark:bg-surface"
              data-testid="price-answer"
            >
              {answer ? (
                <>
                  <p className="text-2xl font-bold">
                    <Money agorot={agorot(answer.amount)} />
                  </p>
                  <p className="text-sm text-ink-muted">
                    {t('check.source', {
                      list: answer.priceListName,
                      from: dmy(answer.effectiveFrom),
                    })}
                  </p>
                </>
              ) : (
                <p>{t('check.none')}</p>
              )}
            </div>
          ) : null}
        </Card>

        <Card>
          <CardTitle>{t('lists')}</CardTitle>
          {lists.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {lists.map((l) => {
                const inEffect =
                  l.status === 'published' &&
                  l.effectiveFrom <= today &&
                  (!l.effectiveTo || l.effectiveTo > today);
                return (
                  <li key={l.id}>
                    <Link
                      href={`/admin/prices/${l.id}`}
                      className="flex items-center justify-between gap-2 rounded-xl border border-line p-3 hover:border-brand-500"
                    >
                      <div>
                        <p className="font-medium">{l.name}</p>
                        <p className="text-sm text-ink-muted">
                          {venueName(l.venueId)} · {t('from', { date: dmy(l.effectiveFrom) })}
                          {l.effectiveTo ? ` · ${t('until', { date: dmy(l.effectiveTo) })}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {inEffect ? <Badge tone="ok">{t('inEffect')}</Badge> : null}
                        <Badge tone={STATUS_TONE[l.status as keyof typeof STATUS_TONE]}>
                          {label('priceListStatus', l.status)}
                        </Badge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('new')}</CardTitle>
          <PriceListForm
            action={createPriceListAction}
            venues={venues}
            submit={t('create')}
            defaults={{ effectiveFrom: today }}
          />
        </Card>
      </div>
    </>
  );
}
