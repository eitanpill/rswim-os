'use server';

import { ProfileInput, saveProfile } from '@rswim/domain-billing';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

export async function saveProfileAction(id: string | null, _: FormState, fd: FormData) {
  return runForm(
    fd,
    ProfileInput,
    (tx, ctx, input) => saveProfile(tx, ctx, input, id ?? undefined),
    {
      revalidate: '/admin/reimbursement',
    },
  );
}
