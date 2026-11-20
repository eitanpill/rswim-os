'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { setNewPasswordAction } from '../password-actions';

type FromLink = { access: string; refresh: string } | 'none' | 'failed' | null;

/**
 * The reset link brings its one-time session in the address's fragment (`#access_token=…&refresh_token=…`), which
 * never reaches the server. Read it here, wipe it from the address bar, and send it with the new password.
 */
export function ResetForm({
  labels,
}: {
  labels: { password: string; hint: string; submit: string; expired: string; again: string };
}) {
  const [link, setLink] = useState<FromLink>(null);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access = hash.get('access_token');
    const refresh = hash.get('refresh_token');
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    if (hash.get('error') || hash.get('error_code')) setLink('failed');
    else if (access && refresh) setLink({ access, refresh });
    else setLink('none');
  }, []);

  if (link === null) return null;
  if (link === 'failed')
    return (
      <div className="flex flex-col gap-3" data-testid="reset-expired">
        <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {labels.expired}
        </p>
        <Link href="/login/forgot" className="text-center font-medium text-brand-600">
          {labels.again}
        </Link>
      </div>
    );
  return (
    <ActionForm action={setNewPasswordAction} testId="reset-password">
      {typeof link === 'object' ? (
        <>
          <input type="hidden" name="access_token" value={link.access} />
          <input type="hidden" name="refresh_token" value={link.refresh} />
        </>
      ) : null}
      <Field
        name="password"
        label={labels.password}
        hint={labels.hint}
        type="password"
        autoComplete="new-password"
        dir="ltr"
        required
      />
      <SubmitButton size="full">{labels.submit}</SubmitButton>
    </ActionForm>
  );
}
