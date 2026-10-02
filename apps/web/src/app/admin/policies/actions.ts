'use server';

import { policyFields, setRule, type PolicyRules } from '@rswim/contracts';
import { createPolicyVersion, PolicyVersionInput, type PolicyScope } from '@rswim/domain-settings';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/**
 * Builds a rules object from the editor's fields (`r:<path>`). A blank field means "not set here", so a venue or
 * program version only carries what it overrides. Multi-selects need their `set:<path>` box outside org scope,
 * because "nothing ticked" is otherwise indistinguishable from "inherit".
 */
function rulesFromForm(raw: Record<string, unknown>, isOrg: boolean): PolicyRules {
  let rules: PolicyRules = {};
  for (const f of policyFields()) {
    const v = raw[`r:${f.path}`];
    let value: unknown;
    if (f.type === 'multi') {
      const set = isOrg || raw[`set:${f.path}`] === 'on';
      value = set ? (Array.isArray(v) ? v : []) : undefined;
    } else if (typeof v === 'string' && v !== '') {
      if (f.type === 'int') {
        const n = Number(v);
        // Shekels and percent in the form, agorot and basis points in the rules.
        value = f.unit === 'agorot' || f.unit === 'bp' ? Math.round(n * 100) : n;
      } else value = f.type === 'boolean' ? v === 'true' : v;
    }
    if (value !== undefined) rules = setRule(rules, f.path, value);
  }
  return rules;
}

export async function createPolicyVersionAction(scope: PolicyScope, _: FormState, fd: FormData) {
  const isOrg = scope.scopeType === 'org';
  return runForm(
    fd,
    PolicyVersionInput,
    (tx, ctx, input) => createPolicyVersion(tx, ctx, scope, input),
    {
      revalidate: '/admin/policies',
      success: 'policies.saved',
      errorField: (path) =>
        path[0] === 'rules' ? `r:${path.slice(1).join('.')}` : String(path[0] ?? '_'),
    },
    (raw) => ({
      effectiveFrom: raw.effectiveFrom,
      notes: raw.notes,
      rules: rulesFromForm(raw, isOrg),
    }),
  );
}
