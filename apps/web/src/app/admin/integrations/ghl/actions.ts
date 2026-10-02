'use server';

import { z } from 'zod';
import {
  ghlSettings,
  requestContactImport,
  RSWIM_TAG_MAP,
  saveGhlLocation,
} from '@rswim/domain-crm';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PAGE = '/admin/integrations/ghl';

export async function saveGhlLocationAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({
      locationId: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{6,64}$/, 'crm.errors.locationId'),
    }),
    async (tx, ctx, { locationId }) => {
      const current = await ghlSettings(tx, ctx.orgId);
      // Tenant #1's tag vocabulary is the default; another tenant edits its own map later (Phase 10 settings).
      await saveGhlLocation(tx, ctx, locationId, current?.tagMap ?? RSWIM_TAG_MAP);
    },
    { revalidate: PAGE },
  );
}

export async function requestImportAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx, ctx) => requestContactImport(tx, ctx), {
    revalidate: PAGE,
    success: 'crm.importQueued',
  });
}
