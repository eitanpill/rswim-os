'use server';

import { z } from 'zod';
import { requestContactImport } from '@rswim/domain-crm';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PAGE = '/admin/integrations/ghl';

export async function requestImportAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx, ctx) => requestContactImport(tx, ctx), {
    revalidate: PAGE,
    success: 'crm.importQueued',
  });
}
