/**
 * Reimbursement profiles and a household's billing details (brief §6.7 receipts): who pays, the payer's ID number
 * (encrypted with the org's data key, ADR-0005; only the last four digits stay readable), the reimbursement mode
 * and the preferred method.
 */
import { z } from 'zod';
import {
  checkbox,
  isValidIsraeliId,
  optionalEmail,
  optionalText,
  PREFERRED_METHODS,
  REIMBURSEMENT_KINDS,
  requiredText,
} from '@rswim/contracts';
import { asc, eq, schema, type Tx } from '@rswim/db';
import { DomainError, encryptField, orgDataKey, type ServiceContext } from '@rswim/domain-core';
import { guarded } from './shared';

const { householdBilling, reimbursementProfiles } = schema;

export const ProfileInput = z.object({
  name: requiredText(100),
  kind: z.enum(REIMBURSEMENT_KINDS),
  wording: requiredText(200),
  requiresNationalId: checkbox(),
  includeSessionDates: checkbox(),
  splitPerMonth: checkbox(),
  active: checkbox().default(true),
});
export type ProfileInput = z.input<typeof ProfileInput>;

export async function listProfiles(tx: Tx) {
  return tx.select().from(reimbursementProfiles).orderBy(asc(reimbursementProfiles.name));
}

export async function saveProfile(
  tx: Tx,
  ctx: ServiceContext,
  raw: ProfileInput,
  id?: string,
): Promise<string> {
  const input = ProfileInput.parse(raw);
  if (id) {
    await guarded(() =>
      tx.update(reimbursementProfiles).set(input).where(eq(reimbursementProfiles.id, id)),
    );
    return id;
  }
  const [row] = await guarded(() =>
    tx
      .insert(reimbursementProfiles)
      .values({ organizationId: ctx.orgId, ...input })
      .returning({ id: reimbursementProfiles.id }),
  );
  return (row as { id: string }).id;
}

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);

export const BillingDetailsInput = z.object({
  householdId: z.uuid(),
  payerName: optionalText(120),
  payerEmail: optionalEmail(),
  /** Blank keeps the ID number on file; "-" removes it. */
  payerNationalId: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .refine((v) => v === '-' || isValidIsraeliId(v), 'forms.errors.nationalId')
      .optional(),
  ),
  reimbursementProfileId: z.preprocess(blank, z.uuid().optional()),
  preferredMethod: z.enum(PREFERRED_METHODS).default('standing_order'),
  notes: optionalText(1000),
});
export type BillingDetailsInput = z.input<typeof BillingDetailsInput>;

/** The household's billing details, without the encrypted ID. */
export async function billingDetailsOf(tx: Tx, householdId: string) {
  const [row] = await tx
    .select({
      id: householdBilling.id,
      householdId: householdBilling.householdId,
      payerName: householdBilling.payerName,
      payerEmail: householdBilling.payerEmail,
      payerIdLast4: householdBilling.payerIdLast4,
      reimbursementProfileId: householdBilling.reimbursementProfileId,
      preferredMethod: householdBilling.preferredMethod,
      notes: householdBilling.notes,
    })
    .from(householdBilling)
    .where(eq(householdBilling.householdId, householdId));
  return row ?? null;
}

export async function saveBillingDetails(tx: Tx, ctx: ServiceContext, raw: BillingDetailsInput) {
  const input = BillingDetailsInput.parse(raw);
  const existing = await billingDetailsOf(tx, input.householdId);
  const id = existing?.id ?? crypto.randomUUID();
  let idFields: { encPayerNationalId?: Buffer | null; payerIdLast4?: string | null } = {};
  if (input.payerNationalId === '-') {
    idFields = { encPayerNationalId: null, payerIdLast4: null };
  } else if (input.payerNationalId) {
    const dek = await orgDataKey(tx, ctx.orgId);
    if (!dek) throw new DomainError('billing.errors.noDataKey');
    const digits = input.payerNationalId.padStart(9, '0');
    idFields = {
      encPayerNationalId: encryptField(dek, digits, {
        table: 'household_billing',
        column: 'enc_payer_national_id',
        rowId: id,
      }),
      payerIdLast4: digits.slice(-4),
    };
  }
  const values = {
    payerName: input.payerName,
    payerEmail: input.payerEmail,
    reimbursementProfileId: input.reimbursementProfileId ?? null,
    preferredMethod: input.preferredMethod,
    notes: input.notes,
    ...idFields,
  };
  if (existing) {
    await guarded(() => tx.update(householdBilling).set(values).where(eq(householdBilling.id, id)));
  } else {
    await guarded(() =>
      tx
        .insert(householdBilling)
        .values({ id, organizationId: ctx.orgId, householdId: input.householdId, ...values }),
    );
  }
  return id;
}
