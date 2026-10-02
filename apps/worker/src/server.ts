import { createServer } from 'inngest/node';
import { inngest, log } from './client';
import { functions } from './functions';

const port = Number(process.env.PORT ?? 3030);
createServer({ client: inngest, functions }).listen(port, () => {
  log.info({ port, functions: functions.length }, 'worker listening at /api/inngest');
});
