import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { homePath } from '@/lib/auth/routing';

export default async function Root() {
  const session = await getSession();
  redirect(session ? homePath(session) : '/login');
}
