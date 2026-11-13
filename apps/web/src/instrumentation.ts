import * as Sentry from '@sentry/nextjs';

/**
 * Error reporting for the server side (Node and edge). Off unless SENTRY_DSN is set, so local runs, tests and the
 * demo send nothing. Personal data stays out: no user info, cookies, headers, bodies, query strings or query data.
 */
export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.RSWIM_ENV ?? process.env.VERCEL_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RSWIM_RELEASE,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}

export const onRequestError = Sentry.captureRequestError;
