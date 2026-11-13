CREATE TABLE "join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'join' NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"email" text,
	"children" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"status" text DEFAULT 'new' NOT NULL,
	"guardian_id" uuid,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "join_requests_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "join_requests_kind_check" CHECK (kind in ('join', 'trial')),
	CONSTRAINT "join_requests_status_check" CHECK (status in ('new', 'accepted', 'declined', 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "listed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_guardian_fk" FOREIGN KEY ("organization_id","guardian_id") REFERENCES "public"."guardians"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "join_requests_one_open" ON "join_requests" USING btree ("organization_id","user_id") WHERE status = 'new';--> statement-breakpoint
CREATE INDEX "join_requests_org_status" ON "join_requests" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_city_check" CHECK ("organizations"."city" is null or length("organizations"."city") <= 60);--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_about_check" CHECK ("organizations"."about" is null or length("organizations"."about") <= 400);