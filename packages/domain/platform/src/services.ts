/**
 * Phase 10 SaaS services. A school's own screens (plan, branding, domains, templates, onboarding) run as its signed-in
 * owner under RLS; billing and domain checks run in the worker as `rswim_system` for one school; the platform console
 * runs as a platform admin through security-definer functions that check `platform_admins`.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  Branding,
  DEFAULT_ORG_RULES,
  PLAN_FEATURES,
  TemplateKind,
  type PlanFeature,
  type SubscriptionStatus,
  type TemplateKind as TemplateKindT,
  type TemplatePayload,
} from '@rswim/contracts';
import { and, asc, desc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { ensureCommsDefaults, updateTemplate } from '@rswim/domain-comms';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import {
  addLevel,
  createPolicyVersion,
  createPriceList,
  createProgram,
  LevelInput,
  listPolicyVersions,
  ProgramInput,
  savePriceItem,
} from '@rswim/domain-settings';
import type { DnsResolver, PaymentProvider } from '@rswim/integrations';
import {
  billingPeriod,
  catalogProblems,
  chargeDecision,
  dnsVerified,
  featureEnabled,
  invoiceFor,
  normalizeHost,
  onboardingChecklist,
  parseTemplate,
  planChangeCheck,
  subscriptionAfterCharge,
  subscriptionOnDay,
  usageOf,
  verificationRecord,
  type PlanFacts,
  type SubscriptionFacts,
  type Usage,
} from './policies';

const {
  plans,
  orgSubscriptions,
  platformInvoices,
  orgDomains,
  templates,
  templateInstalls,
  orgSettings,
  featureFlags,
  programs,
  priceLists,
  messageTemplates,
  policySets,
} = schema;

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

export async function todayIL(tx: Tx): Promise<string> {
  const [r] = await rows<{ d: string }>(tx, sql`select app.today()::text as d`);
  return (r as { d: string }).d;
}

// ─── Plans and the school's subscription ────────────────────────────────────

const planFacts = (p: typeof plans.$inferSelect): PlanFacts => ({
  code: p.code,
  priceAgorot: p.priceAgorot,
  maxStudents: p.maxStudents,
  maxStaff: p.maxStaff,
  maxVenues: p.maxVenues,
  features: p.features,
  graceDays: p.graceDays,
});

export async function listPlans(tx: Tx) {
  return tx
    .select()
    .from(plans)
    .where(eq(plans.active, true))
    .orderBy(asc(plans.sortOrder), asc(plans.priceAgorot));
}

/** The current school's subscription with its plan, or null (a school without one has no limits). */
export async function mySubscription(tx: Tx) {
  const [r] = await tx
    .select({ sub: orgSubscriptions, plan: plans })
    .from(orgSubscriptions)
    .innerJoin(plans, eq(plans.code, orgSubscriptions.planCode))
    .limit(1);
  return r ?? null;
}

/** What the current school uses against its limits (counted the way the database trigger counts). */
export async function myUsage(tx: Tx): Promise<Usage> {
  const [r] = await rows<{ students: number; staff: number; venues: number }>(
    tx,
    sql`select (select count(*)::int from students) students,
               (select count(*)::int from staff_members where status = 'active') staff,
               (select count(*)::int from venues where status <> 'closed') venues`,
  );
  return r as Usage;
}

/** The surfaces the current school's plan includes (with its own feature flags). */
export async function myFeatures(tx: Tx): Promise<Record<PlanFeature, boolean>> {
  const s = await mySubscription(tx);
  const flags = await tx
    .select({ key: featureFlags.key, enabled: featureFlags.enabled })
    .from(featureFlags);
  return Object.fromEntries(
    PLAN_FEATURES.map((f) => [f, featureEnabled(s ? s.plan.features : null, flags, f)]),
  ) as Record<PlanFeature, boolean>;
}

export async function hasFeature(tx: Tx, f: PlanFeature) {
  return (await myFeatures(tx))[f];
}

/** Everything the plan page shows: plan, status, usage against limits and the platform's invoices. */
export async function myPlanPage(tx: Tx) {
  const s = await mySubscription(tx);
  const usage = await myUsage(tx);
  const invoices = await tx
    .select()
    .from(platformInvoices)
    .orderBy(desc(platformInvoices.period))
    .limit(24);
  return {
    subscription: s?.sub ?? null,
    plan: s?.plan ?? null,
    usage: usageOf(usage, s ? planFacts(s.plan) : null),
    invoices,
    plans: await listPlans(tx),
  };
}

