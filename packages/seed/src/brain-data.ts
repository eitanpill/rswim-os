/**
 * The brain's memory in the demo (docs/AI-BRAIN.md, stage 5): a few notes the owner asked it to keep, about the school,
 * a family, an instructor and a venue, and one event from a year ago, so the memory page and "מה אתה זוכר על..." have
 * something to show on day one. All invented; each row has a seed ref, so seeding again adds nothing.
 */
import type pg from 'pg';

export async function seedBrainMemory(client: pg.PoolClient, orgId: string): Promise<number> {
  const one = async (q: string) =>
    (await client.query<{ id: string; n: string }>(q, [orgId])).rows[0];
  const family = await one(
    `select id, display_name n from households where organization_id = $1 order by display_name limit 1`,
  );
  const staff = await one(
    `select id, first_name || ' ' || last_name n from staff_members
     where organization_id = $1 and status = 'active' order by first_name limit 1`,
  );
  const venue = await one(
    `select id, name n from venues where organization_id = $1 order by name limit 1`,
  );
  const notes: {
    ref: string;
    type: string;
    subject?: { id: string; n: string };
    body: string;
    ago: number;
  }[] = [
    {
      ref: 'seed:note:hanukkah',
      type: 'school',
      body: 'בחנוכה שעבר כמעט חצי מהילדים לא הגיעו. לשקול קייטנת חנוכה במקום שיעורים רגילים',
      ago: 300,
    },
    {
      ref: 'seed:note:family',
      type: 'household',
      subject: family,
      body: 'משלמים תמיד באיחור של שבוע, אבל משלמים. לא לשלוח תזכורת לפני ה-15',
      ago: 40,
    },
    {
      ref: 'seed:note:staff',
      type: 'staff',
      subject: staff,
      body: 'מעדיפה לא ללמד בימי שישי. טובה במיוחד עם ילדים שמפחדים ממים',
      ago: 20,
    },
    {
      ref: 'seed:note:venue',
      type: 'venue',
      subject: venue,
      body: 'החימום בבריכה נוטה להתקלקל בדצמבר-ינואר. לבדוק עם המתחזק בתחילת החורף',
      ago: 10,
    },
  ];
  let n = 0;
  for (const x of notes) {
    if (x.type !== 'school' && !x.subject) continue;
    const r = await client.query(
      `insert into business_memories (organization_id, kind, subject_type, subject_id, subject_label, body, happened_on,
                                      source, source_ref)
       values ($1, 'note', $2, $3, $4, $5, current_date - $6::int, 'owner_screen', $7)
       on conflict (organization_id, source_ref) do nothing`,
      [orgId, x.type, x.subject?.id ?? null, x.subject?.n ?? null, x.body, x.ago, x.ref],
    );
    n += r.rowCount ?? 0;
  }
  if (venue) {
    const r = await client.query(
      `insert into business_memories (organization_id, kind, subject_type, subject_id, subject_label, summary,
                                      happened_on, source, source_ref)
       values ($1, 'event', 'venue', $2, $3,
               jsonb_build_object('code', 'agent.memory.events.closure', 'params', jsonb_build_object(
                 'from', (current_date - 330)::text, 'until', (current_date - 328)::text, 'venue', $3::text,
                 'reason', 'תקלה במערכת החימום', 'sessions', 14)),
               current_date - 330, 'system', 'seed:event:heating')
       on conflict (organization_id, source_ref) do nothing`,
      [orgId, venue.id, venue.n],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}
