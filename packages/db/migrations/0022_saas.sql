CREATE TABLE "org_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"host" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token" text NOT NULL,
	"checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_domains_host_unique" UNIQUE("host"),
	CONSTRAINT "org_domains_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "org_domains_status_check" CHECK (status in ('pending', 'verified', 'failed')),
	CONSTRAINT "org_domains_host_check" CHECK ("org_domains"."host" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);
--> statement-breakpoint
CREATE TABLE "org_subscriptions" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"plan_code" text NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"trial_ends_on" date,
	"mandate_id" text,
	"past_due_since" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_subscriptions_status_check" CHECK (status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"code" text PRIMARY KEY NOT NULL,
	"name_he" text NOT NULL,
	"name_en" text NOT NULL,
	"price_agorot" integer NOT NULL,
	"max_students" integer,
	"max_staff" integer,
	"max_venues" integer,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"trial_days" smallint DEFAULT 14 NOT NULL,
	"grace_days" smallint DEFAULT 10 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_price_check" CHECK ("plans"."price_agorot" >= 0),
	CONSTRAINT "plans_features_check" CHECK (features <@ array['reports', 'courses', 'transport', 'institutions', 'copilot']::text[])
);
--> statement-breakpoint
CREATE TABLE "platform_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period" date NOT NULL,
	"plan_code" text NOT NULL,
	"amount_agorot" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"external_payment_id" text,
	"failure_code" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_invoices_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "platform_invoices_org_period" UNIQUE("organization_id","period"),
	CONSTRAINT "platform_invoices_amount_check" CHECK ("platform_invoices"."amount_agorot" >= 0),
	CONSTRAINT "platform_invoices_status_check" CHECK (status in ('open', 'paid', 'failed', 'void'))
);
--> statement-breakpoint
CREATE TABLE "template_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"installed_by" uuid,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_installs_org_id" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"payload" jsonb NOT NULL,
	"source_organization_id" uuid,
	"created_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_kind_check" CHECK (kind in ('regulations', 'catalog', 'messages')),
	CONSTRAINT "templates_status_check" CHECK (status in ('draft', 'submitted', 'published', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "org_domains" ADD CONSTRAINT "org_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_installs" ADD CONSTRAINT "template_installs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_installs" ADD CONSTRAINT "template_installs_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_source_organization_id_organizations_id_fk" FOREIGN KEY ("source_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_installs_org" ON "template_installs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "templates_status_kind" ON "templates" USING btree ("status","kind");