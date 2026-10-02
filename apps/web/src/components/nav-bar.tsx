'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BottomNav, SideNav, type NavItem } from '@rswim/ui';

export type NavSpec = Omit<NavItem, 'active'> & { exact?: boolean };

function withActive(items: NavSpec[], pathname: string): NavItem[] {
  return items.map(({ exact, ...item }) => ({
    ...item,
    active: exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`),
  }));
}

export function MobileNav({ items, label }: { items: NavSpec[]; label: string }) {
  return <BottomNav items={withActive(items, usePathname())} Link={Link} label={label} />;
}

export function DesktopNav({ items, label }: { items: NavSpec[]; label: string }) {
  return <SideNav items={withActive(items, usePathname())} Link={Link} label={label} />;
}
