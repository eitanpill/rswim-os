ALTER TABLE "dive_bookings" DROP CONSTRAINT "dive_bookings_status_check";--> statement-breakpoint
ALTER TABLE "dive_bookings" ADD COLUMN "hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dive_bookings" ADD CONSTRAINT "dive_bookings_status_check" CHECK (status in ('pending_payment', 'booked', 'checked_in', 'no_show', 'cancelled'));