CREATE TABLE "directory_memberships" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_databases" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"project_ref" text,
	"region" text,
	"connection_sealed" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_databases_project_ref" UNIQUE("project_ref"),
	CONSTRAINT "tenant_databases_status_check" CHECK (status in ('requested', 'creating', 'migrating', 'seeding', 'ready', 'failed')),
	CONSTRAINT "tenant_databases_provider_check" CHECK (provider in ('supabase', 'local'))
);
--> statement-breakpoint
ALTER TABLE "directory_memberships" ADD CONSTRAINT "directory_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_databases" ADD CONSTRAINT "tenant_databases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "directory_memberships_user" ON "directory_memberships" USING btree ("user_id");