/**
 * The product's own name and home (docs/saas/DECISIONS.md, decision 1). Every place the platform names itself reads
 * these: the browser title, the app shell when a school has no name yet, "powered by", platform invoices and exports.
 * A school's own name and branding (org_settings.branding) always win inside the school.
 */
export const PRODUCT = {
  name: 'Aqua Swim',
  domain: 'aqua-swim.co.il',
  supportEmail: 'support@aqua-swim.co.il',
} as const;
