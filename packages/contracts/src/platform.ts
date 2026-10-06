import { z } from 'zod';
import { PolicyRules } from './policy';
import { PRICE_ITEM_KINDS, PROGRAM_KINDS } from './catalog';
import { TEMPLATE_KEYS } from './comms';

/** Phase 10: what a school pays for (plans), its subscription, its domains and the shared template marketplace. */

/** Surfaces a plan may include (the brief's per-tenant feature flags). */
export const PLAN_FEATURES = ['reports', 'courses', 'transport', 'institutions', 'copilot'] as const;
export const PlanFeature = z.enum(PLAN_FEATURES);
export type PlanFeature = z.infer<typeof PlanFeature>;

/** What a plan limits; null in a plan = unlimited. */
export const PLAN_LIMITS = ['students', 'staff', 'venues'] as const;
export type PlanLimit = (typeof PLAN_LIMITS)[number];

/** trialing → active → past_due → suspended (or cancelled). */
export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
] as const;
export const SubscriptionStatus = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const PLATFORM_INVOICE_STATUSES = ['open', 'paid', 'failed', 'void'] as const;
export type PlatformInvoiceStatus = (typeof PLATFORM_INVOICE_STATUSES)[number];

export const DOMAIN_STATUSES = ['pending', 'verified', 'failed'] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

/**
 * Brand colours come from a fixed set of hues (OKLCH), so a school can look like itself without any free-form CSS.
 * The keys are i18n names (`enums.brandHue.*`).
 */
export const BRAND_HUES = {
  sea: 225,
  turquoise: 195,
  green: 150,
  orange: 55,
  coral: 25,
  pink: 350,
  purple: 300,
} as const;
export type BrandHueKey = keyof typeof BRAND_HUES;
export const BRAND_HUE_KEYS = Object.keys(BRAND_HUES) as BrandHueKey[];

export const Branding = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  hue: z.enum(BRAND_HUE_KEYS as [BrandHueKey, ...BrandHueKey[]]).optional(),
});
export type Branding = z.infer<typeof Branding>;

// ─── Template marketplace ───────────────────────────────────────────────────

export const TEMPLATE_KINDS = ['regulations', 'catalog', 'messages'] as const;
export const TemplateKind = z.enum(TEMPLATE_KINDS);
export type TemplateKind = z.infer<typeof TemplateKind>;

/** draft → submitted → published | rejected. Only published templates are offered to other schools. */
export const TEMPLATE_STATUSES = ['draft', 'submitted', 'published', 'rejected'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

const Code = z.string().regex(/^[a-z0-9_-]{2,40}$/);

export const CatalogTemplate = z
  .object({
    programs: z
      .array(
        z.object({
          code: Code,
          kind: z.enum(PROGRAM_KINDS),
          nameHe: z.string().min(1).max(80),
          nameEn: z.string().max(80).nullable().default(null),
          defaultDurationMin: z.int().min(5).max(240),
          defaultCapacity: z.int().min(1).max(100),
          minAgeMonths: z.int().min(0).max(1200).nullable().default(null),
          maxAgeMonths: z.int().min(0).max(1200).nullable().default(null),
          parentInWater: z.boolean().default(false),
          levels: z
            .array(z.object({ code: Code, nameHe: z.string().min(1).max(80) }))
            .max(20)
            .default([]),
        }),
      )
      .min(1)
      .max(40),
    prices: z
      .array(
        z.object({
          program: Code,
          kind: z.enum(PRICE_ITEM_KINDS),
          durationMin: z.int().min(5).max(240).nullable().default(null),
          sessionsCount: z.int().min(1).max(200).nullable().default(null),
          amountAgorot: z.int().min(0).max(10_000_000),
          label: z.string().max(80).nullable().default(null),
        }),
      )
      .max(200)
      .default([]),
  })
  .strict();
export type CatalogTemplate = z.infer<typeof CatalogTemplate>;

export const MessagesTemplate = z
  .object({
    messages: z
      .array(
        z.object({
          key: z.enum(TEMPLATE_KEYS),
          locale: z.enum(['he', 'en']),
          body: z.string().min(2).max(2000),
        }),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type MessagesTemplate = z.infer<typeof MessagesTemplate>;

export const RegulationsTemplate = z.object({ rules: PolicyRules }).strict();
export type RegulationsTemplate = z.infer<typeof RegulationsTemplate>;

export const TEMPLATE_PAYLOADS = {
  regulations: RegulationsTemplate,
  catalog: CatalogTemplate,
  messages: MessagesTemplate,
} as const;
export type TemplatePayload = {
  regulations: RegulationsTemplate;
  catalog: CatalogTemplate;
  messages: MessagesTemplate;
};
