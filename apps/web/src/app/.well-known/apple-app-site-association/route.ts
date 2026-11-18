import { appLinkIdentity, appleAppSiteAssociation } from '@/lib/native-app';

/** Lets links on this host open the iPhone app (Universal Links). Apple fetches it without a file extension. */
export function GET() {
  return Response.json(appleAppSiteAssociation(appLinkIdentity()), {
    headers: { 'cache-control': 'public, max-age=3600' },
  });
}
