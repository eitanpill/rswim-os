import * as Sentry from '@sentry/node';

/**
 * Error reporting for the worker. Off unless SENTRY_DSN is set (local runs, tests and the demo send nothing). Events
 * carry the function id and the error only; payloads with families' details are never attached.
 */
let enabled = false;

export function initMonitoring(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || enabled) return;
  Sentry.init({
    dsn,
    environment: process.env.RSWIM_ENV ?? 'development',
    release: process.env.RSWIM_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA,
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
  enabled = true;
}

export function reportFunctionError(functionId: string, error: unknown): void {
  if (!enabled) return;
  Sentry.captureException(error, { tags: { function: functionId } });
}

/** Wraps an Inngest handler so a failed run is reported, then rethrown for Inngest to retry as before. */
export function reported<C, R>(
  functionId: string,
  handler: (ctx: C) => R | Promise<R>,
): (ctx: C) => Promise<R> {
  return async (ctx: C) => {
    try {
      return await handler(ctx);
    } catch (e) {
      reportFunctionError(functionId, e);
      throw e;
    }
  };
}
