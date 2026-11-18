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
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line/70 bg-surface-raised/90 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-16px_oklch(30%_0.05_240/0.3)] backdrop-blur-md md:hidden"
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
                'group flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs transition-colors active:scale-95',
                item.active ? 'font-semibold text-brand-700' : 'text-ink-muted hover:text-ink',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'grid h-7 w-12 place-items-center rounded-full text-xl leading-none transition-all duration-200',
                  item.active
                    ? 'bg-brand-100 text-brand-700 dark:bg-surface'
                    : 'group-hover:bg-brand-50 dark:group-hover:bg-surface',
                )}
              >
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
                'flex min-h-tap items-center gap-3 rounded-xl px-3 transition-colors',
                item.active
                  ? 'bg-brand-600 font-semibold text-white shadow-[0_6px_16px_-8px_var(--color-brand-600)]'
                  : 'text-ink hover:bg-brand-50 dark:hover:bg-surface',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'grid size-7 place-items-center rounded-lg',
                  item.active ? 'bg-white/20' : 'bg-brand-50 text-brand-700 dark:bg-surface',
                )}
              >
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
