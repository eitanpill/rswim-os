/**
 * How often the worker's frequent sweeps run (the outbox relay and message dispatch). Every Inngest run and step
 * counts against the plan's monthly executions; on Inngest's free plan every minute uses up the month in days, so the
 * default is every three minutes. `RSWIM_WORKER_TICK_MINUTES=1` brings back every minute on a paid plan.
 */
export function tickCron(
  minutes: string | undefined = process.env.RSWIM_WORKER_TICK_MINUTES,
): string {
  const n = Number(minutes ?? 3);
  if (!Number.isInteger(n) || n < 1 || n > 30) return '*/3 * * * *';
  return n === 1 ? '* * * * *' : `*/${n} * * * *`;
}

export const TICK_CRON = tickCron();
