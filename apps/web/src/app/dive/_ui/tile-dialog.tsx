'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@rswim/ui';

/**
 * A tile that opens its details in a dialog: a sheet from the bottom on phones, a centred window on wider screens.
 * The details are rendered on the server and stay in the page, so the desk's forms inside work as usual and the
 * dialog stays open while they refresh the page.
 */
export function TileDialog({
  tile,
  title,
  closeLabel,
  children,
  className,
  style,
  testId,
}: {
  tile: ReactNode;
  title: string;
  closeLabel: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <div data-testid={testId} className="min-w-0">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => ref.current?.showModal()}
        className={cn(
          'block h-full w-full rounded-2xl text-start transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dive-sea)]',
          className,
        )}
        style={style}
        data-testid="tile-open"
      >
        {tile}
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        // A click on the backdrop (the dialog element itself, outside its panel) closes it.
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-3xl border-0 bg-transparent p-0 backdrop:bg-[color-mix(in_oklch,var(--dive-abyss)_55%,transparent)] backdrop:backdrop-blur-[2px] sm:m-auto sm:max-h-[88dvh] sm:max-w-3xl sm:rounded-3xl"
        data-testid="tile-dialog"
      >
        <div className="flex max-h-[inherit] flex-col bg-surface-raised text-ink">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <p className="truncate font-semibold">{title}</p>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label={closeLabel}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line text-lg leading-none hover:bg-[color-mix(in_oklch,var(--ink)_6%,transparent)]"
              data-testid="tile-close"
            >
              ×
            </button>
          </div>
          <div className="overflow-y-auto overscroll-contain">{children}</div>
        </div>
      </dialog>
    </div>
  );
}
