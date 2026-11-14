import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { homePath } from '@/lib/auth/routing';
import { isDemoMode } from '@/lib/auth/dev';
import { hostBranding } from './login/login-frame';
import { Landing } from './landing';

/**
 * The front door. Signed in: your home screen. On the live demo or a school's own address: sign-in. Otherwise a
 * visitor on the platform's address sees what Aqua Swim is, its prices, and the way to open a business.
 */
export default async function Root() {
  const session = await getSession();
  if (session) redirect(homePath(session));
  if (isDemoMode() || (await hostBranding())) redirect('/login');
  return <Landing />;
}
