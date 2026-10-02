import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, PageHeader } from '@rswim/ui';

const LINKS = [
  'attendance',
  'makeups',
  'trials',
  'closures',
  'forms',
  'groups',
  'terms',
  'shifts',
  'slots',
  'waitlist',
  'venues',
  'programs',
  'prices',
  'policies',
  'reimbursement',
  'staff',
  'ghl',
] as const;
const HREF: Record<(typeof LINKS)[number], string> = {
  attendance: '/admin/attendance',
  makeups: '/admin/makeups',
  trials: '/admin/trials',
  closures: '/admin/closures',
  forms: '/admin/forms',
  groups: '/admin/groups',
  terms: '/admin/terms',
  shifts: '/admin/shifts',
  slots: '/admin/slots',
  waitlist: '/admin/waitlist',
  venues: '/admin/venues',
  programs: '/admin/programs',
  prices: '/admin/prices',
  policies: '/admin/policies',
  reimbursement: '/admin/reimbursement',
  staff: '/admin/staff',
  ghl: '/admin/integrations/ghl',
};

/** Settings and back-office screens that don't earn a place in the bottom bar. */
export default async function MorePage() {
  const t = await getTranslations('admin.more');
  return (
    <>
      <PageHeader title={t('title')} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {LINKS.map((k) => (
          <li key={k}>
            <Link href={HREF[k]} className="block" data-testid={`more-${k}`}>
              <Card className="hover:border-brand-500">
                <p className="text-lg font-semibold">{t(`${k}.title`)}</p>
                <p className="text-sm text-ink-muted">{t(`${k}.hint`)}</p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
