CREATE TABLE "billing_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"billing_run_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"student_id" uuid,
	"enrollment_id" uuid,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"description" text NOT NULL,
	"amount_agorot" integer NOT NULL,
	"applies_to_line_id" uuid,
	"session_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_price" boolean DEFAULT false NOT NULL,
	"explanation" jsonb NOT NULL,
	"policy_version_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_run_lines_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "billing_run_lines_kind_check" CHECK (kind in ('seat', 'slots', 'package', 'trial', 'sibling_discount')),
	CONSTRAINT "billing_run_lines_period_check" CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "billing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"anomalies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"drafted_by" uuid,
	"drafted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_runs_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "billing_runs_period_check" CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "billing_runs_status_check" CHECK (status in ('draft', 'posted', 'discarded'))
);
--> statement-breakpoint
CREATE TABLE "cancellation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"last_charged_period" text NOT NULL,
	"ends_on" date NOT NULL,
	"explanation" jsonb NOT NULL,
	"policy_version_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"recorded_by" uuid,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_requests_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "cancellation_requests_period_check" CHECK (last_charged_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "cancellation_requests_status_check" CHECK (status in ('active', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "dunning_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"payment_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_on" date NOT NULL,
	"amount_agorot" integer NOT NULL,
	"retries_done" smallint DEFAULT 0 NOT NULL,
	"next_action_on" date,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_version_key" text,
	"escalated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dunning_cases_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dunning_cases_status_check" CHECK (status in ('open', 'escalated', 'resolved', 'written_off')),
	CONSTRAINT "dunning_cases_retries_check" CHECK ("dunning_cases"."retries_done" >= 0)
);
--> statement-breakpoint
CREATE TABLE "enrollment_freezes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"file_id" uuid,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"policy_version_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_freezes_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "enrollment_freezes_dates_check" CHECK ("enrollment_freezes"."to_date" >= "enrollment_freezes"."from_date"),
	CONSTRAINT "enrollment_freezes_reason_check" CHECK (reason in ('medical', 'vacation', 'other')),
	CONSTRAINT "enrollment_freezes_status_check" CHECK (status in ('requested', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "fiscal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"payment_id" uuid,
	"kind" text DEFAULT 'invoice_receipt' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"period" text,
	"provider" text NOT NULL,
	"external_id" text,
	"number" text,
	"pdf_url" text,
	"total_agorot" integer NOT NULL,
	"request" jsonb NOT NULL,
	"error" jsonb,
	"idempotency_key" text NOT NULL,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_documents_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "fiscal_documents_idempotency" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "fiscal_documents_kind_check" CHECK (kind in ('invoice_receipt', 'credit_note')),
	CONSTRAINT "fiscal_documents_status_check" CHECK (status in ('pending', 'issued', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "household_billing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"payer_name" text,
	"payer_email" text,
	"enc_payer_national_id" "bytea",
	"payer_id_last4" text,
	"reimbursement_profile_id" uuid,
	"preferred_method" text DEFAULT 'standing_order' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_billing_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "household_billing_household" UNIQUE("household_id"),
	CONSTRAINT "household_billing_method_check" CHECK (preferred_method in ('standing_order', 'payment_link', 'manual')),
	CONSTRAINT "household_billing_last4_check" CHECK ("household_billing"."payer_id_last4" is null or "household_billing"."payer_id_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"student_id" uuid,
	"enrollment_id" uuid,
	"type" text NOT NULL,
	"amount_agorot" integer NOT NULL,
	"period" text,
	"description" text NOT NULL,
	"occurred_on" date NOT NULL,
	"source" text NOT NULL,
	"billing_run_id" uuid,
	"billing_run_line_id" uuid,
	"payment_id" uuid,
	"reverses_entry_id" uuid,
	"policy_version_key" text,
	"explanation" jsonb,
	"idempotency_key" text NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "ledger_entries_idempotency" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "ledger_entries_reversal_once" UNIQUE("reverses_entry_id"),
	CONSTRAINT "ledger_entries_type_check" CHECK (type in ('charge', 'discount', 'credit', 'payment', 'refund', 'write_off', 'adjustment')),
	CONSTRAINT "ledger_entries_source_check" CHECK (source in ('billing_run', 'manual', 'trial_offset', 'closure_credit', 'payment', 'refund', 'reversal')),
	CONSTRAINT "ledger_entries_period_check" CHECK (period is null or period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "ledger_entries_sign_check" CHECK ("ledger_entries"."amount_agorot" <> 0 and case
        when "ledger_entries"."reverses_entry_id" is not null then true
        when "ledger_entries"."type" in ('charge', 'refund') then "ledger_entries"."amount_agorot" > 0
        when "ledger_entries"."type" in ('discount', 'credit', 'payment', 'write_off') then "ledger_entries"."amount_agorot" < 0
        else true end)
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"amount_agorot" integer NOT NULL,
	"description" text NOT NULL,
	"terms_text" text,
	"provider" text DEFAULT 'grow' NOT NULL,
	"external_id" text,
	"url" text,
	"status" text DEFAULT 'open' NOT NULL,
	"billing_run_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_by" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_links_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "payment_links_idempotency" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "payment_links_amount_check" CHECK ("payment_links"."amount_agorot" > 0),
	CONSTRAINT "payment_links_status_check" CHECK (status in ('open', 'paid', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text DEFAULT 'payment' NOT NULL,
	"method" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_agorot" integer NOT NULL,
	"provider" text,
	"external_id" text,
	"billing_run_id" uuid,
	"standing_order_id" uuid,
	"payment_link_id" uuid,
	"refund_of_payment_id" uuid,
	"attempt" smallint DEFAULT 1 NOT NULL,
	"failure_reason" text,
	"paid_on" date,
	"recorded_by" uuid,
	"received_by_staff_id" uuid,
	"handed_over_at" timestamp with time zone,
	"proof_file_id" uuid,
	"note" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "payments_idempotency" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "payments_kind_check" CHECK (kind in ('payment', 'refund')),
	CONSTRAINT "payments_method_check" CHECK (method in ('credit_card', 'standing_order', 'bit', 'paybox', 'cash', 'bank_transfer', 'cheque', 'other')),
	CONSTRAINT "payments_source_check" CHECK ("payments"."source" in ('provider', 'manual')),
	CONSTRAINT "payments_status_check" CHECK (status in ('pending', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_agorot" > 0),
	CONSTRAINT "payments_attempt_check" CHECK ("payments"."attempt" >= 1)
);
--> statement-breakpoint
CREATE TABLE "reimbursement_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"wording" text NOT NULL,
	"requires_national_id" boolean DEFAULT true NOT NULL,
	"include_session_dates" boolean DEFAULT true NOT NULL,
	"split_per_month" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reimbursement_profiles_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "reimbursement_profiles_name" UNIQUE("organization_id","name"),
	CONSTRAINT "reimbursement_profiles_kind_check" CHECK (kind in ('ministry_of_defense', 'insurance', 'reservists', 'employer', 'other'))
);
--> statement-breakpoint
CREATE TABLE "standing_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"provider" text DEFAULT 'grow' NOT NULL,
	"mandate_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"card_last4" text,
	"day_of_month" smallint,
	"amount_agorot" integer,
	"last_failure_at" timestamp with time zone,
	"last_failure_reason" text,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standing_orders_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "standing_orders_mandate" UNIQUE("organization_id","provider","mandate_id"),
	CONSTRAINT "standing_orders_status_check" CHECK (status in ('active', 'failing', 'cancelled')),
	CONSTRAINT "standing_orders_day_check" CHECK ("standing_orders"."day_of_month" is null or "standing_orders"."day_of_month" between 1 and 28)
);
--> statement-breakpoint
ALTER TABLE "billing_run_lines" ADD CONSTRAINT "billing_run_lines_run_fk" FOREIGN KEY ("organization_id","billing_run_id") REFERENCES "public"."billing_runs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_run_lines" ADD CONSTRAINT "billing_run_lines_household_fk" FOREIGN KEY ("organization_id","household_id") REFERENCES "public"."households"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_enrollment_fk" FOREIGN KEY ("organization_id","enrollment_id") REFERENCES "public"."enrollments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_cases" ADD CONSTRAINT "dunning_cases_household_fk" FOREIGN KEY ("organization_id","household_id") REFERENCES "public"."households"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_freezes" ADD CONSTRAINT "enrollment_freezes_enrollment_fk" FOREIGN KEY ("organization_id","enrollment_id") REFERENCES "public"."enrollments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_household_fk" FOREIGN KEY ("organization_id","household_id") REFERENCES "public"."households"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_billing" ADD CONSTRAINT "household_billing_household_fk" FOREIGN KEY ("organization_id","household_id") REFERENCES "public"."households"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_household_fk" FOREIGN KEY ("organization_id","household_id") REFERENCES "public"."households"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_fk" FOREIGN KEY ("organization_id","reverses_entry_id") REFERENCES "public"."ledger_entries"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_household_fk" FOREIGN KEY ("organization_id","household_id") REFERENCES "public"."households"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_household_fk" FOREIGN KEY ("organization_id","household_id") REFERENCES "public"."households"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_profiles" ADD CONSTRAINT "reimbursement_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_orders" ADD CONSTRAINT "standing_orders_household_fk" FOREIGN KEY ("organization_id","household_id") REFERENCES "public"."households"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_run_lines_run_household" ON "billing_run_lines" USING btree ("billing_run_id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_runs_one_per_period" ON "billing_runs" USING btree ("organization_id","period") WHERE status <> 'discarded';--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_requests_one_active" ON "cancellation_requests" USING btree ("enrollment_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "dunning_cases_one_open" ON "dunning_cases" USING btree ("household_id") WHERE status in ('open', 'escalated');--> statement-breakpoint
CREATE INDEX "enrollment_freezes_enrollment" ON "enrollment_freezes" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "fiscal_documents_household" ON "fiscal_documents" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_household" ON "ledger_entries" USING btree ("household_id","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_links_external" ON "payment_links" USING btree ("provider","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE INDEX "payment_links_household" ON "payment_links" USING btree ("household_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_external" ON "payments" USING btree ("provider","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE INDEX "payments_household" ON "payments" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "standing_orders_household" ON "standing_orders" USING btree ("household_id","status");