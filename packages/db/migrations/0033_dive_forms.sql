CREATE TABLE "dive_form_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"diver_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"text_hash" text NOT NULL,
	"signer_name" text NOT NULL,
	"signature" jsonb NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" date,
	"channel" text NOT NULL,
	"recorded_by" uuid,
	"insurer" text,
	"policy_number" text,
	"file_id" uuid,
	"review" text DEFAULT 'none' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_form_signatures_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_form_signatures_kind_check" CHECK (kind in ('health', 'waiver', 'insurance')),
	CONSTRAINT "dive_form_signatures_channel_check" CHECK (channel in ('online', 'desk')),
	CONSTRAINT "dive_form_signatures_review_check" CHECK (review in ('none', 'pending', 'cleared', 'refused')),
	CONSTRAINT "dive_form_signatures_insurance_check" CHECK (kind <> 'insurance' or (insurer is not null and policy_number is not null and valid_until is not null))
);
--> statement-breakpoint
CREATE TABLE "dive_form_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" smallint NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_form_templates_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_form_templates_version" UNIQUE("organization_id","kind","version"),
	CONSTRAINT "dive_form_templates_kind_check" CHECK (kind in ('health', 'waiver', 'insurance')),
	CONSTRAINT "dive_form_templates_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
ALTER TABLE "dive_divers" ADD COLUMN "insurance_expires_on" date;--> statement-breakpoint
ALTER TABLE "dive_form_signatures" ADD CONSTRAINT "dive_form_signatures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_form_signatures" ADD CONSTRAINT "dive_form_signatures_diver_fk" FOREIGN KEY ("organization_id","diver_id") REFERENCES "public"."dive_divers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_form_signatures" ADD CONSTRAINT "dive_form_signatures_template_fk" FOREIGN KEY ("organization_id","template_id") REFERENCES "public"."dive_form_templates"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_form_signatures" ADD CONSTRAINT "dive_form_signatures_file_fk" FOREIGN KEY ("organization_id","file_id") REFERENCES "public"."files"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_form_templates" ADD CONSTRAINT "dive_form_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dive_form_signatures_diver" ON "dive_form_signatures" USING btree ("organization_id","diver_id","kind","signed_at");