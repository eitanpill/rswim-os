/**
 * The swim school's lead list (WhatsApp track, stage 1), all fake: a few people the office wrote down itself, one
 * still being talked to with a follow-up due today, and one who dropped. The WhatsApp lead from an unknown number
 * comes from the inbox (comms-data.ts).
 */
import { createDb, sql, type Tx } from '@rswim/db';
import type { ServiceContext } from '@rswim/domain-core';
import { createLead, moveLeadStage } from '@rswim/domain-crm';
import type pg from 'pg';

export async function seedLeadsData(
  client: pg.PoolClient,
  orgId: string,
  fakePhone: () => string,
): Promise<number> {
  const tx = createDb(client) as unknown as Tx;
  const ctx: ServiceContext = { orgId, userId: null };
  const [today] = (await tx.execute<{ d: string }>(sql`select app.today()::text as d`)).rows;
  const day = (today as { d: string }).d;
  const list = [
    {
      name: 'שירן אבוטבול',
      source: 'instagram',
      interest: 'חוג לגיל 4, ימי שלישי',
      note: 'ראתה סרטון של הקבוצה הקטנה. שאלה על מים חמים בחורף.',
      stage: 'talking',
      nextActionOn: day,
      hoursAgo: 50,
    },
    {
      name: 'עמית רוזן',
      source: 'phone',
      interest: 'שיעור פרטי למבוגר',
      note: 'מפחד ממים, רוצה מדריך סבלני. יחזור אחרי החגים.',
      stage: 'talking',
      nextActionOn: null,
      hoursAgo: 120,
    },
    {
      name: 'הדס כהן',
      source: 'referral',
      interest: 'שני ילדים, 7 ו-9',
      note: 'חברה של משפחת לוי.',
      stage: 'new',
      nextActionOn: null,
      hoursAgo: 5,
    },
    {
      name: 'אורי שמש',
      source: 'facebook',
      interest: 'קבוצת נוער',
      note: 'השעות לא מתאימות לו.',
      stage: 'lost',
      nextActionOn: null,
      hoursAgo: 300,
    },
  ] as const;
  for (const l of list) {
    const id = await createLead(tx, ctx, {
      name: l.name,
      phone: fakePhone(),
      source: l.source,
      interest: l.interest,
      note: l.note,
      nextActionOn: l.nextActionOn ?? undefined,
    });
    if (l.stage === 'lost') await moveLeadStage(tx, { id, stage: 'lost', lostReason: 'schedule' });
    else if (l.stage !== 'new') await moveLeadStage(tx, { id, stage: l.stage });
    await tx.execute(
      sql`update leads set created_at = now() - make_interval(hours => ${l.hoursAgo}),
                           stage_changed_at = now() - make_interval(hours => ${Math.floor(l.hoursAgo / 2)})
          where id = ${id}`,
    );
  }
  return list.length;
}
