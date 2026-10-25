'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@rswim/ui';

export function DiveNav({
  items,
  label,
}: {
  items: { href: string; label: string; icon: ReactNode }[];
  label: string;
}) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
      {items.map((i) => {
        const active = path === i.href || path.startsWith(`${i.href}/`);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-t-xl px-3.5 py-2.5 text-sm transition-colors [&_svg]:size-[18px]',
              active
                ? 'bg-[var(--surface)] font-semibold text-ink'
                : 'text-white/75 hover:bg-white/10 hover:text-white',
            )}
          >
            {i.icon}
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The phone's tab bar: the same screens, under the thumb. Shown below the md breakpoint only. */
export function DiveBottomNav({
  items,
  label,
}: {
  items: { href: string; label: string; icon: ReactNode }[];
  label: string;
}) {
  const path = usePathname();
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[color-mix(in_oklch,var(--dive-abyss)_92%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden print:hidden"
      data-testid="bottom-nav"
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map((i) => {
          const active = path === i.href || path.startsWith(`${i.href}/`);
          return (
            <li key={i.href} className="flex-1">
              <Link
                href={i.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] [&_svg]:size-[22px]',
                  active ? 'font-semibold text-[var(--dive-shallow)]' : 'text-white/60',
                )}
              >
                <span
                  className={cn(
                    'inline-flex rounded-full px-3 py-0.5 transition-colors',
                    active && 'bg-white/12',
                  )}
                >
                  {i.icon}
                </span>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
