import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { PlanFeature } from '@rswim/contracts';
import { myFeatures } from '@rswim/domain-platform';
import { PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { inNativeApp } from '@/lib/native-app-server';

const LINKS = [
  'leads',
  'lodging',
  'connections',
  'import',
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
  'receipts',
  'whatsapp',
  'ghl',
] as const;
const HREF: Record<(typeof LINKS)[number], string> = {
  leads: '/admin/leads',
  lodging: '/admin/lodging',
  connections: '/admin/connections',
  import: '/admin/import',
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
  receipts: '/admin/integrations/receipts',
  whatsapp: '/admin/integrations/whatsapp',
  ghl: '/admin/integrations/ghl',
};

/** Screens that exist only on plans that include them. */
const FEATURE: Partial<Record<(typeof LINKS)[number], PlanFeature>> = {
  reports: 'reports',
  copilot: 'copilot',
  transport: 'transport',
  cohorts: 'courses',
  institutions: 'institutions',
};

const ICON: Record<(typeof LINKS)[number], string> = {
  leads: '🙋',
  lodging: '🛏️',
  connections: '🔌',
  import: '📥',
  join: '🔗',
  onboarding: '🚀',
  plan: '⭐',
  branding: '🎨',
  templates: '💬',
  reports: '📊',
  brain: '🧠',
  copilot: '🤖',
  messages: '📨',
  transport: '🚐',
  cohorts: '🏕️',
  institutions: '🏫',
  attendance: '✅',
  makeups: '🔄',
  trials: '🐣',
  closures: '🚧',
  forms: '✍️',
  groups: '👥',
  terms: '📆',
  shifts: '🔁',
  slots: '🧑‍🏫',
  waitlist: '⏳',
  venues: '🏊',
  programs: '📚',
  prices: '🏷️',
  policies: '📜',
  reimbursement: '↩️',
  staff: '🪪',
  payroll: '💵',
  substitutes: '🙋',
  recruiting: '🌱',
  payments: '💳',
  receipts: '🧾',
  whatsapp: '💬',
  ghl: '📇',
};

/** The same screens, grouped the way an owner thinks about the business. */
const SECTIONS: { key: string; links: (typeof LINKS)[number][] }[] = [
  {
    key: 'daily',
    links: [
      'leads',
      'lodging',
      'messages',
      'attendance',
      'makeups',
      'trials',
      'waitlist',
      'closures',
      'forms',
      'transport',
    ],
  },
  {
    key: 'schedule',
    links: ['groups', 'slots', 'shifts', 'terms', 'cohorts', 'institutions', 'venues', 'programs'],
  },
  { key: 'team', links: ['staff', 'payroll', 'substitutes', 'recruiting'] },
  { key: 'money', links: ['prices', 'policies', 'reimbursement', 'payments', 'receipts', 'plan'] },
  { key: 'smart', links: ['brain', 'copilot', 'reports'] },
  {
    key: 'business',
    links: [
      'onboarding',
      'branding',
      'templates',
      'join',
      'import',
      'connections',
      'whatsapp',
      'ghl',
    ],
  },
];

/** Settings and back-office screens that don't earn a place in the bottom bar. */
export default async function MorePage() {
  const t = await getTranslations('admin.more');
  const features = await withSession((tx) => myFeatures(tx));
  // The subscription is managed on the website only, never in the store app (store stage 8).
  const app = await inNativeApp();
  const allowed = (k: (typeof LINKS)[number]) => {
    if (!LINKS.includes(k)) return false;
    if (app && k === 'plan') return false;
    const f = FEATURE[k];
    return !f || features[f];
  };
  return (
    <>
      <PageHeader icon="🧭" title={t('title')} />
      <div className="flex flex-col gap-6">
        {SECTIONS.map((section) => {
          const links = section.links.filter(allowed);
          if (links.length === 0) return null;
          return (
            <section key={section.key} aria-labelledby={`more-${section.key}`}>
              <h2
                id={`more-${section.key}`}
                className="mb-2 text-sm font-semibold tracking-wide text-ink-muted"
              >
                {t(`sections.${section.key}`)}
              </h2>
              <ul className="stagger grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {links.map((k) => (
                  <li key={k}>
                    <Link
                      href={HREF[k]}
                      className="lift flex h-full flex-col gap-1 rounded-2xl border border-line/70 bg-surface-raised p-3 shadow-[var(--shadow-soft)] hover:border-brand-500"
                      data-testid={`more-${k}`}
                    >
                      <span
                        aria-hidden
                        className="grid size-10 place-items-center rounded-xl bg-brand-50 text-xl"
                      >
                        {ICON[k]}
                      </span>
                      <span className="font-semibold leading-tight">{t(`${k}.title`)}</span>
                      <span className="line-clamp-2 text-xs text-ink-muted">{t(`${k}.hint`)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