/** Banner and lock state for the school's office: past due warns, suspended locks the office to its plan page. */
export async function accountState(tx: Tx): Promise<{
  status: SubscriptionStatus | null;
  trialEndsOn: string | null;
  locked: boolean;
}> {
  const s = await mySubscription(tx);
  return {
    status: (s?.sub.status as SubscriptionStatus | undefined) ?? null,
    trialEndsOn: s?.sub.trialEndsOn ?? null,
    locked: s?.sub.status === 'suspended',
  };
}

// ─── Sign-up and onboarding ─────────────────────────────────────────────────

export const CreateSchoolInput = z.object({
  name: z.string().trim().min(2, 'platform.errors.schoolName').max(80, 'platform.errors.schoolName'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/, 'platform.errors.slug'),
  plan: z.string().min(1),
});
export type CreateSchoolInput = z.input<typeof CreateSchoolInput>;

/** Creates the school with the caller as owner (a signed-in user, no school claim needed). Returns its id. */
export async function createSchool(tx: Tx, raw: CreateSchoolInput): Promise<string> {
  const input = CreateSchoolInput.parse(raw);
  const [r] = await rows<{ id: string }>(
    tx,
    sql`select public.create_school(${input.name}, ${input.slug}, ${input.plan}) as id`,
  );
  return (r as { id: string }).id;
}

/** The defaults inside a new school, added as its new owner through the ordinary services. */
export async function provisionSchool(tx: Tx, ctx: ServiceContext) {
  await ensureCommsDefaults(tx, ctx.orgId);
}

/** The onboarding checklist, from what the school already has. */
export async function onboardingStatus(tx: Tx) {
  const [f] = await rows<{
    venues: number;
    programs: number;
    lists: number;
    domains: number;
    staff: number;
    invites: number;
    versions: number;
    regulations: number;
    messages: number;
  }>(
    tx,
    sql`select (select count(*)::int from venues where status <> 'closed') venues,
               (select count(*)::int from programs where active) programs,
               (select count(*)::int from price_lists where status = 'published') lists,
               (select count(*)::int from org_domains where status = 'verified') domains,
               (select count(*)::int from staff_members where status = 'active') staff,
               (select count(*)::int from staff_invites where accepted_at is null and revoked_at is null) invites,
               (select count(*)::int from policy_sets) versions,
               (select count(*)::int from template_installs i join templates t on t.id = i.template_id
                 where t.kind = 'regulations') regulations,
               (select count(*)::int from template_installs i join templates t on t.id = i.template_id
                 where t.kind = 'messages') messages`,
  );
  const branding = await myBranding(tx);
  const facts = f as NonNullable<typeof f>;
  return onboardingChecklist({
    regulations: facts.regulations > 0 || facts.versions > 0,
    venues: facts.venues,
    programs: facts.programs,
    publishedPriceLists: facts.lists,
    branded: Boolean(branding.hue),
    verifiedDomains: facts.domains,
    messages:
      facts.messages > 0 ||
      (
        await rows<{ n: number }>(
          tx,
          sql`select count(*)::int n from message_templates where updated_by is not null`,
        )
      )[0]!.n > 0,
    staff: facts.staff + facts.invites,
  });
}

// ─── Branding and domains ───────────────────────────────────────────────────

/** The school's name and colours, for every member (the app shell). */
export async function myBranding(tx: Tx): Promise<Branding & { name?: string }> {
  const [r] = await rows<{ b: (Branding & { name?: string }) | null }>(
    tx,
    sql`select public.my_branding() b`,
  );
  return r?.b ?? {};
}

/** Before sign-in: the name and colours of the school a verified host belongs to, or null. */
export async function brandingForHost(tx: Tx, host: string) {
  const [r] = await rows<{ b: (Branding & { name: string; slug: string }) | null }>(
    tx,
    sql`select public.branding_for_host(${host.toLowerCase().replace(/:\d+$/, '')}) b`,
  );
  return r?.b ?? null;
}

export const BrandingInput = z.object({
  displayName: z.string().trim().min(2, 'platform.errors.displayName').max(60),
  hue: Branding.shape.hue.unwrap(),
});
export type BrandingInput = z.input<typeof BrandingInput>;

