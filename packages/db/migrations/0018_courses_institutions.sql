CREATE TABLE "cohort_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"cohort_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cohort_staff_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "cohort_staff_once" UNIQUE("cohort_id","staff_member_id")
);
--> statement-breakpoint
CREATE TABLE "cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"capacity" smallint NOT NULL,
	"registration_closes_on" date,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cohorts_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "cohorts_org_name" UNIQUE("organization_id","name"),
	CONSTRAINT "cohorts_status_check" CHECK (status in ('open', 'closed', 'cancelled')),
	CONSTRAINT "cohorts_dates_check" CHECK ("cohorts"."ends_on" >= "cohorts"."starts_on"),
	CONSTRAINT "cohorts_capacity_check" CHECK ("cohorts"."capacity" between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "institution_contract_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"class_template_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_contract_groups_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "institution_contract_groups_once" UNIQUE("contract_id","class_template_id")
);
--> statement-breakpoint
CREATE TABLE "institution_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"institution_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"pricing" text NOT NULL,
	"amount_agorot" integer NOT NULL,
	"payment_terms_days" smallint DEFAULT 30 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_contracts_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "institution_contracts_pricing_check" CHECK (pricing in ('per_child_month', 'per_session', 'fixed_month')),
	CONSTRAINT "institution_contracts_amount_check" CHECK ("institution_contracts"."amount_agorot" >= 0),
	CONSTRAINT "institution_contracts_terms_check" CHECK ("institution_contracts"."payment_terms_days" between 0 and 180),
	CONSTRAINT "institution_contracts_dates_check" CHECK ("institution_contracts"."ends_on" >= "institution_contracts"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "institution_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"period" text NOT NULL,
	"amount_agorot" integer NOT NULL,
	"lines" jsonb NOT NULL,
	"explanation" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"due_on" date,
	"issued_at" timestamp with time zone,
	"document_id" text,
	"document_number" text,
	"pdf_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_invoices_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "institution_invoices_status_check" CHECK (status in ('draft', 'issuing', 'issued', 'paid', 'cancelled')),
	CONSTRAINT "institution_invoices_period_check" CHECK ("institution_invoices"."period" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "institution_invoices_amount_check" CHECK ("institution_invoices"."amount_agorot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "institution_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_agorot" integer NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"receipt_document_id" text,
	"receipt_number" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_payments_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "institution_payments_method_check" CHECK (method in ('bank_transfer', 'cheque', 'cash', 'other')),
	CONSTRAINT "institution_payments_amount_check" CHECK ("institution_payments"."amount_agorot" <> 0)
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"tax_id" text,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"address" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institutions_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "institutions_org_name" UNIQUE("organization_id","name"),
	CONSTRAINT "institutions_kind_check" CHECK (kind in ('school', 'municipality', 'after_school', 'community_center', 'other'))
);
--> statement-breakpoint
ALTER TABLE "class_templates" ADD COLUMN "cohort_id" uuid;--> statement-breakpoint
ALTER TABLE "cohort_staff" ADD CONSTRAINT "cohort_staff_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohort_staff" ADD CONSTRAINT "cohort_staff_cohort_fk" FOREIGN KEY ("organization_id","cohort_id") REFERENCES "public"."cohorts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohort_staff" ADD CONSTRAINT "cohort_staff_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_contract_groups" ADD CONSTRAINT "institution_contract_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_contract_groups" ADD CONSTRAINT "institution_contract_groups_contract_fk" FOREIGN KEY ("organization_id","contract_id") REFERENCES "public"."institution_contracts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_contract_groups" ADD CONSTRAINT "institution_contract_groups_template_fk" FOREIGN KEY ("organization_id","class_template_id") REFERENCES "public"."class_templates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_contracts" ADD CONSTRAINT "institution_contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_contracts" ADD CONSTRAINT "institution_contracts_institution_fk" FOREIGN KEY ("organization_id","institution_id") REFERENCES "public"."institutions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_invoices" ADD CONSTRAINT "institution_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_invoices" ADD CONSTRAINT "institution_invoices_contract_fk" FOREIGN KEY ("organization_id","contract_id") REFERENCES "public"."institution_contracts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_payments" ADD CONSTRAINT "institution_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_payments" ADD CONSTRAINT "institution_payments_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."institution_invoices"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "institution_invoices_month" ON "institution_invoices" USING btree ("contract_id","period") WHERE status <> 'cancelled';