'use server';

import { z } from 'zod';
import {
  addDomain,
  BrandingInput,
  removeDomain,
  requestDomainCheck,
  saveBranding,
} from '@rswim/domain-platform';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PAGE = '/admin/branding';
const Id = z.object({ id: z.uuid() });
const Host = z.object({ host: z.string().trim().min(1, 'platform.errors.host') });

export async function saveBrandingAction(_: FormState, fd: FormData) {
  return runForm(fd, BrandingInput, (tx, ctx, input) => saveBranding(tx, ctx, input), {
    revalidate: PAGE,
  });
}

export async function addDomainAction(_: FormState, fd: FormData) {
  return runForm(fd, Host, (tx, ctx, { host }) => addDomain(tx, ctx, host), {
    revalidate: PAGE,
    success: 'platform.branding.domainAdded',
  });
}

export async function checkDomainAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, ctx, { id }) => requestDomainCheck(tx, ctx, id), {
    revalidate: PAGE,
    success: 'platform.branding.checkRequested',
  });
}

export async function removeDomainAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => removeDomain(tx, id), { revalidate: PAGE });
}
