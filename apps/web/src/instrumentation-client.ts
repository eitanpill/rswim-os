import * as Sentry from '@sentry/nextjs';

// Browser errors, only when the build was given a public DSN. No session replay; user info, cookies, headers, bodies and query strings stay out.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_RSWIM_ENV ?? 'production',
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0,
  });
}
