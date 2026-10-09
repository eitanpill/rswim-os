import { redirect } from 'next/navigation';
import { requireSurface } from '@/lib/auth/session';
import { diveRole, HOME } from './_ui/access';

/** Everyone lands on their own screen: owner the bridge, manager ops, office the desk, instructor the water. */
export default async function DiveHome() {
  const session = await requireSurface('dive');
  redirect(`/dive/${HOME[diveRole(session)]}`);
}
