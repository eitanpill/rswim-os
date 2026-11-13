'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { FormState } from '@/lib/form-state';
import { joinPathFromLink } from '@/lib/join-link';

/** The link a school sent, pasted in: open the place it leads to inside the app. */
export async function openSchoolLinkAction(_: FormState, fd: FormData): Promise<FormState> {
  const path = joinPathFromLink(String(fd.get('link') ?? ''));
  if (!path) {
    const t = await getTranslations('start.link');
    return { ok: false, errors: { link: t('invalid') }, message: null };
  }
  redirect(path);
}
