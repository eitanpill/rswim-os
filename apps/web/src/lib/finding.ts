import 'server-only';
import {
  myJoinRequests,
  myPhoneMatches,
  type MyJoinRequest,
  type PhoneMatch,
} from '@rswim/domain-platform';
import { fromEveryDatabase, withSignedIn } from './db';

/**
 * What the front door shows someone with no school yet (store launch, stage 4): the schools that already have their
 * phone on a family's file, and the join requests they sent.
 */
export async function myFindings(): Promise<{ matches: PhoneMatch[]; requests: MyJoinRequest[] }> {
  const [matches, requests] = await Promise.all([
    fromEveryDatabase((database) => withSignedIn((tx) => myPhoneMatches(tx), { database })),
    fromEveryDatabase((database) => withSignedIn((tx) => myJoinRequests(tx), { database })),
  ]);
  const seen = new Set<string>();
  return {
    matches: matches.filter((m) => !seen.has(m.orgId) && seen.add(m.orgId)),
    requests: [...new Map(requests.map((r) => [r.id, r])).values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  };
}
