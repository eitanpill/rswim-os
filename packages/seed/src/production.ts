/**
 * What a fresh production (or staging) database needs before the first school signs up: the plans and the
 * marketplace's starter regulations. No schools, no people, no demo data. Safe to run on every deploy.
 */
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import type pg from 'pg';
import { upsertPlans } from './plans';

export const PRODUCTION_TEMPLATES = {
  regulations: 'תקנון בסיסי לבית ספר',
} as const;

export interface ProductionSeedSummary {
  plans: number;
  templatesAdded: number;
}

export async function seedProduction(pool: pg.Pool): Promise<ProductionSeedSummary> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const plans = await upsertPlans(client);
    // Added once; after that it belongs to the platform admins, who may edit it from /platform.
    const added = await client.query(
      `insert into templates (kind, status, name, description, payload)
       select 'regulations', 'published', $1::text, $2::text, $3::jsonb
       where not exists (select 1 from templates where source_organization_id is null and name = $1::text)`,
      [
        PRODUCTION_TEMPLATES.regulations,
        'כללים מקובלים להודעה על היעדרות, השלמות, הקפאות, עזיבה וחיוב. כל בית ספר משנה לפי הצורך.',
        JSON.stringify({ rules: DEFAULT_ORG_RULES }),
      ],
    );
    await client.query('commit');
    return { plans, templatesAdded: added.rowCount ?? 0 };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
