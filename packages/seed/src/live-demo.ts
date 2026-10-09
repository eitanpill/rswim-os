/**
 * The public live demo (deploy/demo): the fake seed under a neutral school name, so it can be shown to any school.
 * The freediving club is its own tenant (seed/dive-data.ts) and needs no dressing; a profile only decides which
 * one the sign-in page leads with. Every name is still invented.
 */
import type pg from 'pg';
import type { DemoProfile } from '@rswim/db/demo-profiles';
import { DEMO_ORG } from '@rswim/db/personas';

const SEED_OWNER = 'רעות';
const SEED_BRAND = 'R-SWIM';

export async function rebrandLiveDemo(pool: pg.Pool, profile: DemoProfile): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const org = DEMO_ORG.id;
    const school = profile.schoolName.replace(/\s*\(דמו\)\s*$/, '');
    await client.query(
      `update organizations set name = $2, legal_name = $3 || ' (עוסק מורשה, דמו)' where id = $1`,
      [org, profile.schoolName, school],
    );
    await client.query(
      `update org_settings set branding = branding || jsonb_build_object('displayName', $2::text)
       where organization_id = $1`,
      [org, profile.schoolName],
    );
    await client.query(
      `update staff_members set first_name = $2 where organization_id = $1 and first_name = $3`,
      [org, profile.ownerFirstName, SEED_OWNER],
    );
    // Draft payroll keeps a snapshot of each instructor's name.
    await client.query(
      `update payroll_runs set totals = replace(totals::text, $2, $3)::jsonb
       where organization_id = $1 and totals::text like '%' || $2 || '%'`,
      [org, SEED_OWNER, profile.ownerFirstName],
    );
    // The marketplace's sample regulations are R-SWIM's own.
    await client.query(
      `update templates set name = replace(name, $1, $2), description = replace(description, $3, $4)
       where name like '%' || $1 || '%' or description like '%' || $3 || '%'`,
      [SEED_BRAND, school, `בית הספר של ${SEED_OWNER}`, 'בית הספר'],
    );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
