'use client';

import { useFormResult } from '@/components/form';

/** The terms checkbox, with its error under it like any other field. */
export function TermsField({ label }: { label: string }) {
  const error = useFormResult().errors.terms;
  return (
    <div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="terms"
          className="mt-0.5 size-5"
          aria-invalid={Boolean(error)}
          data-testid="signup-terms"
        />
        <span>{label}</span>
      </label>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-danger" data-testid="signup-terms-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
