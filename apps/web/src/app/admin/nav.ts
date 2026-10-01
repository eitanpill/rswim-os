import { getTranslations } from 'next-intl/server';
import { icons } from '@/components/icons';
import type { NavSpec } from '@/components/nav-bar';

export const ADMIN_SECTIONS = { families: '1', board: '2', money: '4', more: '1' } as const;

export async function adminNav(): Promise<NavSpec[]> {
  const t = await getTranslations('admin.nav');
  return [
    { href: '/admin', label: t('today'), icon: icons.today, exact: true },
    { href: '/admin/families', label: t('families'), icon: icons.families },
    { href: '/admin/board', label: t('board'), icon: icons.board },
    { href: '/admin/money', label: t('money'), icon: icons.money },
    { href: '/admin/more', label: t('more'), icon: icons.more },
  ];
}
