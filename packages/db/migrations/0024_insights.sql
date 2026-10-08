CREATE TABLE "owner_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"params" jsonb NOT NULL,
	"detail" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"href" text,
	"note" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"first_seen_on" date NOT NULL,
	"last_seen_on" date NOT NULL,
	"snoozed_until" date,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_insights_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "owner_insights_key" UNIQUE("organization_id","key"),
	CONSTRAINT "owner_insights_kind_check" CHECK (kind in ('group_emptying', 'churn_risk', 'leaving', 'old_debts', 'venue_loss', 'waitlist_cluster', 'trial_followup', 'uncovered_lessons', 'staff_overload')),
	CONSTRAINT "owner_insights_severity_check" CHECK (severity in ('high', 'medium', 'low')),
	CONSTRAINT "owner_insights_status_check" CHECK (status in ('open', 'dismissed', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "owner_insights" ADD CONSTRAINT "owner_insights_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_insights_status" ON "owner_insights" USING btree ("organization_id","status");