'use server';

import {
  collectAnswers,
  FormDraftInput,
  publishForm,
  recordFile,
  ReviewInput,
  reviewHealth,
  saveFormDraft,
  SignFormInput,
  signForm,
  TemplateRef,
} from '@rswim/domain-dive';
import type { ServiceContext } from '@rswim/domain-core';
import type { Tx } from '@rswim/db';
import { chosenFile, storeUpload, type DivePurpose } from '@/lib/dive-files';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/**
 * Forms in the club: a diver signs on their phone (or on the desk's tablet, for the diver the desk names), the office
 * clears a health declaration that waits for it, and the owner or manager edits and publishes the texts.
 */
const PAGES = ['/dive/me', '/dive/me/forms', '/dive/forms', '/dive/divers', '/dive/office'];

async function attach(
  tx: Tx,
  ctx: ServiceContext,
  file: File | null,
  purpose: DivePurpose,
): Promise<string | undefined> {
  if (!file) return undefined;
  const stored = await storeUpload(ctx.orgId, file, purpose);
  return recordFile(tx, ctx, { ...stored, purpose });
}

export async function signFormAction(_: FormState, fd: FormData) {
  const kind = String(fd.get('kind') ?? '');
  const file = chosenFile(fd, 'document');
  const desk = String(fd.get('diverId') ?? '') !== '';
  return runForm(
    fd,
    SignFormInput,
    async (tx, ctx, input) => {
      const fileId = await attach(
        tx,
        ctx,
        file,
        kind === 'insurance' ? 'dive_insurance' : 'dive_medical',
      );
      const signed = await signForm(tx, ctx, { ...input, fileId });
      return { ...signed, diverId: input.diverId };
    },
    {
      revalidate: PAGES,
      redirectTo: (r) =>
        desk
          ? `/dive/divers/${r.diverId}?signed=${r.kind}`
          : `/dive/me/forms?signed=${r.kind}${r.review === 'pending' ? '&pending=1' : ''}`,
    },
    (raw) => collectAnswers(raw, ['kind', 'document']),
  );
}

export async function reviewAction(_: FormState, fd: FormData) {
  const file = chosenFile(fd, 'document');
  return runForm(
    fd,
    ReviewInput,
    async (tx, ctx, input) => {
      const fileId = await attach(tx, ctx, file, 'dive_medical');
      await reviewHealth(tx, ctx, { ...input, fileId });
      return input.decision;
    },
    {
      revalidate: PAGES,
      success: (d, tr) => tr(`dive.done.review.${d}`),
    },
    (raw) =>
      Object.fromEntries(Object.entries(raw).filter(([k, v]) => k !== 'document' && v !== '')),
  );
}

export async function saveDraftAction(_: FormState, fd: FormData) {
  return runForm(fd, FormDraftInput, (tx, ctx, i) => saveFormDraft(tx, ctx, i), {
    revalidate: ['/dive/forms'],
    success: 'dive.done.draftSaved',
  });
}

export async function publishFormAction(_: FormState, fd: FormData) {
  return runForm(fd, TemplateRef, (tx, ctx, i) => publishForm(tx, ctx, i), {
    revalidate: PAGES,
    success: 'dive.done.formPublished',
  });
}
