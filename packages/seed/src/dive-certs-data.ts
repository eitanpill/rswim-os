/**
 * The demo clubs' certification cards: a verified card behind every certified diver's level, and, in the hero club,
 * two divers who joined through the club's link this week and a regular who uploaded a new card, all waiting for the
 * desk to check. Every name and number is invented. Runs with its own random stream, after the forms.
 */
import type pg from 'pg';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NEWCOMERS = [
  { first: 'עומר', last: 'שגיא', agency: 'aida', level: 3, name: 'AIDA 3', number: 'AIDA-77812' },
  {
    first: 'Lena',
    last: 'Hartmann',
    agency: 'ssi',
    level: 2,
    name: 'SSI Freediver',
    number: 'SSI-55120',
  },
] as const;

export async function seedDiveCerts(
  client: pg.PoolClient,
  orgId: string,
  opts: { seed: number; hero: boolean },
): Promise<{ verified: number; pending: number }> {
  const random = rng(opts.seed);
  const between = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));

  const verified = await client.query(
    `insert into dive_certifications (organization_id, diver_id, agency, level, name, number, issued_on, status,
                                      created_at, reviewed_at)
     select d.organization_id, d.id, case when d.cert_agency in ('molchanovs', 'aida', 'ssi', 'padi') then d.cert_agency else 'other' end, d.cert_level, d.cert_name,
            d.cert_number, d.joined_on - 30, 'verified', d.joined_on::timestamptz, d.joined_on::timestamptz
     from dive_divers d
     where d.organization_id = $1 and d.cert_level > 0 and d.cert_name is not null
       and length(btrim(d.cert_name)) >= 2`,
    [orgId],
  );
  if (!opts.hero) return { verified: verified.rowCount ?? 0, pending: 0 };

  let pending = 0;
  for (const n of NEWCOMERS) {
    const days = between(1, 4);
    const diver = (
      await client.query<{ id: string }>(
        `insert into dive_divers (organization_id, first_name, last_name, phone_e164, origin, source, tags,
                                  joined_on, emergency_name, emergency_phone)
         values ($1, $2, $3, $4, $5, 'join_link', '{self_signup}', current_date - $6::int, $7, $8)
         returning id`,
        [
          orgId,
          n.first,
          n.last,
          `+97250${String(between(1_000_000, 9_999_999))}`,
          n.agency === 'ssi' ? 'abroad' : 'israel',
          days,
          'איש קשר (דמו)',
          `+97252${String(between(1_000_000, 9_999_999))}`,
        ],
      )
    ).rows[0]?.id;
    await client.query(
      `insert into dive_certifications (organization_id, diver_id, agency, level, name, number, issued_on,
                                        created_at)
       values ($1, $2, $3, $4, $5, $6, current_date - $7::int, now() - make_interval(days => $8::int))`,
      [orgId, diver, n.agency, n.level, n.name, n.number, between(200, 900), days],
    );
    pending++;
  }

  // A regular who passed their next level abroad and uploaded the new card.
  const regular = (
    await client.query<{ id: string; level: number }>(
      `select id, cert_level as level from dive_divers
       where organization_id = $1 and cert_level between 2 and 3 and cert_agency = 'molchanovs'
       order by created_at, id offset 5 limit 1`,
      [orgId],
    )
  ).rows[0];
  if (regular) {
    await client.query(
      `insert into dive_certifications (organization_id, diver_id, agency, level, name, number, issued_on,
                                        created_at)
       values ($1, $2, 'molchanovs', $3, $4, $5, current_date - 9, now() - interval '20 hours')`,
      [
        orgId,
        regular.id,
        regular.level + 1,
        `Molchanovs Wave ${regular.level}`,
        `MOL-${between(100000, 999999)}`,
      ],
    );
    pending++;
  }
  return { verified: verified.rowCount ?? 0, pending };
}
