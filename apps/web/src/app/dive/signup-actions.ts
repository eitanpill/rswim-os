'use server';

import {
  CertInput,
  CertReviewInput,
  MyDetailsInput,
  recordFile,
  reviewCert,
  submitCert,
  updateMyDetails,
} from '@rswim/domain-dive';
import { chosenFile, storeUpload } from '@/lib/dive-files';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

/**
 * A new diver's first steps (their emergency contact, their certification cards) and the desk's check of every card.
 */
const PAGES = ['/dive/me', '/dive/me/welcome', '/dive/me/certs', '/dive/forms', '/dive/divers'];

const dropEmpty = (drop: string[]) => (raw: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(raw).filter(([k, v]) => v !== '' && !drop.includes(k)));

export async function myDetailsAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    MyDetailsInput,
    (tx, _ctx, input) => updateMyDetails(tx, input),
    {
      revalidate: PAGES,
      success: 'dive.done.detailsSaved',
    },
    dropEmpty([]),
  );
}

export async function submitCertAction(_: FormState, fd: FormData) {
  const file = chosenFile(fd, 'document');
  const desk = String(fd.get('diverId') ?? '') !== '';
  return runForm(
    fd,
    CertInput,
    async (tx, ctx, input) => {
      let fileId: string | undefined;
      if (file) {
        const stored = await storeUpload(ctx.orgId, file, 'dive_cert');
        fileId = await recordFile(tx, ctx, { ...stored, purpose: 'dive_cert' });
      }
      return submitCert(tx, ctx, { ...input, fileId });
    },
    {
      revalidate: PAGES,
      success: (c, tr) =>
        tr(desk || c.status === 'verified' ? 'dive.done.certRecorded' : 'dive.done.certSent'),
    },
    dropEmpty(['document']),
  );
}

export async function reviewCertAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    CertReviewInput,
    async (tx, ctx, input) => {
      await reviewCert(tx, ctx, input);
      return input.decision;
    },
    { revalidate: PAGES, success: (d, tr) => tr(`dive.done.cert.${d}`) },
    dropEmpty([]),
  );
}