export async function saveBranding(tx: Tx, ctx: ServiceContext, raw: BrandingInput) {
  const input = BrandingInput.parse(raw);
  const [s] = await tx
    .select({ branding: orgSettings.branding })
    .from(orgSettings)
    .where(eq(orgSettings.organizationId, ctx.orgId));
  if (!s) throw new DomainError('common.errors.forbidden');
  await tx
    .update(orgSettings)
    .set({ branding: { ...(s.branding as object), ...input } })
    .where(eq(orgSettings.organizationId, ctx.orgId));
}

export async function listDomains(tx: Tx) {
  const list = await tx.select().from(orgDomains).orderBy(asc(orgDomains.createdAt));
  return list.map((d) => ({ ...d, record: verificationRecord(d.host), value: `rswim-verify=${d.token}` }));
}

/** Hosts schools may not claim (the platform's own), from RSWIM_PLATFORM_HOSTS. */
export const platformHosts = () =>
  (process.env.RSWIM_PLATFORM_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

export async function addDomain(tx: Tx, ctx: ServiceContext, input: string) {
  const n = normalizeHost(input, platformHosts());
  if (!n.ok) throw new DomainError(n.code);
  const token = randomBytes(12).toString('hex');
  try {
    await tx.insert(orgDomains).values({ organizationId: ctx.orgId, host: n.host, token });
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === '23505') {
      throw new DomainError('platform.errors.hostTaken');
    }
    throw e;
  }
  const [d] = await tx.select({ id: orgDomains.id }).from(orgDomains).where(eq(orgDomains.host, n.host));
  await requestDomainCheck(tx, ctx, (d as { id: string }).id);
  return (d as { id: string }).id;
}

/** Asks the worker to look up the domain's TXT record now. */
export async function requestDomainCheck(tx: Tx, ctx: ServiceContext, domainId: string) {
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'platform.domain_check_requested',
    payload: { domainId },
    idempotencyKey: `platform.domain_check_requested:${domainId}:${Date.now()}`,
  });
}

export async function removeDomain(tx: Tx, domainId: string) {
  await tx.delete(orgDomains).where(eq(orgDomains.id, domainId));
}

/** Worker: checks one domain's TXT record and records the outcome. A host not yet set up stays pending. */
export async function verifyDomain(tx: Tx, domainId: string, dns: DnsResolver) {
  const [d] = await tx.select().from(orgDomains).where(eq(orgDomains.id, domainId));
  if (!d) return null;
  if (d.status === 'verified') return 'verified';
  let records: string[][] = [];
  try {
    records = await dns.resolveTxt(verificationRecord(d.host));
  } catch {
    records = [];
  }
  const ok = dnsVerified(records, d.token);
  await tx
    .update(orgDomains)
    .set({
      status: ok ? 'verified' : 'pending',
      checkedAt: new Date(),
      verifiedAt: ok ? new Date() : null,
    })
    .where(eq(orgDomains.id, domainId));
  return ok ? 'verified' : 'pending';
}

/** Worker: pending domains of the current school, for the daily re-check. */
export async function pendingDomainIds(tx: Tx) {
  return (
    await tx.select({ id: orgDomains.id }).from(orgDomains).where(eq(orgDomains.status, 'pending'))
  ).map((d) => d.id);
}

// ─── Platform billing (worker, one school) ──────────────────────────────────

const subFacts = (s: typeof orgSubscriptions.$inferSelect): SubscriptionFacts => ({
  planCode: s.planCode,
  status: s.status as SubscriptionStatus,
  trialEndsOn: s.trialEndsOn,
  mandateId: s.mandateId,
  pastDueSince: s.pastDueSince,
});

async function setSubscription(
  tx: Tx,
  orgId: string,
  change: { status: SubscriptionStatus; pastDueSince: string | null },
) {
  await tx
    .update(orgSubscriptions)
    .set(change)
    .where(eq(orgSubscriptions.organizationId, orgId));
}

/** Worker, daily: ends trials and suspends schools past their grace days. */
export async function subscriptionDailyStep(tx: Tx, ctx: ServiceContext, today: string) {
  const s = await mySubscription(tx);
  if (!s) return null;
  const change = subscriptionOnDay(subFacts(s.sub), planFacts(s.plan), today);
  if (change.changed) await setSubscription(tx, ctx.orgId, change);
  return change;
}

