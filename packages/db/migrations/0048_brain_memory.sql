CREATE TABLE "business_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text DEFAULT 'school' NOT NULL,
	"subject_id" uuid,
	"subject_label" text,
	"body" text,
	"summary" jsonb,
	"happened_on" date NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_memories_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "business_memories_source_ref" UNIQUE("organization_id","source_ref"),
	CONSTRAINT "business_memories_kind_check" CHECK (kind in ('note', 'event')),
	CONSTRAINT "business_memories_subject_check" CHECK (subject_type in ('school', 'household', 'student', 'staff', 'venue', 'group')),
	CONSTRAINT "business_memories_source_check" CHECK (source in ('owner_chat', 'owner_whatsapp', 'owner_screen', 'system')),
	CONSTRAINT "business_memories_shape_check" CHECK (("business_memories"."kind" = 'note' and "business_memories"."body" is not null) or ("business_memories"."kind" = 'event' and "business_memories"."summary" is not null))
);
--> statement-breakpoint
CREATE TABLE "business_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period" text NOT NULL,
	"facts" jsonb NOT NULL,
	"final" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_snapshots_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "business_snapshots_period" UNIQUE("organization_id","period"),
	CONSTRAINT "business_snapshots_period_check" CHECK ("business_snapshots"."period" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "business_memories" ADD CONSTRAINT "business_memories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_snapshots" ADD CONSTRAINT "business_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_memories_recent" ON "business_memories" USING btree ("organization_id","happened_on");--> statement-breakpoint
CREATE INDEX "business_memories_subject" ON "business_memories" USING btree ("organization_id","subject_type","subject_id");