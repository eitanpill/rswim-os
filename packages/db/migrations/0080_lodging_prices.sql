CREATE TABLE "lodging_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"yearly" boolean DEFAULT false NOT NULL,
	"nights_of_week" smallint[],
	"room_kind" text,
	"mode" text NOT NULL,
	"price_night_agorot" integer,
	"percent" integer,
	"min_nights" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lodging_rates_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "lodging_rates_kind_check" CHECK (kind in ('season', 'weekend', 'holiday')),
	CONSTRAINT "lodging_rates_mode_check" CHECK (mode in ('fixed', 'percent')),
	CONSTRAINT "lodging_rates_room_kind_check" CHECK (room_kind is null or room_kind in ('single', 'double', 'family', 'dorm', 'suite', 'other')),
	CONSTRAINT "lodging_rates_season_check" CHECK (kind <> 'season' or (starts_on is not null and ends_on is not null and ends_on >= starts_on)),
	CONSTRAINT "lodging_rates_value_check" CHECK ((mode = 'fixed' and price_night_agorot is not null and price_night_agorot >= 0) or (mode = 'percent' and percent is not null and percent between -90 and 500)),
	CONSTRAINT "lodging_rates_min_nights_check" CHECK (min_nights is null or min_nights between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "lodging_rooms" ADD COLUMN "price_per" text DEFAULT 'room' NOT NULL;--> statement-breakpoint
ALTER TABLE "lodging_settings" ADD COLUMN "min_nights" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "lodging_stays" ADD COLUMN "total_agorot" integer;--> statement-breakpoint
ALTER TABLE "lodging_rates" ADD CONSTRAINT "lodging_rates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lodging_rates_org" ON "lodging_rates" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "lodging_rooms" ADD CONSTRAINT "lodging_rooms_price_per_check" CHECK (price_per in ('room', 'guest'));--> statement-breakpoint
ALTER TABLE "lodging_settings" ADD CONSTRAINT "lodging_settings_min_nights" CHECK (min_nights between 1 and 30);--> statement-breakpoint
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_total_check" CHECK (total_agorot is null or total_agorot >= 0);--> statement-breakpoint
-- The price list is the office's, like the rooms (0072).
alter table lodging_rates enable row level security;
--> statement-breakpoint
grant select, insert, update, delete on lodging_rates to authenticated, rswim_system;
--> statement-breakpoint
create policy lodging_rates_office on lodging_rates for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
--> statement-breakpoint
create trigger set_updated_at before update on lodging_rates for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger audit_row after insert or update or delete on lodging_rates for each row execute function app.audit_row();
--> statement-breakpoint
-- Stays booked before the price list keep the price they were shown: the room's price per night (a dorm's per bed).
update lodging_stays s set total_agorot = r.price_night_agorot * (s.check_out - s.check_in)
  from lodging_rooms r
  where r.organization_id = s.organization_id and r.id = s.room_id
    and r.price_night_agorot is not null and s.total_agorot is null;
