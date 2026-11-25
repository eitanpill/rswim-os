/**
 * Lodging in the new-customers bot (WhatsApp track): when the business has lodging on, the bot knows the rooms and
 * their prices, looks up what is free for some nights, and books one of the options it offered (stage 6): through the
 * brain's `book_lodging` level the room is held and the guest gets the deposit link on WhatsApp, at once or once the
 * owner says yes.
 */
import { z } from 'zod';
import { and, eq, inArray, schema, type Tx } from '@rswim/db';
import {
  proposalSummary,
  registerActionHandler,
  registerLeadBotModule,
  takeAction,
  type LeadBotModule,
  type ProposalParams,
} from '@rswim/domain-copilot';
import { getLead } from '@rswim/domain-crm';
import { DomainError, toDomainError, type ServiceContext } from '@rswim/domain-core';
import { schoolName, enqueueMessage } from '@rswim/domain-comms';
import { depositFor } from './deposit';
import { bookingOf, requestPayment } from './payments';
import { botFacts, bookedText, reminderPayFor } from './policies';
import {
  bookStay,
  getLodgingSettings,
  getStay,
  loadRates,
  loadRooms,
  searchFree,
} from './services';

const { lodgingStays } = schema;

const Availability = z.object({
  check_in: z.iso.date(),
  check_out: z.iso.date(),
  guests: z.coerce.number().int().min(1).max(60),
});

export const lodgingLeadBotModule: LeadBotModule = {
  key: 'lodging',
  async enabled(tx: Tx) {
    const s = await getLodgingSettings(tx);
    return s.enabled && (await loadRooms(tx)).some((r) => r.active);
  },
  async facts(tx: Tx) {
    const s = await getLodgingSettings(tx);
    const [rooms, rates] = await Promise.all([loadRooms(tx), loadRates(tx)]);
    return botFacts(
      rooms,
      { checkIn: s.checkInTime, checkOut: s.checkOutTime },
      rates,
      s.minNights,
      { percent: s.depositPercent, holdHours: s.holdHours },
    );
  },
  tools: [
    {
      name: 'lodging_availability',
      description:
        'Rooms and dorm beds free for some nights for this many guests, with the price for the whole stay from the price list (seasons, weekends, holidays). Dates are YYYY-MM-DD; check_out is the morning they leave. An option with too_short needs at least min_nights nights.',
      input_schema: {
        type: 'object',
        properties: {
          check_in: { type: 'string' },
          check_out: { type: 'string' },
          guests: { type: 'integer' },
        },
        required: ['check_in', 'check_out', 'guests'],
        additionalProperties: false,
      },
    },
    {
      name: 'lodging_book',
      description:
        'Books one of the options lodging_availability offered, for this customer: the same dates and guests, the room by its name, and the name the booking is under. Returns status done (held, details and deposit link sent to the customer), waiting (the office confirms), not_allowed or failed.',
      input_schema: {
        type: 'object',
        properties: {
          check_in: { type: 'string' },
          check_out: { type: 'string' },
          guests: { type: 'integer' },
          room: { type: 'string' },
          guest_name: { type: 'string' },
        },
        required: ['check_in', 'check_out', 'guests', 'room', 'guest_name'],
        additionalProperties: false,
      },
    },
  ],
  async call(tx, ctx, leadId, tool, input) {
    if (tool === 'lodging_book') return bookFromBot(tx, ctx, leadId, input);
    if (tool !== 'lodging_availability') throw new DomainError('copilot.errors.unknownTool');
    const ask = Availability.parse(input);
    if (ask.check_out <= ask.check_in) return { error: 'check_out must be after check_in' };
    const options = await searchFree(tx, {
      checkIn: ask.check_in,
      checkOut: ask.check_out,
      guests: ask.guests,
    });
    return {
      nights: options[0]?.nights ?? 0,
      options: options.slice(0, 5).map((o) => ({
        room: o.roomName,
        kind: o.kind,
        sold_by: o.soldBy,
        holds_guests: o.room,
        total_shekels: o.totalAgorot === null ? null : o.totalAgorot / 100,
        min_nights: o.minNights,
        too_short: o.tooShort,
        special_nights: [
          ...new Set(o.priced.flatMap((n) => n.rules.map((r) => r.holiday ?? r.name))),
        ],
      })),
    };
  },
};

const Book = Availability.extend({
  room: z.string().trim().min(1).max(120),
  guest_name: z.string().trim().min(1).max(120),
});

