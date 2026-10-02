import { getTranslations } from 'next-intl/server';
import { householdMoney } from '@rswim/domain-billing';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { explainer, money, periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy, enumLabel } from '@/lib/options';
import { myHousehold } from '../family';

/** The family's money: what they owe, open payment links, the standing order, entries and receipts. */
export default async function ParentPaymentsPage() {
  const t = await getTranslations('money.parent');
  const label = await enumLabel();
  const fmt = await money();
  const explain = await explainer();
  const data = await withSession(async (tx) => {
    const family = await myHousehold(tx);
    if (!family) return null;
    return { family, money: await householdMoney(tx, family.household.id) };
  });
  if (!data) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Card>
          <EmptyState title={t('empty')} />
        </Card>
      </>
    );
  }
  const m = data.money;
  const name = new Map(data.family.students.map((s) => [s.id, s.firstName]));
  const openLinks = m.links.filter((l) => l.status === 'open' && l.url);
  const mandate =
    m.mandates.find((x) => x.status === 'active') ?? m.mandates.find((x) => x.status === 'failing');

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="flex flex-col gap-4">
        <Card data-testid="parent-balance">
          <p className="text-sm text-ink-muted">{t('balance')}</p>
          <p
            className={m.balance > 0 ? 'text-2xl font-semibold' : 'text-2xl font-semibold text-ok'}
          >
            {m.balance > 0
              ? t('owes', { amount: fmt(m.balance) })
              : m.balance < 0
                ? t('credit', { amount: fmt(-m.balance) })
                : t('settled')}
          </p>
          {openLinks.map((l) => (
            <a
              key={l.id}
              href={l.url ?? '#'}
              className="mt-3 flex min-h-tap items-center justify-between rounded-xl bg-brand-600 px-4 font-semibold text-white"
            >
              <span>{l.description}</span>
              <span>
                {t('pay')} {fmt(l.amountAgorot)}
              </span>
            </a>
          ))}
          <p className="mt-3 text-sm">
            {mandate
              ? mandate.status === 'failing'
                ? t('mandateFailing')
                : t('mandate', { last4: mandate.cardLast4 ?? '' })
              : t('noMandate')}
          </p>
        </Card>

        <Card>
          <CardTitle>{t('history')}</CardTitle>
          {m.entries.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col text-sm">
              {m.entries.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line py-2"
                >
                  <span>
                    <span className="font-medium">{label('ledgerEntryType', e.type)}</span>{' '}
                    {[
                      e.studentId ? name.get(e.studentId) : null,
                      e.description,
                      e.period ? periodLabel(e.period) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    <span className="block text-xs text-ink-muted">
                      {dmy(e.occurredOn)}
                      {e.explanation ? ` · ${explain(e.explanation)}` : ''}
                    </span>
                  </span>
                  <span className={e.amountAgorot < 0 ? 'text-ok' : undefined}>
                    {fmt(e.amountAgorot)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('documents')}</CardTitle>
          {m.documents.filter((d) => d.status === 'issued').length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col text-sm">
              {m.documents
                .filter((d) => d.status === 'issued')
                .map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2"
                  >
                    <span>
                      {label('fiscalDocumentKind', d.kind)} {d.number}
                      {d.period ? ` · ${periodLabel(d.period)}` : ''} · {fmt(d.totalAgorot)}
                    </span>
                    {d.pdfUrl ? (
                      <a href={d.pdfUrl} className="text-brand-700 underline">
                        <Badge>{t('download')}</Badge>
                      </a>
                    ) : null}
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