export type BillOutcome =
  | { billed: false; reason: string }
  | { billed: true; invoiceId: string; status: 'paid' | 'failed' | 'open'; code: string | null };

/**
 * Worker: issues the school's invoice for a month (at most one per month) and charges its mandate. Idempotent: a paid
 * invoice is never charged again, and each attempt has its own idempotency key with the provider.
 */
export async function billSchool(
  tx: Tx,
  ctx: ServiceContext,
  period: string,
  payments: PaymentProvider | null,
  today: string,
): Promise<BillOutcome> {
  if (period !== billingPeriod(period)) throw new DomainError('platform.errors.period');
  const s = await mySubscription(tx);
  if (!s) return { billed: false, reason: 'noSubscription' };
  const sub = subFacts(s.sub);
  let [invoice] = await tx
    .select()
    .from(platformInvoices)
    .where(eq(platformInvoices.period, period));
  if (!invoice) {
    const due = invoiceFor(sub, planFacts(s.plan));
    if (!due.bill) return { billed: false, reason: due.reason };
    [invoice] = await tx
      .insert(platformInvoices)
      .values({
        organizationId: ctx.orgId,
        period,
        planCode: due.planCode,
        amountAgorot: due.amountAgorot,
      })
      .returning();
  }
  const inv = invoice as typeof platformInvoices.$inferSelect;
  const decision = chargeDecision(inv, sub.mandateId);
  if (!decision.charge) {
    if (decision.code) {
      await tx
        .update(platformInvoices)
        .set({ status: 'failed', failureCode: decision.code })
        .where(eq(platformInvoices.id, inv.id));
      const change = subscriptionAfterCharge(sub, 'failed', today);
      if (change.changed) await setSubscription(tx, ctx.orgId, change);
      return { billed: true, invoiceId: inv.id, status: 'failed', code: decision.code };
    }
    return { billed: true, invoiceId: inv.id, status: inv.status as 'paid', code: null };
  }
  if (!payments) return { billed: true, invoiceId: inv.id, status: 'open', code: 'platform.errors.noProvider' };
  const attempt = inv.attempts + 1;
  const result = await payments.chargeStandingOrder(
    { organizationId: ctx.orgId, idempotencyKey: `platform:${ctx.orgId}:${period}:${attempt}` },
    {
      mandateId: sub.mandateId as string,
      amount: inv.amountAgorot as never,
      description: `R-SWIM OS ${s.plan.nameHe} ${period.slice(0, 7)}`,
    },
  );
  const status = result.status === 'succeeded' ? 'paid' : result.status === 'failed' ? 'failed' : 'open';
  await tx
    .update(platformInvoices)
    .set({
      status,
      attempts: attempt,
      externalPaymentId: result.externalPaymentId,
      failureCode: status === 'failed' ? (result.failureReason ?? 'declined') : null,
      paidAt: status === 'paid' ? new Date() : null,
    })
    .where(eq(platformInvoices.id, inv.id));
  if (status !== 'open') {
    const change = subscriptionAfterCharge(sub, status, today);
    if (change.changed) await setSubscription(tx, ctx.orgId, change);
  }
  return {
    billed: true,
    invoiceId: inv.id,
    status,
    code: status === 'failed' ? 'platform.errors.declined' : null,
  };
}

// ─── Template marketplace ───────────────────────────────────────────────────

/** Published templates plus the school's own submissions. */
export async function listTemplates(tx: Tx) {
  const list = await tx
    .select()
    .from(templates)
    .orderBy(asc(templates.kind), asc(templates.name));
  const installs = await tx
    .select({ templateId: templateInstalls.templateId, at: templateInstalls.createdAt })
    .from(templateInstalls)
    .orderBy(desc(templateInstalls.createdAt));
  return list.map((t) => ({
    ...t,
    installedAt: installs.find((i) => i.templateId === t.id)?.at ?? null,
  }));
}

/**
 * Installs a published template into the school through the ordinary services. Regulations become a policy version
 * from today; a catalog adds the programs the school lacks (by code) and a draft price list for review; messages
 * replace the wording of matching templates, checked like any edit.
 */
