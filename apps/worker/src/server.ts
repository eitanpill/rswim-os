import { createServer as createHttpServer } from 'node:http';
import { sql } from '@rswim/db';
import { serve } from 'inngest/node';
import { controlDb, inngestClient as inngest, log } from './client';
import { functions } from './functions';
import { initMonitoring } from './monitoring';

initMonitoring();

const port = Number(process.env.PORT ?? 3030);

/**
 * The public address Inngest Cloud calls the worker at. Railway names it in RAILWAY_PUBLIC_DOMAIN; INNGEST_SERVE_ORIGIN
 * overrides it. Without it the SDK takes the address from the request, which is right for the dashboard's sync.
 */
function publicOrigin(): string | undefined {
  if (process.env.INNGEST_SERVE_ORIGIN) return process.env.INNGEST_SERVE_ORIGIN;
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  return domain ? `https://${domain}` : undefined;
}

const serveOrigin = publicOrigin();
const inngestHandler = serve({
  client: inngest,
  functions,
  ...(serveOrigin ? { serveOrigin } : {}),
});

/**
 * Registers this deploy's functions with Inngest Cloud on start. Without it a function added in a deploy never runs
 * until someone presses "Resync" in the Inngest dashboard: its events arrive and nothing picks them up.
 * A PUT to our own endpoint is the SDK's sync; it reports the public origin above, not localhost.
 */
async function syncWithInngest(): Promise<void> {
  if (!process.env.INNGEST_SIGNING_KEY || process.env.INNGEST_DEV || !serveOrigin) return;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/inngest`, { method: 'PUT' });
      if (res.ok) {
        log.info({ functions: functions.length, origin: serveOrigin }, 'synced with Inngest');
        return;
      }
      log.warn(
        { status: res.status, body: (await res.text()).slice(0, 300), attempt },
        'Inngest sync refused',
      );
    } catch (err) {
      log.warn({ err, attempt }, 'Inngest sync failed');
    }
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
  log.error('could not sync with Inngest; press Resync in the Inngest dashboard');
}

/** GET /health (or /api/health, the path in the root railway.json) for uptime monitors and the host's health check: 200 when the platform database answers. */
async function health(): Promise<{ status: number; body: Record<string, unknown> }> {
  const release = process.env.RSWIM_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? null;
  try {
    await Promise.race([
      controlDb().execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return {
      status: 200,
      body: {
        ok: true,
        service: 'rswim-worker',
        database: 'ok',
        functions: functions.length,
        release,
      },
    };
  } catch {
    return {
      status: 503,
      body: { ok: false, service: 'rswim-worker', database: 'unreachable', release },
    };
  }
}

createHttpServer((req, res) => {
  if (req.method === 'GET' && ['/health', '/api/health'].includes(req.url?.split('?')[0] ?? '')) {
    void health().then(({ status, body }) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    return;
  }
  if (req.url?.startsWith('/api/inngest')) return inngestHandler(req, res);
  res.writeHead(404).end();
}).listen(port, () => {
  log.info({ port, functions: functions.length }, 'worker listening at /api/inngest');
  void syncWithInngest();
});
