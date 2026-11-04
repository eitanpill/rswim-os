CREATE TABLE "checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"token" text NOT NULL,
	"purpose" text NOT NULL,
	"household_id" uuid,
	"payment_link_id" uuid,
	"ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"amount_agorot" integer NOT NULL,
	"description" text NOT NULL,
	"methods" text[] NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"provider" text,
	"method" text,
	"external_id" text,
	"payment_id" uuid,
	"standing_order_id" uuid,
	"failure_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkouts_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "checkouts_purpose_check" CHECK (purpose in ('household', 'mandate', 'dive_booking', 'dive_pass')),
	CONSTRAINT "checkouts_status_check" CHECK (status in ('open', 'paid', 'failed', 'expired', 'cancelled')),
	CONSTRAINT "checkouts_method_check" CHECK (method is null or method in ('card', 'bit', 'standing_order')),
	CONSTRAINT "checkouts_methods_check" CHECK (methods <@ array['card', 'bit', 'standing_order']::text[] and cardinality(methods) > 0),
	CONSTRAINT "checkouts_amount_check" CHECK ("checkouts"."amount_agorot" > 0 or ("checkouts"."purpose" = 'mandate' and "checkouts"."amount_agorot" = 0)),
	CONSTRAINT "checkouts_household_check" CHECK ("checkouts"."purpose" not in ('household', 'mandate') or "checkouts"."household_id" is not null),
	CONSTRAINT "checkouts_token_check" CHECK (length("checkouts"."token") >= 24)
);
--> statement-breakpoint
CREATE TABLE "payment_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"methods" text[] NOT NULL,
	"enc_credentials" "bytea" NOT NULL,
	"enc_webhook_secret" "bytea" NOT NULL,
	"credential_hints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_check_error" text,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_connections_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "payment_connections_org" UNIQUE("organization_id"),
	CONSTRAINT "payment_connections_provider_check" CHECK (provider in ('grow', 'cardcom', 'tranzila', 'payplus', 'fake')),
	CONSTRAINT "payment_connections_status_check" CHECK (status in ('connected', 'failed', 'disconnected')),
	CONSTRAINT "payment_connections_methods_check" CHECK (methods <@ array['card', 'bit', 'standing_order']::text[] and cardinality(methods) > 0)
);
--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_household_fk" FOREIGN KEY ("organization_id","household_id") REFERENCES "public"."households"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_link_fk" FOREIGN KEY ("organization_id","payment_link_id") REFERENCES "public"."payment_links"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_connections" ADD CONSTRAINT "payment_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkouts_token" ON "checkouts" USING btree ("token");--> statement-breakpoint
CREATE INDEX "checkouts_household" ON "checkouts" USING btree ("household_id","status");