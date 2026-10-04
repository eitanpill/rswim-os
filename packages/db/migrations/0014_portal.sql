CREATE TABLE "portal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_date" date,
	"to_date" date,
	"reason" text,
	"note" text,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"freeze_id" uuid,
	"cancellation_id" uuid,
	"error" jsonb,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_requests_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "portal_requests_kind_check" CHECK (kind in ('freeze', 'cancellation')),
	CONSTRAINT "portal_requests_status_check" CHECK (status in ('pending', 'done', 'refused', 'withdrawn')),
	CONSTRAINT "portal_requests_freeze_check" CHECK ("portal_requests"."kind" <> 'freeze' or ("portal_requests"."from_date" is not null and "portal_requests"."to_date" >= "portal_requests"."from_date" and "portal_requests"."reason" is not null)),
	CONSTRAINT "portal_requests_reason_check" CHECK (reason is null or reason in ('medical', 'vacation', 'other'))
);
--> statement-breakpoint
ALTER TABLE "portal_requests" ADD CONSTRAINT "portal_requests_enrollment_fk" FOREIGN KEY ("organization_id","enrollment_id") REFERENCES "public"."enrollments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_requests_enrollment" ON "portal_requests" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "portal_requests_pending" ON "portal_requests" USING btree ("organization_id") WHERE status = 'pending';