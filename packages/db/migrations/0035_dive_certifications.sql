CREATE TABLE "dive_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"diver_id" uuid NOT NULL,
	"agency" text NOT NULL,
	"level" smallint NOT NULL,
	"name" text NOT NULL,
	"number" text,
	"issued_on" date,
	"file_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"submitted_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_certifications_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_certifications_agency_check" CHECK (agency in ('molchanovs', 'aida', 'ssi', 'padi', 'cmas', 'other')),
	CONSTRAINT "dive_certifications_status_check" CHECK (status in ('pending', 'verified', 'rejected')),
	CONSTRAINT "dive_certifications_level_check" CHECK (level between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "dive_certifications" ADD CONSTRAINT "dive_certifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_certifications" ADD CONSTRAINT "dive_certifications_diver_fk" FOREIGN KEY ("organization_id","diver_id") REFERENCES "public"."dive_divers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_certifications" ADD CONSTRAINT "dive_certifications_file_fk" FOREIGN KEY ("organization_id","file_id") REFERENCES "public"."files"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dive_certifications_diver" ON "dive_certifications" USING btree ("organization_id","diver_id");--> statement-breakpoint
CREATE INDEX "dive_certifications_status" ON "dive_certifications" USING btree ("organization_id","status");