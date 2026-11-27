import { headers } from 'next/headers';
import { isNativeApp } from './native-app';

/** Whether this request comes from the store app (server components and actions only). */
export async function inNativeApp(): Promise<boolean> {
  return isNativeApp((await headers()).get('user-agent'));
}
