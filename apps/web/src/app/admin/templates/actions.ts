'use server';

import { z } from 'zod';
import { installTemplate, shareTemplate, ShareTemplateInput } from '@rswim/domain-platform';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PAGE = '/admin/templates';

export async function installTemplateAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid() }),
    (tx, ctx, { id }) => installTemplate(tx, ctx, id),
    { revalidate: PAGE, success: 'platform.templates.installed' },
  );
}

export async function shareTemplateAction(_: FormState, fd: FormData) {
  return runForm(fd, ShareTemplateInput, (tx, ctx, input) => shareTemplate(tx, ctx, input), {
    revalidate: PAGE,
    success: 'platform.templates.shared',
  });
}
