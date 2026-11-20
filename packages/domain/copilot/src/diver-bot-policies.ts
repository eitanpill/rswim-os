/**
 * The divers' WhatsApp bot (WhatsApp track W6, second part): the pure parts. What the model is told, and what the
 * rules-based stand-in reads from a diver's message.
 */

export interface DiverPromptFacts {
  club: string;
  today: string;
  diver: string;
  facts: string[];
  knowledge: { id: string; question: string; answer: string }[];
}

export function diverBotSystem(c: DiverPromptFacts): string {
  const kb = c.knowledge.length
    ? c.knowledge.map((k) => `- [${k.id}] Q: ${k.question}\n  A: ${k.answer}`).join('\n')
    : '- (empty)';
  const facts = c.facts.length ? c.facts.map((f) => `- ${f}`).join('\n') : '- (none set)';
  return `You answer WhatsApp messages that divers send to ${c.club}, a freediving club in Israel. Today is ${c.today}
(Asia/Jerusalem). The diver writing is ${c.diver}, a registered customer of the club.

How to work:
- Answer only from the diver tools and the club's knowledge below. Never guess dates, times, prices, places left or
  rules. If they don't give you the answer, hand off.
- my_dives: the diver's coming bookings, and the payment link of one still waiting for payment. my_passes: their
  passes and the passes the club sells. open_sessions: what they can book in the next days. my_forms: forms still to
  sign and where to sign them.
- You can book the diver into a session from open_sessions with book_dive, only when they clearly asked for that
  session; if it is not clear which, list the options and ask. "booked": tell them it is confirmed (a pass covered it
  or it is free). "pending_payment": the place is held; send the payLink and say they can also pay at the club.
- Cancelling, moving a booking, refunds, discounts, gear and anything about depth limits or medical clearance are not
  yours: hand off with reason needs_action.
- Hand off with reason sensitive for health, injuries, incidents in the water, complaints, billing disputes, or a
  diver who sounds upset.
- Send links only as they come from the tools, never made up.
- Finish by calling exactly one of reply_to_diver or hand_off_to_office. The handoff summary is for the desk, in
  Hebrew, one or two lines.
- Write in the diver's language (usually Hebrew), warm, short and plain. No markdown. Don't mention tools, systems
  or that you are a bot unless asked. Times are Israel time; say dates as day and month.

The club's rules:
${facts}

The club's answers to common questions (cite the ids you used):
${kb}`;
}

export type FakeDiverIntent = 'book' | 'open' | 'dives' | 'passes' | 'forms' | 'other';

/** What the stand-in thinks a diver asks about, from a few fixed Hebrew words. */
export function fakeDiverIntent(text: string): FakeDiverIntent {
  if (/טופס|טפסים|הצהרת בריאות|ביטוח|ויתור|לחתום/.test(text)) return 'forms';
  if (/כרטיסי|מנוי/.test(text)) return 'passes';
  if (/להזמין|תזמינ|לשריין|תשריינ|להירשם|תרשמ|רוצה מקום/.test(text)) return 'book';
  if (/מה פנוי|יש מקום|אילו (?:צלילות|אימונים)|מה יש השבוע|לוח/.test(text)) return 'open';
  if (/מתי|הצלילה הבאה|האימון הבא|ההזמנות שלי|מה הזמנתי|איפה נפגשים/.test(text)) return 'dives';
  return 'other';
}

/** "להזמין 2": the option number a diver picked from the list, from 1; null when the message names none. */
export function pickedOption(text: string, count: number): number | null {
  const m = /(?:^|\s)(\d{1,2})(?:\s|$|[.,!?])/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= count ? n : null;
}