export async function installTemplate(tx: Tx, ctx: ServiceContext, templateId: string) {
  const [t] = await tx
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.status, 'published')));
  if (!t) throw new DomainError('common.errors.notFound');
  const kind = TemplateKind.parse(t.kind);
  const parsed = parseTemplate(kind, t.payload);
  if (!parsed.ok) throw new DomainError(parsed.code);
  const today = await todayIL(tx);
  let result: Record<string, unknown>;
  if (kind === 'regulations') {
    result = await installRegulations(tx, ctx, parsed.payload as TemplatePayload['regulations'], t.name, today);
  } else if (kind === 'catalog') {
    result = await installCatalog(tx, ctx, parsed.payload as TemplatePayload['catalog'], t.name, today);
  } else {
    result = await installMessages(tx, ctx, parsed.payload as TemplatePayload['messages']);
  }
  await tx.insert(templateInstalls).values({
    organizationId: ctx.orgId,
    templateId,
    installedBy: ctx.userId,
    result,
  });
  return result;
}

async function installRegulations(
  tx: Tx,
  ctx: ServiceContext,
  p: TemplatePayload['regulations'],
  name: string,
  today: string,
) {
  const scope = { scopeType: 'org' as const };
  const taken = new Set((await listPolicyVersions(tx, scope)).map((v) => v.effectiveFrom));
  let from = today;
  // A version already starting today (say, edited by hand this morning): start tomorrow instead.
  while (taken.has(from)) {
    from = new Date(Date.parse(`${from}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  const id = await createPolicyVersion(tx, ctx, scope, {
    effectiveFrom: from,
    rules: p.rules,
    notes: name,
  });
  return { policySetId: id, effectiveFrom: from };
}

async function installCatalog(
  tx: Tx,
  ctx: ServiceContext,
  p: TemplatePayload['catalog'],
  name: string,
  today: string,
) {
  const problems = catalogProblems(p);
  if (problems.length) throw new DomainError('platform.errors.badTemplate');
  const existing = await tx.select({ id: programs.id, code: programs.code }).from(programs);
  const ids = new Map(existing.map((x) => [x.code, x.id]));
  const added: string[] = [];
  for (const [i, prog] of p.programs.entries()) {
    if (ids.has(prog.code)) continue;
    const id = await createProgram(
      tx,
      ctx,
      ProgramInput.parse({
        code: prog.code,
        kind: prog.kind,
        nameHe: prog.nameHe,
        nameEn: prog.nameEn ?? '',
        defaultDurationMin: prog.defaultDurationMin,
        defaultCapacity: prog.defaultCapacity,
        minAgeMonths: prog.minAgeMonths ?? '',
        maxAgeMonths: prog.maxAgeMonths ?? '',
        parentInWater: prog.parentInWater,
        active: true,
      }),
    );
    await tx.update(programs).set({ sortOrder: i }).where(eq(programs.id, id));
    for (const l of prog.levels) {
      await addLevel(tx, ctx, id, LevelInput.parse({ code: l.code, nameHe: l.nameHe, skills: '' }));
    }
    ids.set(prog.code, id);
    added.push(prog.code);
  }
  const priceListId = await createPriceList(tx, ctx, {
    name,
    venueId: null,
    effectiveFrom: today,
    notes: null,
  });
  for (const price of p.prices) {
    await savePriceItem(tx, ctx, priceListId, {
      programId: ids.get(price.program) as string,
      kind: price.kind,
      durationMin: price.durationMin,
      sessionsCount: price.sessionsCount,
      amountAgorot: price.amountAgorot,
      label: price.label,
    });
  }
  return { programsAdded: added, priceListId };
}

async function installMessages(tx: Tx, ctx: ServiceContext, p: TemplatePayload['messages']) {
  await ensureCommsDefaults(tx, ctx.orgId);
  const mine = await tx.select().from(messageTemplates);
  const updated: string[] = [];
  for (const m of p.messages) {
    const t = mine.find((x) => x.key === m.key && x.locale === m.locale);
    if (!t) continue;
    await updateTemplate(tx, ctx, {
      id: t.id,
      body: m.body,
      active: t.active,
      ghlTemplateId: t.ghlTemplateId,
    });
    updated.push(`${m.key}:${m.locale}`);
  }
  return { templatesUpdated: updated };
}

export const ShareTemplateInput = z.object({
  kind: TemplateKind,
  name: z.string().trim().min(2, 'platform.errors.templateName').max(80),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => v || null)
    .nullable()
    .default(null),
});
export type ShareTemplateInput = z.input<typeof ShareTemplateInput>;

/** What the school would share: its current org-wide regulations, catalog with today's prices, or message wording. */
export async function currentAsTemplate(tx: Tx, kind: TemplateKindT): Promise<unknown> {
  if (kind === 'regulations') {
    const [v] = await tx
      .select({ rules: policySets.rules })
      .from(policySets)
      .where(eq(policySets.scopeType, 'org'))
      .orderBy(desc(policySets.effectiveFrom))
      .limit(1);
    return { rules: v?.rules ?? DEFAULT_ORG_RULES };
  }
  if (kind === 'messages') {
    const list = await tx.select().from(messageTemplates).where(eq(messageTemplates.active, true));
    return { messages: list.map((m) => ({ key: m.key, locale: m.locale, body: m.body })) };
  }
  const progs = await tx.select().from(programs).where(eq(programs.active, true)).orderBy(asc(programs.sortOrder));
  const lvls = progs.length
    ? await tx
        .select()
        .from(schema.levels)
        .where(inArray(schema.levels.programId, progs.map((x) => x.id)))
        .orderBy(asc(schema.levels.ordinal))
    : [];
  const [list] = await tx
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(and(eq(priceLists.status, 'published'), sql`${priceLists.venueId} is null`))
    .orderBy(desc(priceLists.effectiveFrom))
    .limit(1);
  const items = list
    ? await tx.select().from(schema.priceItems).where(eq(schema.priceItems.priceListId, list.id))
    : [];
  const code = new Map(progs.map((x) => [x.id, x.code]));
  return {
    programs: progs.map((x) => ({
      code: x.code,
      kind: x.kind,
      nameHe: x.nameHe,
      nameEn: x.nameEn,
      defaultDurationMin: x.defaultDurationMin,
      defaultCapacity: x.defaultCapacity,
      minAgeMonths: x.minAgeMonths,
      maxAgeMonths: x.maxAgeMonths,
      parentInWater: x.parentInWater,
      levels: lvls.filter((l) => l.programId === x.id).map((l) => ({ code: l.code, nameHe: l.nameHe })),
    })),
    prices: items
      .filter((i) => code.has(i.programId))
      .map((i) => ({
        program: code.get(i.programId) as string,
        kind: i.kind,
        durationMin: i.durationMin,
        sessionsCount: i.sessionsCount,
        amountAgorot: i.amountAgorot,
        label: i.label,
      })),
  };
}

/** The owner shares the school's current setup as a template; a platform admin reviews it before anyone sees it. */
export async function shareTemplate(tx: Tx, ctx: ServiceContext, raw: ShareTemplateInput) {
  const input = ShareTemplateInput.parse(raw);
  const parsed = parseTemplate(input.kind, await currentAsTemplate(tx, input.kind));
  if (!parsed.ok) throw new DomainError(parsed.code);
  await tx.insert(templates).values({
    kind: input.kind,
    status: 'submitted',
    name: input.name,
    description: input.description,
    payload: parsed.payload,
    sourceOrganizationId: ctx.orgId,
    createdBy: ctx.userId,
  });
}

// ─── Platform console (platform admins) ─────────────────────────────────────

export interface SchoolRow {
  organizationId: string;
  name: string;
  slug: string;
  orgStatus: string;
  planCode: string | null;
  status: SubscriptionStatus | null;
  trialEndsOn: string | null;
  pastDueSince: string | null;
  mandateId: string | null;
  students: number;
  staff: number;
  venues: number;
  lastPeriod: string | null;
  lastStatus: string | null;
  lastAmount: number | null;
}

export async function listSchools(tx: Tx): Promise<SchoolRow[]> {
  const list = await rows<Record<string, unknown>>(
    tx,
    sql`select organization_id, name, slug, org_status, plan_code, status, trial_ends_on::text, past_due_since::text,
               mandate_id, students::int, staff::int, venues::int, last_period::text, last_status, last_amount
        from public.platform_schools()`,
  );
  return list.map((r) => ({
    organizationId: r.organization_id as string,
    name: r.name as string,
    slug: r.slug as string,
    orgStatus: r.org_status as string,
    planCode: (r.plan_code as string | null) ?? null,
    status: (r.status as SubscriptionStatus | null) ?? null,
    trialEndsOn: (r.trial_ends_on as string | null) ?? null,
    pastDueSince: (r.past_due_since as string | null) ?? null,
    mandateId: (r.mandate_id as string | null) ?? null,
    students: r.students as number,
    staff: r.staff as number,
    venues: r.venues as number,
    lastPeriod: (r.last_period as string | null) ?? null,
    lastStatus: (r.last_status as string | null) ?? null,
    lastAmount: (r.last_amount as number | null) ?? null,
  }));
}

export const SchoolUpdateInput = z.object({
  organizationId: z.uuid(),
  action: z.enum(['plan', 'endTrial', 'suspend', 'reactivate', 'mandate']),
  planCode: z.string().optional(),
  mandateId: z
    .string()
    .trim()
    .max(120)
    .transform((v) => v || null)
    .nullable()
    .optional(),
});
export type SchoolUpdateInput = z.input<typeof SchoolUpdateInput>;

/** A platform admin changes a school's plan, ends its trial, suspends or reactivates it, or records its mandate. */
export async function updateSchool(tx: Tx, raw: SchoolUpdateInput, today: string) {
  const input = SchoolUpdateInput.parse(raw);
  await assertPlatformAdmin(tx);
  const where = eq(orgSubscriptions.organizationId, input.organizationId);
  const [sub] = await tx.select().from(orgSubscriptions).where(where);
  if (!sub) throw new DomainError('platform.errors.noSubscription');
  switch (input.action) {
    case 'plan': {
      const [plan] = await tx.select().from(plans).where(eq(plans.code, input.planCode ?? ''));
      if (!plan) throw new DomainError('platform.errors.plan');
      const usage = (await listSchools(tx)).find((s) => s.organizationId === input.organizationId);
      const check = planChangeCheck(
        { students: usage?.students ?? 0, staff: usage?.staff ?? 0, venues: usage?.venues ?? 0 },
        planFacts(plan),
      );
      if (!check.ok) throw new DomainError(check.code, check.params);
      await tx.update(orgSubscriptions).set({ planCode: plan.code }).where(where);
      return;
    }
    case 'endTrial':
      if (sub.status !== 'trialing') throw new DomainError('platform.errors.notTrialing');
      await tx
        .update(orgSubscriptions)
        .set({ status: 'active', trialEndsOn: today })
        .where(where);
      return;
    case 'suspend':
      await tx
        .update(orgSubscriptions)
        .set({ status: 'suspended', pastDueSince: sub.pastDueSince ?? today })
        .where(where);
      return;
    case 'reactivate':
      await tx
        .update(orgSubscriptions)
        .set({ status: 'active', pastDueSince: null })
        .where(where);
      return;
    default:
      await tx
        .update(orgSubscriptions)
        .set({ mandateId: input.mandateId ?? null })
        .where(where);
  }
}

/** A platform admin asks the worker to bill every school due this month. Returns how many schools were queued. */
export async function requestBilling(tx: Tx, period: string) {
  const [r] = await rows<{ n: number }>(tx, sql`select public.platform_request_billing(${period}::date) n`);
  return (r as { n: number }).n;
}

async function assertPlatformAdmin(tx: Tx) {
  const [r] = await rows<{ ok: boolean }>(tx, sql`select app.is_platform_admin() ok`);
  if (!r?.ok) throw new DomainError('common.errors.forbidden');
}

export async function listSubmittedTemplates(tx: Tx) {
  return tx
    .select()
    .from(templates)
    .where(eq(templates.status, 'submitted'))
    .orderBy(asc(templates.createdAt));
}

export async function reviewTemplate(
  tx: Tx,
  ctx: { userId: string | null },
  id: string,
  decision: 'published' | 'rejected',
) {
  await assertPlatformAdmin(tx);
  const [t] = await tx.select().from(templates).where(eq(templates.id, id));
  if (!t || t.status !== 'submitted') throw new DomainError('platform.errors.notSubmitted');
  if (decision === 'published') {
    const parsed = parseTemplate(TemplateKind.parse(t.kind), t.payload);
    if (!parsed.ok) throw new DomainError(parsed.code);
  }
  await tx
    .update(templates)
    .set({ status: decision, reviewedBy: ctx.userId, reviewedAt: new Date() })
    .where(eq(templates.id, id));
}