/** The bot books what it offered: only a free option of these dates that is not too short. */
async function bookFromBot(tx: Tx, ctx: ServiceContext, leadId: string, input: unknown) {
  const r = Book.safeParse(input);
  if (!r.success || r.data.check_out <= r.data.check_in)
    return { status: 'failed', why: 'bad input' };
  const ask = r.data;
  const options = await searchFree(tx, {
    checkIn: ask.check_in,
    checkOut: ask.check_out,
    guests: ask.guests,
  });
  const option = options.find((o) => o.roomName === ask.room && !o.tooShort);
  if (!option) return { status: 'failed', why: 'not one of the free options for these dates' };
  const settings = await getLodgingSettings(tx);
  const params: ProposalParams['book_lodging'] = {
    leadId,
    roomId: option.roomId,
    checkIn: ask.check_in,
    checkOut: ask.check_out,
    guests: ask.guests,
    guestName: ask.guest_name,
  };
  try {
    const out = await takeAction(tx, ctx, {
      source: 'parent_whatsapp',
      requestId: null,
      kind: 'book_lodging',
      params,
      summary: proposalSummary({
        kind: 'book_lodging',
        guest: ask.guest_name,
        room: option.roomName,
        date: ask.check_in,
        until: ask.check_out,
        nights: option.nights,
        totalAgorot: option.totalAgorot,
      }),
      // A deposit above the owner's limit for payments waits for her.
      amountAgorot: depositFor(option.totalAgorot, settings.depositPercent) || null,
    });
    return out.status === 'failed' ? { status: 'failed', why: out.code } : { status: out.status };
  } catch (e) {
    if (toDomainError(e)?.code === 'agent.errors.off') return { status: 'not_allowed' };
    throw e;
  }
}

/**
 * Holds the room for the lead (the brain's `book_lodging`, at once or on the owner's yes): a held booking when the
 * business asks for a deposit (confirmed without one), and one WhatsApp to the lead's phone with where, when, the
 * price and the deposit link. Undone, the booking is cancelled.
 */
export async function holdForLead(
  tx: Tx,
  ctx: ServiceContext,
  p: ProposalParams['book_lodging'],
  publicUrl: string,
): Promise<{ bookingId: string; stayIds: string[]; payUrl: string | null }> {
  const { lead } = await getLead(tx, p.leadId);
  if (!lead.phone) throw new DomainError('common.errors.notFound');
  const settings = await getLodgingSettings(tx);
  const stayIds = await bookStay(tx, ctx, {
    roomId: p.roomId,
    guestName: p.guestName,
    phone: lead.phone,
    guests: p.guests,
    checkIn: p.checkIn,
    checkOut: p.checkOut,
    hold: settings.depositPercent > 0,
    source: 'bot',
    leadId: p.leadId,
  });
  const stay = await getStay(tx, stayIds[0] as string);
  if (!stay) throw new DomainError('common.errors.notFound');
  const view = await bookingOf(tx, stay.bookingId);
  const deposit = view.money.depositDueAgorot;
  const payUrl =
    deposit > 0 && view.processor
      ? (
          await requestPayment(
            tx,
            ctx,
            { stayId: stay.id, what: 'deposit' },
            { publicUrl, description: (s) => reminderPayFor(s, 'he'), message: () => '' },
          )
        ).url
      : null;
  const business = await schoolName(tx, ctx.orgId);
  const until = stay.holdUntil
    ? new Intl.DateTimeFormat('he-IL', {
        timeZone: 'Asia/Jerusalem',
        day: 'numeric',
        month: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(stay.holdUntil)
    : null;
  await enqueueMessage(tx, ctx, {
    guardian: {
      id: null,
      householdId: null,
      firstName: p.guestName,
      phoneE164: lead.phone,
      whatsappOptIn: true,
      locale: 'he',
    },
    templateKey: 'free_text',
    vars: (locale) => ({
      text: bookedText(
        {
          guestName: p.guestName,
          business,
          where: stay.roomName,
          checkIn: p.checkIn,
          checkOut: p.checkOut,
          totalAgorot: view.money.totalAgorot,
          depositAgorot: deposit,
          payUrl,
          holdUntil: until,
        },
        locale,
      ),
    }),
    idempotencyKey: `lodging.booked:${stay.bookingId}`,
  });
  return { bookingId: stay.bookingId, stayIds, payUrl };
}

/** An undone hold: the booking's beds are free again (a guest already in is not undone). */
async function releaseHold(tx: Tx, result: { bookingId: string }): Promise<void> {
  const { bookingId } = result;
  const inHouse = await tx
    .select({ id: lodgingStays.id })
    .from(lodgingStays)
    .where(
      and(
        eq(lodgingStays.bookingId, bookingId),
        inArray(lodgingStays.status, ['checked_in', 'checked_out']),
      ),
    );
  if (inHouse.length) throw new DomainError('lodging.errors.cannotMove');
  await tx
    .update(lodgingStays)
    .set({ status: 'cancelled', holdUntil: null })
    .where(
      and(
        eq(lodgingStays.bookingId, bookingId),
        inArray(lodgingStays.status, ['held', 'confirmed']),
      ),
    );
}

/** Where the brain's approvals run (the worker, the web app's brain screens): holds a room for a lead. */
export function registerLodgingActions(publicUrl: () => string | Promise<string>): void {
  registerActionHandler('book_lodging', {
    execute: async (tx, ctx, p) => holdForLead(tx, ctx, p, await publicUrl()),
    undo: (tx, _ctx, result) => releaseHold(tx, result),
  });
}

/** Called once at the worker's start. */
export function registerLodgingBot(publicUrl: () => string | Promise<string>): void {
  registerLeadBotModule(lodgingLeadBotModule);
  registerLodgingActions(publicUrl);
}
