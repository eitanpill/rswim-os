/**
 * Pure SaaS rules (docs/POLICIES.md §18): what a plan allows, how a subscription moves with the calendar and with
 * each charge, what a school is billed, how far its onboarding is, its brand colours, its host name and the shape
 * of a template. No literals of price or limits here: those live in the `plans` rows.
 */
import {
  BRAND_HUES,
  PLAN_LIMITS,
  TEMPLATE_PAYLOADS,
  type BrandHueKey,
  type PlanFeature,
  type PlanLimit,
  type SubscriptionStatus,
  type TemplateKind,
  type TemplatePayload,
} from '@rswim/contracts';

export interface PlanFacts {
  code: string;
  priceAgorot: number;
  maxStudents: number | null;
  maxStaff: number | null;
  maxVenues: number | null;
  features: string[];
  graceDays: number;
}

export interface SubscriptionFacts {
  planCode: string;
  status: SubscriptionStatus;
  trialEndsOn: string | null;
  mandateId: string | null;
  pastDueSince: string | null;
}

export type Usage = Record<PlanLimit, number>;

// ─── Limits and features ────────────────────────────────────────────────────

export interface UsageLine {
  limit: PlanLimit;
  used: number;
  max: number | null;
  /** 0–100, null when unlimited. */
  pct: number | null;
  full: boolean;
}

const maxOf = (plan: PlanFacts, l: PlanLimit) =>
  l === 'students' ? plan.maxStudents : l === 'staff' ? plan.maxStaff : plan.maxVenues;

/** How much of each limit a school uses. No plan (a school without a subscription) means no limits. */
export function usageOf(usage: Usage, plan: PlanFacts | null): UsageLine[] {
  return PLAN_LIMITS.map((limit) => {
    const max = plan ? maxOf(plan, limit) : null;
    const used = usage[limit];
    return {
      limit,
      used,
      max,
      pct: max === null ? null : max === 0 ? 100 : Math.min(100, Math.round((used * 100) / max)),
      full: max !== null && used >= max,
    };
  });
}

/**
 * Whether a surface is on for a school: its plan's features, overridden by the school's own feature flags (set by the
 * platform for a pilot or a custom deal). A school without a subscription has every feature.
 */
export function featureEnabled(
  planFeatures: readonly string[] | null,
  flags: readonly { key: string; enabled: boolean }[],
  feature: PlanFeature,
): boolean {
  const flag = flags.find((f) => f.key === `feature.${feature}`);
  if (flag) return flag.enabled;
  return planFeatures === null || planFeatures.includes(feature);
}

/** A plan change the school's current size allows; a downgrade below what it already uses is refused. */
export function planChangeCheck(
  usage: Usage,
  plan: PlanFacts,
):
  | { ok: true }
  | { ok: false; code: string; params: { limit: PlanLimit; used: number; max: number } } {
  for (const line of usageOf(usage, plan)) {
    if (line.max !== null && line.used > line.max) {
      return {
        ok: false,
        code: 'platform.errors.tooBigForPlan',
        params: { limit: line.limit, used: line.used, max: line.max },
      };
    }
  }
  return { ok: true };
}

// ─── The subscription over time ─────────────────────────────────────────────

export type SubscriptionChange = Pick<SubscriptionFacts, 'status' | 'pastDueSince'> & {
  changed: boolean;
  reason: string | null;
};

const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The daily step: a trial ends the day after `trialEndsOn`; a school past due for `graceDays` is suspended.
 * Everything else stays as it is.
 */
export function subscriptionOnDay(
  sub: SubscriptionFacts,
  plan: PlanFacts,
  today: string,
): SubscriptionChange {
  const same = { status: sub.status, pastDueSince: sub.pastDueSince, changed: false, reason: null };
  if (sub.status === 'trialing' && sub.trialEndsOn !== null && today > sub.trialEndsOn) {
    return { status: 'active', pastDueSince: null, changed: true, reason: 'trialEnded' };
  }
  if (
    sub.status === 'past_due' &&
    sub.pastDueSince !== null &&
    today >= addDays(sub.pastDueSince, plan.graceDays)
  ) {
    return {
      status: 'suspended',
      pastDueSince: sub.pastDueSince,
      changed: true,
      reason: 'graceOver',
    };
  }
  return same;
}

/** After a charge: paid clears any arrears (and lifts a suspension); declined starts (or keeps) the grace clock. */
export function subscriptionAfterCharge(
  sub: SubscriptionFacts,
  outcome: 'paid' | 'failed',
  today: string,
): SubscriptionChange {
  if (outcome === 'paid') {
    const owed = sub.status === 'past_due' || sub.status === 'suspended';
    return {
      status: owed ? 'active' : sub.status,
      pastDueSince: null,
      changed: owed,
      reason: owed ? 'paid' : null,
    };
  }
  if (sub.status === 'suspended') {
    return { status: 'suspended', pastDueSince: sub.pastDueSince, changed: false, reason: null };
  }
  return {
    status: 'past_due',
    pastDueSince: sub.pastDueSince ?? today,
    changed: sub.status !== 'past_due',
    reason: 'declined',
  };
}

// ─── Billing ────────────────────────────────────────────────────────────────

