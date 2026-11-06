/** Worker runs reach the right database: a school's events its own one, sweeps every database in turn. */
import { describe, expect, it } from 'vitest';
import type { Db } from '@rswim/db';
import {
  CONTROL_ONLY,
  currentDb,
  routeHandler,
  scopedStep,
  type RoutingDeps,
} from '../src/tenancy';

const control = { name: 'control' } as unknown as Db;
const school = { name: 'school' } as unknown as Db;
const ORG = '11111111-2222-4333-8444-555555555555';

const deps: RoutingDeps = {
  control: () => control,
  forOrg: async (id) => (id === ORG ? school : control),
  all: async () => [
    { key: 'control', db: control },
    { key: ORG, db: school },
  ],
};

/** A step tool that records ids and runs bodies at once, like Inngest's first pass would. */
function fakeStep() {
  const ids: string[] = [];
  return {
    ids,
    step: {
      run: async (id: string, fn: () => unknown) => {
        ids.push(id);
        return fn();
      },
      sleep: async (id: string, _duration?: string) => {
        ids.push(id);
      },
    },
  };
}

const handler = async ({
  step,
}: {
  step: ReturnType<typeof fakeStep>['step'];
  event?: { data?: unknown };
}) => {
  const outside = (currentDb() as unknown as { name: string }).name;
  const inside = await step.run(
    'find',
    async () => (currentDb() as unknown as { name: string }).name,
  );
  await step.sleep('pause', '1s');
  return { outside, inside };
};

describe('routing worker runs', () => {
  it("runs a school's event on that school's database", async () => {
    const { step, ids } = fakeStep();
    const r = await routeHandler(
      'comms-x',
      handler,
      deps,
    )({ event: { data: { organizationId: ORG } }, step });
    expect(r).toEqual({ outside: 'school', inside: 'school' });
    expect(ids).toEqual(['find', 'pause']);
  });

  it('sweeps every database with step ids kept apart', async () => {
    const { step, ids } = fakeStep();
    const r = await routeHandler('reports-x', handler, deps)({ event: { data: {} }, step });
    expect(r).toEqual({
      databases: {
        control: { outside: 'control', inside: 'control' },
        [ORG]: { outside: 'school', inside: 'school' },
      },
    });
    expect(ids).toEqual(['find', 'pause', 'school-11111111:find', 'school-11111111:pause']);
  });

  it('keeps platform plumbing on the platform database', async () => {
    expect(CONTROL_ONLY.has('platform-provision-database')).toBe(true);
    const { step } = fakeStep();
    const r = await routeHandler(
      'platform-daily',
      handler,
      deps,
    )({ event: { data: { organizationId: ORG } }, step });
    expect(r).toEqual({ outside: 'control', inside: 'control' });
  });

  it('a sweep with only the platform database looks as before', async () => {
    const { step, ids } = fakeStep();
    const one: RoutingDeps = { ...deps, all: async () => [{ key: 'control', db: control }] };
    expect(await routeHandler('reports-x', handler, one)({ step })).toEqual({
      outside: 'control',
      inside: 'control',
    });
    expect(ids).toEqual(['find', 'pause']);
  });

  it('prefixes ids given as objects and leaves other tools alone', async () => {
    const seen: unknown[] = [];
    const s = scopedStep(
      { invoke: async (id: unknown) => seen.push(id), other: (x: number) => x * 2, value: 3 },
      school,
      'p:',
    );
    await s.invoke({ id: 'call', function: 'f' });
    expect(seen).toEqual([{ id: 'p:call', function: 'f' }]);
    expect(s.other(2)).toBe(4);
    expect(s.value).toBe(3);
  });
});
