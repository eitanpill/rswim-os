ALTER TABLE "lodging_stays" DROP CONSTRAINT "lodging_stays_source_check";--> statement-breakpoint
ALTER TABLE "lodging_settings" ADD COLUMN "guest_reminder" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "lodging_settings" ADD COLUMN "arrival_note" text;--> statement-breakpoint
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_source_check" CHECK (source in ('office', 'bot', 'online', 'block'));