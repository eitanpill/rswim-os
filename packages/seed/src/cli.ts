import { createPool } from '@rswim/db';
import { parseMasterKey } from '@rswim/domain-core';
import { createClient } from '@supabase/supabase-js';
import { seedDemo, type SeedOptions } from './demo';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
if (process.env.VERCEL_ENV === 'production' || process.env.RSWIM_ENV === 'production') {
  throw new Error('Refusing to seed demo data into production');
}

const options: SeedOptions = {};
if (process.env.RSWIM_MASTER_KEY) options.masterKey = parseMasterKey(process.env.RSWIM_MASTER_KEY);
else console.warn('RSWIM_MASTER_KEY not set: encrypted fields are left empty');

// On Supabase, auth users are created through the admin API; on plain Postgres the seed writes auth.users itself.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (supabaseUrl && serviceKey && process.env.RSWIM_PLAIN_POSTGRES !== '1') {
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  options.ensureUser = async (u) => {
    const { error } = await admin.auth.admin.createUser({
      id: u.id,
      email: u.email,
      phone: u.phone,
      email_confirm: true,
      phone_confirm: true,
      password: u.email ? 'demo-password-change-me' : undefined,
    } as Parameters<typeof admin.auth.admin.createUser>[0]);
    if (error && !/already/i.test(error.message)) throw error;
  };
}

const pool = createPool(url, 2);
try {
  console.log('seeded', await seedDemo(pool, options));
} finally {
  await pool.end();
}
