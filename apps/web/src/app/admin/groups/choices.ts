import 'server-only';
import type { Tx } from '@rswim/db';
import { listPrograms } from '@rswim/domain-settings';
import { listStaff } from '@rswim/domain-staff';
import { getVenue, listVenues } from '@rswim/domain-venues';
import type { GroupFormChoices } from './group-form';

/** Every venue's pools, for the "where" step and labels. */
export async function venuePools(tx: Tx) {
  const venues = await listVenues(tx);
  const details = await Promise.all(venues.map((v) => getVenue(tx, v.id)));
  return details.flatMap((d) =>
    d
      ? d.pools.map((p) => ({
          venueId: d.venue.id,
          venueName: d.venue.name,
          poolId: p.id,
          label: d.pools.length > 1 ? `${d.venue.name} · ${p.name}` : d.venue.name,
          lanes: p.lanes.map((l) => ({ id: l.id, label: l.label })),
        }))
      : [],
  );
}

export async function groupChoices(tx: Tx, poolId: string): Promise<GroupFormChoices | null> {
  const [pools, programs, staff] = await Promise.all([
    venuePools(tx),
    listPrograms(tx),
    listStaff(tx),
  ]);
  const place = pools.find((p) => p.poolId === poolId);
  if (!place) return null;
  return {
    place,
    programs: programs.filter((p) => p.active),
    staff: staff.filter((s) => s.status === 'active'),
  };
}
