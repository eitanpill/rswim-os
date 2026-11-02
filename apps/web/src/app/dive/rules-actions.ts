'use server';

import { RulesInput, saveRules } from '@rswim/domain-dive';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/** The owner or the manager saves the club's rules as a version from a date (the database checks settings.write). */
export async function saveRulesAction(_: FormState, fd: FormData) {
  return runForm(fd, RulesInput, (tx, ctx, input) => saveRules(tx, ctx, input), {
    revalidate: ['/dive/rules', '/dive/manager', '/dive/owner', '/dive/office', '/dive/instructor'],
    success: 'dive.rules.saved',
  });
}
