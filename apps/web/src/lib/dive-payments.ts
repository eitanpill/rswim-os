import 'server-only';
import { isDemoMode } from './auth/dev';

/** The diver's online checkout runs on the payment fake (local, E2E, the live demo) until the club's Grow is live. */
export function fakeCheckout(): boolean {
  return process.env.RSWIM_GROW_FAKE === '1' || isDemoMode();
}
