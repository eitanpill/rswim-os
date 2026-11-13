import { createPool } from '@rswim/db';
import { seedProduction } from './production';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const pool = createPool(url, 2);
try {
  console.log('production seed', await seedProduction(pool));
} finally {
  await pool.end();
}
