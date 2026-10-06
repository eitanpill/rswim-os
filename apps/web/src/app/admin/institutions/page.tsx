import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { institutionDebts, listInstitutions } from '@rswim/domain-institutions';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, SubmitButton } from '@/components/form';
import { money, periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { enumLabel } from '@/lib/options';
import { createInstitutionAction } from './actions';
import { InstitutionFields } from './fields';

/**
 * Institutions that pay for their children's swimming (brief §6.11): who they are, what they owe, and which invoices
 * are late.
 */
export default async function InstitutionsPage() {
  const t = await getTranslations('institutions');
  const label = await enumLabel();
  const fmt = await money();
  const { list, debts } = await withSession(async (tx) => ({
    list: await listInstitutions(tx),
    debts: await institutionDebts(tx),
  }));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <div className="flex flex-col gap-4">
        <Card data-testid="institution-debts">
          <CardTitle>{t('debts.title')}</CardTitle>
          <p>
            {t('debts.line', { owed: fmt(debts.owedAgorot), overdue: fmt(debts.overdueAgorot) })}
          </p>
          {debts.invoices.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {debts.invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap justify-between gap-2">
                  <Link href={`/admin/institutions/${i.institutionId}`} className="underline">
                    {i.institutionName} · {periodLabel(i.period)}
                  </Link>
                  <span>
                    {fmt(i.balance.balanceAgorot)}{' '}
                    <Badge tone={i.balance.state === 'overdue' ? 'danger' : 'warn'}>
                      {label('institutionInvoiceState', i.balance.state)}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
        {list.length === 0 ? (
          <Card>
            <EmptyState title={t('empty')} />
          </Card>
        ) : (
          list.map((i) => (
            <Card key={i.id} data-testid="institution">
              <CardTitle aside={<Badge tone="neutral">{label('institutionKind', i.kind)}</Badge>}>
                <Link href={`/admin/institutions/${i.id}`} className="hover:underline">
                  {i.name}
                </Link>
              </CardTitle>
              {i.contactName ? (
                <p className="text-sm text-ink-muted">
                  {i.contactName} <span dir="ltr">{i.contactPhone ?? ''}</span>
                </p>
              ) : null}
            </Card>
          ))
        )}
        <Card>
          <CardTitle>{t('add')}</CardTitle>
          <ActionForm action={createInstitutionAction} testId="institution-form">
            <InstitutionFields />
            <div>
              <SubmitButton>{t('create')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
