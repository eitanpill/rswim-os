/**
 * What a family would read, before anything is sent: the Venue Migration Wizard shows each child's message filled
 * from the organization's own template, addressed to the household's first guardian.
 */
import { guardiansOfHouseholds } from '@rswim/domain-people';
import type { MigrationNotice } from '@rswim/domain-scheduling';
import type { Tx } from '@rswim/db';
import type { ServiceContext } from '@rswim/domain-core';
import { migrationNoticeVars, renderTemplate } from '../policies';
import { schoolName } from './outbound';
import { ensureCommsDefaults, templateFor } from './templates';

export interface MessagePreview {
  studentId: string;
  guardianName: string | null;
  /** null when the template cannot be filled (it shows which variables are missing). */
  text: string | null;
  missing: string[];
}

export async function previewMigrationMessages(
  tx: Tx,
  ctx: ServiceContext,
  notices: readonly MigrationNotice[],
): Promise<MessagePreview[]> {
  if (notices.length === 0) return [];
  await ensureCommsDefaults(tx, ctx.orgId);
  const guardians = await guardiansOfHouseholds(tx, [
    ...new Set(notices.map((n) => n.householdId)),
  ]);
  const school = await schoolName(tx, ctx.orgId);
  const bodies = new Map<string, string>();
  const out: MessagePreview[] = [];
  for (const n of notices) {
    const g = guardians.find((x) => x.householdId === n.householdId) ?? null;
    const locale = g?.locale === 'en' ? 'en' : 'he';
    if (!bodies.has(locale)) {
      bodies.set(locale, (await templateFor(tx, 'venue_migration', locale))?.body ?? '');
    }
    const r = renderTemplate(bodies.get(locale) as string, {
      guardian_name: g?.firstName,
      school_name: school,
      ...migrationNoticeVars(n, locale),
    });
    out.push({
      studentId: n.studentId,
      guardianName: g ? `${g.firstName} ${g.lastName}` : null,
      text: r.ok ? r.text : null,
      missing: r.ok ? [] : r.missing,
    });
  }
  return out;
}
