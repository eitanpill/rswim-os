-- WhatsApp track, stage 1: one list of leads for swim schools and freediving clubs (docs/whatsapp/PLAN.md).
-- A freediving club's leads move here from dive_leads (contacted -> talking, booked -> joined), program -> interest.

CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text,
	"phone_e164" text,
	"source" text NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"interest" text,
	"origin" text,
	"note" text,
	"lost_reason" text,
	"next_action_on" date,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_message" text,
	"household_id" uuid,
	"diver_id" uuid,
	"join_request_id" uuid,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "leads_stage_check" CHECK (stage in ('new', 'talking', 'trial_booked', 'joined', 'lost')),
	CONSTRAINT "leads_source_check" CHECK (source in ('whatsapp', 'join_link', 'instagram', 'facebook', 'google', 'website', 'referral', 'hotel', 'walk_in', 'phone', 'other')),
	CONSTRAINT "leads_origin_check" CHECK (origin is null or origin in ('eilat', 'israel', 'abroad')),
	CONSTRAINT "leads_lost_check" CHECK ((lost_reason is null or stage = 'lost') and (lost_reason is null or lost_reason in ('price', 'schedule', 'location', 'no_answer', 'chose_other', 'not_relevant', 'other'))),
	CONSTRAINT "leads_who_check" CHECK ("leads"."name" is not null or "leads"."phone_e164" is not null)
);
--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_phone" ON "leads" USING btree ("organization_id","phone_e164") WHERE phone_e164 is not null;--> statement-breakpoint
CREATE INDEX "leads_org_stage" ON "leads" USING btree ("organization_id","stage","created_at");--> statement-breakpoint
CREATE INDEX "inbound_messages_lead" ON "inbound_messages" USING btree ("lead_id");
--> statement-breakpoint
INSERT INTO "leads" ("id", "organization_id", "name", "phone_e164", "source", "stage", "interest", "origin", "note",
                     "next_action_on", "stage_changed_at", "created_at", "updated_at")
SELECT l.id, l.organization_id, l.name, l.phone_e164, l.source,
       CASE l.stage WHEN 'contacted' THEN 'talking' WHEN 'booked' THEN 'joined' ELSE l.stage END,
       p.name_he, l.origin, l.note, l.next_action_on, l.updated_at, l.created_at, l.updated_at
FROM "dive_leads" l LEFT JOIN "dive_programs" p ON p.id = l.interest_program_id
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP TABLE "dive_leads" CASCADE;