/** The first day of the month a date falls in. */
export const billingPeriod = (date: string) => `${date.slice(0, 7)}-01`;

/**
 * What a school owes the platform for a month, billed in advance: the plan's price, once the trial is over. A free
 * plan, a trial, a suspension or a cancellation bills nothing.
 */
export function invoiceFor(
  sub: SubscriptionFacts,
  plan: PlanFacts,
): { bill: true; amountAgorot: number; planCode: string } | { bill: false; reason: string } {
  if (sub.status === 'trialing') return { bill: false, reason: 'trialing' };
  if (sub.status === 'suspended' || sub.status === 'cancelled') {
    return { bill: false, reason: sub.status };
  }
  if (plan.priceAgorot === 0) return { bill: false, reason: 'free' };
  return { bill: true, amountAgorot: plan.priceAgorot, planCode: plan.code };
}

/** Whether to charge an invoice now: never a paid or voided one, and not without a payment method. */
export function chargeDecision(
  invoice: { status: string },
  mandateId: string | null,
): { charge: true } | { charge: false; code: string | null } {
  if (invoice.status === 'paid' || invoice.status === 'void') return { charge: false, code: null };
  if (!mandateId) return { charge: false, code: 'platform.errors.noMandate' };
  return { charge: true };
}

// ─── Onboarding ─────────────────────────────────────────────────────────────

export interface OnboardingFacts {
  regulations: boolean;
  venues: number;
  programs: number;
  publishedPriceLists: number;
  branded: boolean;
  verifiedDomains: number;
  messages: boolean;
  staff: number;
}

export const ONBOARDING_STEPS = [
  'regulations',
  'venue',
  'catalog',
  'branding',
  'messages',
  'domain',
  'staff',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Optional steps: the school is ready without its own domain or staff invited. */
const OPTIONAL: readonly OnboardingStep[] = ['domain', 'staff'];

/** The new school's checklist, computed from what exists (nothing stored). Ready once every required step is done. */
export function onboardingChecklist(f: OnboardingFacts) {
  const done: Record<OnboardingStep, boolean> = {
    regulations: f.regulations,
    venue: f.venues > 0,
    catalog: f.programs > 0 && f.publishedPriceLists > 0,
    branding: f.branded,
    messages: f.messages,
    domain: f.verifiedDomains > 0,
    staff: f.staff > 0,
  };
  const steps = ONBOARDING_STEPS.map((step) => ({
    step,
    done: done[step],
    optional: OPTIONAL.includes(step),
  }));
  const required = steps.filter((s) => !s.optional);
  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    ready: required.every((s) => s.done),
  };
}

// ─── Brand ──────────────────────────────────────────────────────────────────

/**
 * The brand colour scale for a hue, as the design tokens the UI already uses. Lightness and chroma stay those of the
 * default theme, so contrast holds for every school.
 */
export function brandPalette(hue: BrandHueKey | undefined | null): Record<string, string> {
  if (!hue) return {};
  const h = BRAND_HUES[hue];
  return {
    '--color-brand-50': `oklch(97% 0.02 ${h})`,
    '--color-brand-100': `oklch(93% 0.04 ${h})`,
    '--color-brand-500': `oklch(62% 0.13 ${h})`,
    '--color-brand-600': `oklch(54% 0.13 ${h})`,
    '--color-brand-700': `oklch(46% 0.12 ${h})`,
  };
}

// ─── Domains ────────────────────────────────────────────────────────────────

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** A host name as typed ("https://Swim.Example.co.il/login") → "swim.example.co.il", or why not. */
export function normalizeHost(
  input: string,
  platformHosts: readonly string[] = [],
): { ok: true; host: string } | { ok: false; code: string } {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
  if (!HOST.test(host) || host.length > 253) return { ok: false, code: 'platform.errors.host' };
  if (/^\d+(\.\d+){3}$/.test(host)) return { ok: false, code: 'platform.errors.host' };
  if (platformHosts.some((p) => host === p || host.endsWith(`.${p}`))) {
    return { ok: false, code: 'platform.errors.hostReserved' };
  }
  return { ok: true, host };
}

/** The DNS record that proves a school controls a host. */
export const verificationRecord = (host: string) => `_rswim.${host}`;

/** Whether any TXT record (each possibly split into chunks) carries the token. */
export const dnsVerified = (records: readonly (readonly string[])[], token: string) =>
  records.some((chunks) => chunks.join('').trim() === `rswim-verify=${token}`);

// ─── Templates ──────────────────────────────────────────────────────────────

/** Validates a template's payload for its kind; an off-shape payload is refused rather than repaired. */
export function parseTemplate<K extends TemplateKind>(
  kind: K,
  payload: unknown,
): { ok: true; payload: TemplatePayload[K] } | { ok: false; code: string } {
  const r = TEMPLATE_PAYLOADS[kind].safeParse(payload);
  return r.success
    ? { ok: true, payload: r.data as TemplatePayload[K] }
    : { ok: false, code: 'platform.errors.badTemplate' };
}

/** A catalog's prices must point at programs it defines. */
export function catalogProblems(c: TemplatePayload['catalog']): string[] {
  const codes = new Set(c.programs.map((p) => p.code));
  return [...new Set(c.prices.filter((p) => !codes.has(p.program)).map((p) => p.program))];
}
