import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
}

type LinkComponent = (props: {
  href: string;
  className?: string;
  children: ReactNode;
  'aria-current'?: 'page';
}) => ReactNode;

/** Mobile bottom navigation. Large targets, safe-area aware. Hidden from md and up (side nav takes over). */
export function BottomNav({
  items,
  Link,
  label,
}: {
  items: NavItem[];
  Link: LinkComponent;
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface-raised pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs',
                item.active ? 'font-semibold text-brand-600' : 'text-ink-muted',
              )}
            >
              <span aria-hidden className="text-xl leading-none">
                {item.icon}
              </span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Desktop side navigation, on the start (right in RTL) side. */
export function SideNav({
  items,
  Link,
  label,
}: {
  items: NavItem[];
  Link: LinkComponent;
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="hidden w-56 shrink-0 border-e border-line bg-surface-raised p-3 md:block"
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'flex min-h-tap items-center gap-3 rounded-xl px-3',
                item.active
                  ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-surface'
                  : 'text-ink hover:bg-brand-50 dark:hover:bg-surface',
              )}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
