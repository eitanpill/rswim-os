import { appLinkIdentity, assetLinks } from '@/lib/native-app';

/** Lets links on this host open the Android app (App Links). */
export function GET() {
  return Response.json(assetLinks(appLinkIdentity()), {
    headers: { 'cache-control': 'public, max-age=3600' },
  });
}
