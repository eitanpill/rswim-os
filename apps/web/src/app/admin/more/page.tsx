import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { PlanFeature } from '@rswim/contracts';
import { myFeatures } from '@rswim/domain-platform';
import { Card, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';

const LINKS = [
  'join',
  'onboarding',
  'plan',
  'branding',
  'templates',
  'reports',
  'brain',
  'copilot',
  'messages',
  'transport',
  'cohorts',
  'institutions',
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
  'payroll',
  'substitutes',
  'recruiting',
  'payments',
  'ghl',
] as const;
const HREF: Record<(typeof LINKS)[number], string> = {
  join: '/admin/join',
  onboarding: '/admin/onboarding',
  plan: '/admin/plan',
  branding: '/admin/branding',
  templates: '/admin/templates',
  reports: '/admin/reports',
  brain: '/admin/brain',
  copilot: '/admin/copilot',
  messages: '/admin/messages',
  transport: '/admin/transport',
  cohorts: '/admin/cohorts',
  institutions: '/admin/institutions',
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
  payroll: '/admin/staff/payroll',
  substitutes: '/admin/staff/substitutes',
  recruiting: '/admin/staff/recruiting',
  payments: '/admin/integrations/payments',
  ghl: '/admin/integrations/ghl',
};

/** Screens that exist only on plans that include them. */
const FEATURE: Partial<Record<(typeof LINKS)[number], PlanFeature>> = {
  reports: 'reports',
  brain: 'copilot',
  copilot: 'copilot',
  transport: 'transport',
  cohorts: 'courses',
  institutions: 'institutions',
};

/** Settings and back-office screens that don't earn a place in the bottom bar. */
export default async function MorePage() {
  const t = await getTranslations('admin.more');
  const features = await withSession((tx) => myFeatures(tx));
  const links = LINKS.filter((k) => {
    const f = FEATURE[k];
    return !f || features[f];
  });
  return (
    <>
      <PageHeader title={t('title')} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {links.map((k) => (
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
