/**
 * Deleting your own account from inside the app (store launch, stage 8). The database (migration 0058) removes the
 * sign-in and every membership; the school's records of the family stay with the school. The only owner of an active
 * school hands it over first.
 */
import { sql, type Tx } from '@rswim/db';
import { toDomainError } from '@rswim/domain-core';

/** Schools that would be left without an owner. Empty: the account may be deleted. */
export async function mySoleOwnedSchools(tx: Tx): Promise<{ orgId: string; name: string }[]> {
  const r = await tx.execute<{ organization_id: string; organization_name: string }>(
    sql`select * from public.my_sole_owned_schools()`,
  );
  return r.rows.map((x) => ({ orgId: x.organization_id, name: x.organization_name }));
}

/** Deletes the signed-in person's account in this database. */
export async function deleteMyAccount(tx: Tx): Promise<void> {
  try {
    await tx.execute(sql`select public.delete_my_account()`);
  } catch (e) {
    throw toDomainError(e) ?? e;
  }
}
