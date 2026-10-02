import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { searchHouseholds } from '@rswim/domain-people';
import { buttonVariants, Card, EmptyState, PageHeader } from '@rswim/ui';
import { inputClass } from '@/components/form';
import { withSession } from '@/lib/db';

export default async function FamiliesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const t = await getTranslations('families');
  const rows = await withSession((tx) => searchHouseholds(tx, q));
  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Link href="/admin/families/new" className={buttonVariants()}>
            {t('new')}
          </Link>
        }
      />
      <form method="get" role="search" className="mb-4 flex gap-2">
        <label htmlFor="family-q" className="sr-only">
          {t('search')}
        </label>
        <input
          id="family-q"
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
      {rows.length === 0 ? (
        <Card>
          <EmptyState title={q ? t('noMatch') : t('empty')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((h) => (
            <li key={h.id}>
              <Link href={`/admin/families/${h.id}`} className="block">
                <Card className="hover:border-brand-500">
                  <p className="font-semibold">{h.displayName}</p>
                  <p className="text-sm text-ink-muted">
                    {h.guardians.map((g) => g.firstName).join(', ')}
                    {h.students.length
                      ? ` · ${t('children', { names: h.students.map((s) => s.firstName).join(', ') })}`
                      : ''}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
