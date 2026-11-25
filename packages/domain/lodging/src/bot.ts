/**
 * Lodging in the new-customers bot (WhatsApp track): when the business has lodging on, the bot knows the rooms and
 * their prices and can look up what is free for some nights. It never books: the office confirms (stage 6 of the
 * lodging plan adds holding a room with a payment link at the brain's levels).
 */
import { z } from 'zod';
import type { Tx } from '@rswim/db';
import { registerLeadBotModule, type LeadBotModule } from '@rswim/domain-copilot';
import { DomainError } from '@rswim/domain-core';
import { botFacts } from './policies';
import { getLodgingSettings, loadRates, loadRooms, searchFree } from './services';

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
  ],
  async call(tx, _ctx, _leadId, tool, input) {
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

/** Called once at the worker's start. */
export function registerLodgingBot(): void {
  registerLeadBotModule(lodgingLeadBotModule);
}
