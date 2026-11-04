import type { ReactNode } from 'react';
import type { CheckoutMethod } from '@rswim/contracts';

/** The payment page's frame: the business's name on top, a narrow column that reads well on a phone. */
export function PayFrame({
  business,
  secure,
  children,
}: {
  business: string | null;
  secure: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <p className="text-lg font-bold" data-testid="pay-business">
          {business ?? ''}
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-3 py-1 text-xs font-semibold text-ok">
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          {secure}
        </span>
      </header>
      {children}
    </main>
  );
}

/** A small mark per way to pay. Bit is drawn as a plain wordmark, not the brand's logo. */
export function MethodIcon({ method }: { method: CheckoutMethod }) {
  const box = 'grid size-9 shrink-0 place-items-center rounded-lg';
  if (method === 'bit')
    return (
      <span className={`${box} bg-[#18b3c4] text-sm font-bold text-white`} aria-hidden="true">
        bit
      </span>
    );
  return (
    <span className={`${box} bg-white/15 ring-1 ring-current/20`} aria-hidden="true">
      {method === 'card' ? (
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18M7 15h3" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" />
          <path d="M18 3v4h-4M6 21v-4h4" />
        </svg>
      )}
    </span>
  );
}
