CREATE TABLE "lodging_beds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lodging_beds_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "lodging_beds_room_position" UNIQUE("room_id","position")
);
--> statement-breakpoint
CREATE TABLE "lodging_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"sold_by" text DEFAULT 'room' NOT NULL,
	"beds" integer NOT NULL,
	"max_guests" integer NOT NULL,
	"toilet" text DEFAULT 'private' NOT NULL,
	"shower" text DEFAULT 'private' NOT NULL,
	"price_night_agorot" integer,
	"note" text,
	"housekeeping" text DEFAULT 'clean' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lodging_rooms_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "lodging_rooms_org_name" UNIQUE("organization_id","name"),
	CONSTRAINT "lodging_rooms_kind_check" CHECK (kind in ('single', 'double', 'family', 'dorm', 'suite', 'other')),
	CONSTRAINT "lodging_rooms_sold_by_check" CHECK (sold_by in ('room', 'bed')),
	CONSTRAINT "lodging_rooms_toilet_check" CHECK (toilet in ('private', 'shared')),
	CONSTRAINT "lodging_rooms_shower_check" CHECK (shower in ('private', 'shared')),
	CONSTRAINT "lodging_rooms_housekeeping_check" CHECK (housekeeping in ('clean', 'dirty', 'out_of_order')),
	CONSTRAINT "lodging_rooms_beds_check" CHECK (beds between 1 and 40),
	CONSTRAINT "lodging_rooms_guests_check" CHECK (max_guests between 1 and 60),
	CONSTRAINT "lodging_rooms_price_check" CHECK (price_night_agorot is null or price_night_agorot >= 0)
);
--> statement-breakpoint
CREATE TABLE "lodging_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"check_in_time" text DEFAULT '15:00' NOT NULL,
	"check_out_time" text DEFAULT '11:00' NOT NULL,
	"morning_brief" boolean DEFAULT true NOT NULL,
	"brief_phone_e164" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lodging_settings_check_in" CHECK (check_in_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "lodging_settings_check_out" CHECK (check_out_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "lodging_stays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"bed_id" uuid,
	"guest_name" text NOT NULL,
	"phone_e164" text,
	"guests" integer DEFAULT 1 NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"source" text DEFAULT 'office' NOT NULL,
	"note" text,
	"lead_id" uuid,
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lodging_stays_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "lodging_stays_status_check" CHECK (status in ('held', 'confirmed', 'checked_in', 'checked_out', 'cancelled')),
	CONSTRAINT "lodging_stays_source_check" CHECK (source in ('office', 'bot', 'online')),
	CONSTRAINT "lodging_stays_dates_check" CHECK (check_out > check_in),
	CONSTRAINT "lodging_stays_guests_check" CHECK (guests between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "lodging_beds" ADD CONSTRAINT "lodging_beds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lodging_beds" ADD CONSTRAINT "lodging_beds_room_fk" FOREIGN KEY ("organization_id","room_id") REFERENCES "public"."lodging_rooms"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lodging_rooms" ADD CONSTRAINT "lodging_rooms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lodging_settings" ADD CONSTRAINT "lodging_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_room_fk" FOREIGN KEY ("organization_id","room_id") REFERENCES "public"."lodging_rooms"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_bed_fk" FOREIGN KEY ("organization_id","bed_id") REFERENCES "public"."lodging_beds"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lodging_stays_room_dates" ON "lodging_stays" USING btree ("organization_id","room_id","check_in","check_out");--> statement-breakpoint
CREATE INDEX "lodging_stays_org_dates" ON "lodging_stays" USING btree ("organization_id","check_in","check_out");