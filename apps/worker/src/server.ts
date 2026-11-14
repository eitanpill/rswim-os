import { createServer as createHttpServer } from 'node:http';
import { sql } from '@rswim/db';
import { serve } from 'inngest/node';
import { controlDb, inngestClient as inngest, log } from './client';
import { functions } from './functions';
import { initMonitoring } from './monitoring';

initMonitoring();

const port = Number(process.env.PORT ?? 3030);
const inngestHandler = serve({ client: inngest, functions });

/** GET /health for uptime monitors and the host's health check: 200 when the platform database answers. */
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
  if (req.method === 'GET' && req.url?.split('?')[0] === '/health') {
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
});
