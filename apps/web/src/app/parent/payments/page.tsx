import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { householdMoney } from '@rswim/domain-billing';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { explainer, money, periodLabel } from '@/lib/billing';
import { ActionForm, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { paymentsOffer } from '@/lib/payments';
import { dmy, enumLabel } from '@/lib/options';
import { myHousehold } from '../family';
import { familyPayAction } from '../pay-actions';

/** The family's money: what they owe, open payment links, the standing order, entries and receipts. */
export default async function ParentPaymentsPage() {
  const t = await getTranslations('money.parent');
  const label = await enumLabel();
  const fmt = await money();
  const explain = await explainer();
  const data = await withSession(async (tx, ctx) => {
    const family = await myHousehold(tx);
    if (!family) return null;
    return { family, money: await householdMoney(tx, family.household.id), orgId: ctx.orgId };
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
  // The school's own processor, when its owner connected one: pay the balance or set up a standing order here.
  const offer = await paymentsOffer(data.orgId);
  const tp = await getTranslations('payments.family');
  const payMethods = (offer ?? []).filter((x) => x !== 'standing_order');
  const canMandate = (offer ?? []).includes('standing_order');

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
          {m.balance > 0 && payMethods.length > 0 && openLinks.length === 0 ? (
            <div className="mt-3 flex flex-col gap-2" data-testid="family-pay">
              {payMethods.map((pm) => (
                <ActionForm key={pm} action={familyPayAction}>
                  <input type="hidden" name="method" value={pm} />
                  <SubmitButton
                    variant={pm === payMethods[0] ? 'primary' : 'secondary'}
                    className="w-full"
                    data-testid={`family-pay-${pm}`}
                  >
                    {tp(`pay.${pm}`, { amount: fmt(m.balance) })}
                  </SubmitButton>
                </ActionForm>
              ))}
            </div>
          ) : null}
          <p className="mt-3 text-sm">
            {mandate
              ? mandate.status === 'failing'
                ? t('mandateFailing')
                : t('mandate', { last4: mandate.cardLast4 ?? '' })
              : t('noMandate')}
          </p>
          {canMandate ? (
            <ActionForm action={familyPayAction} className="mt-2">
              <input type="hidden" name="method" value="standing_order" />
              <input type="hidden" name="purpose" value="mandate" />
              <SubmitButton variant="secondary" className="w-full" data-testid="family-mandate">
                {mandate ? tp('replaceCard') : tp('setupMandate')}
              </SubmitButton>
              <p className="mt-1 text-xs text-ink-muted">{tp('mandateHint')}</p>
            </ActionForm>
          ) : null}
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
                    <Link
                      href={`/parent/receipts/${d.id}`}
                      className="min-h-tap inline-flex items-center py-3 text-brand-700 underline"
                      data-testid="open-receipt"
                    >
                      {t('open')}
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
