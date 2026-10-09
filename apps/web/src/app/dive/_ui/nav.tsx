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
