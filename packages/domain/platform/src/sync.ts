/**
 * Keeping a school's own database and the platform's database in step (docs/TENANT-DATABASES.md). Kept apart from
 * ./tenancy (which also runs migrations) so the web app can use it.
 */
import { sql, type Db, type Tx } from '@rswim/db';

type Row = Record<string, unknown>;

// ─── Generic row copying ─────────────────────────────────────────────────────

async function columnsOf(tx: Tx, table: string): Promise<string[]> {
  const [s, t] = table.includes('.') ? table.split('.') : ['public', table];
  const r = await tx.execute<{ column_name: string }>(
    sql`select column_name from information_schema.columns
        where table_schema = ${s} and table_name = ${t} and is_generated = 'NEVER'
        order by ordinal_position`,
  );
  return r.rows.map((c) => c.column_name);
}

const ident = (name: string) =>
  name
    .split('.')
    .map((p) => `"${p.replace(/"/g, '""')}"`)
    .join('.');

/** Reads rows as JSON (so every column type survives the trip between databases). */
export async function readRows(tx: Tx, table: string, where: ReturnType<typeof sql>): Promise<Row[]> {
  const r = await tx.execute<{ j: Row }>(
    sql`select to_jsonb(t) as j from ${sql.raw(ident(table))} t where ${where}`,
  );
  return r.rows.map((x) => x.j);
}

/**
 * Inserts or updates `rows` in `table` on the conflict columns, with the columns both sides have. Returns how many
 * rows it wrote.
 */
export async function upsertRows(tx: Tx, table: string, rows: Row[], conflict: string[]): Promise<number> {
  if (rows.length === 0) return 0;
  const target = new Set(await columnsOf(tx, table));
  const cols = Object.keys(rows[0]!).filter((c) => target.has(c));
  const list = cols.map(ident).join(', ');
  const updates = cols.filter((c) => !conflict.includes(c));
  const onConflict =
    updates.length === 0
      ? 'do nothing'
      : `do update set (${updates.map(ident).join(', ')}) = row(${updates.map((c) => `excluded.${ident(c)}`).join(', ')})`;
  await tx.execute(
    sql`insert into ${sql.raw(ident(table))} (${sql.raw(list)})
        select ${sql.raw(list)} from jsonb_populate_recordset(null::${sql.raw(ident(table))}, ${JSON.stringify(rows)}::jsonb)
        on conflict (${sql.raw(conflict.map(ident).join(', '))}) ${sql.raw(onConflict)}`,
  );
  return rows.length;
}

/** Copies a user's sign-in row into the school's database (memberships and invites point at it). */
export async function mirrorUsers(control: Db, school: Db, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const users = await control.transaction((tx) =>
    readRows(tx, 'auth.users', sql`id in (${sql.join(userIds.map((u) => sql`${u}::uuid`), sql`, `)})`),
  );
  await school.transaction((tx) => upsertRows(tx, 'auth.users', users, ['id']));
}

/** Platform rows the school reads but the control plane owns: the school itself, plans, its subscription, templates. */
export async function syncDown(control: Db, school: Db, orgId: string): Promise<void> {
  const data = await control.transaction(async (tx) => ({
    org: await readRows(tx, 'organizations', sql`id = ${orgId}`),
    plans: await readRows(tx, 'plans', sql`true`),
    sub: await readRows(tx, 'org_subscriptions', sql`organization_id = ${orgId}`),
    templates: (await readRows(tx, 'templates', sql`status = 'published'`)).map((t) => ({
      ...t,
      source_organization_id: t.source_organization_id === orgId ? orgId : null,
    })),
  }));
  await school.transaction(async (tx) => {
    await upsertRows(tx, 'organizations', data.org, ['id']);
    await upsertRows(tx, 'plans', data.plans, ['code']);
    await upsertRows(tx, 'org_subscriptions', data.sub, ['organization_id']);
    await upsertRows(tx, 'templates', data.templates, ['id']);
  });
}

/**
 * What sign-in and the white-label host lookup need from the school's database: who belongs (into the directory),
 * its branding and its domains.
 */
export async function syncUp(control: Db, school: Db, orgId: string): Promise<{ members: number }> {
  const data = await school.transaction(async (tx) => ({
    members: await readRows(tx, 'memberships', sql`organization_id = ${orgId}`),
    settings: await readRows(tx, 'org_settings', sql`organization_id = ${orgId}`),
    domains: await readRows(tx, 'org_domains', sql`organization_id = ${orgId}`),
  }));
  await control.transaction(async (tx) => {
    const dir = data.members.map((m) => ({
      organization_id: orgId,
      user_id: m.user_id,
      role: m.role,
      permissions: m.permissions,
      status: m.status,
    }));
    await upsertRows(tx, 'directory_memberships', dir, ['organization_id', 'user_id']);
    const keep = dir.map((d) => d.user_id as string);
    await tx.execute(
      keep.length
        ? sql`delete from directory_memberships where organization_id = ${orgId}
              and user_id not in (${sql.join(keep.map((u) => sql`${u}::uuid`), sql`, `)})`
        : sql`delete from directory_memberships where organization_id = ${orgId}`,
    );
    // Only the branding: the login page's white-label lookup reads it. The rest of the settings (integrations and
    // their ids) stay in the school's database, so a webhook lookup never matches the platform's copy.
    for (const st of data.settings) {
      await tx.execute(
        sql`update org_settings set branding = ${JSON.stringify(st.branding ?? {})}::jsonb
            where organization_id = ${orgId}`,
      );
    }
    await upsertRows(tx, 'org_domains', data.domains, ['id']);
    const hosts = data.domains.map((d) => d.id as string);
    await tx.execute(
      hosts.length
        ? sql`delete from org_domains where organization_id = ${orgId}
              and id not in (${sql.join(hosts.map((h) => sql`${h}::uuid`), sql`, `)})`
        : sql`delete from org_domains where organization_id = ${orgId}`,
    );
  });
  return { members: data.members.length };
}

