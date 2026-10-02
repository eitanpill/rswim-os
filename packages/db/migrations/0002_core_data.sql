CREATE TABLE "student_relations" (
	"organization_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"related_student_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_relations_student_id_related_student_id_type_pk" PRIMARY KEY("student_id","related_student_id","type"),
	CONSTRAINT "student_relations_order_check" CHECK ("student_relations"."student_id" < "student_relations"."related_student_id"),
	CONSTRAINT "student_relations_type_check" CHECK ("student_relations"."type" in ('sibling', 'friend'))
);
--> statement-breakpoint
CREATE TABLE "lanes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"label" text NOT NULL,
	"ordinal" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lanes_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "lanes_org_pool_id" UNIQUE("organization_id","pool_id","id"),
	CONSTRAINT "lanes_pool_label" UNIQUE("pool_id","label")
);
--> statement-breakpoint
CREATE TABLE "operating_window_lanes" (
	"organization_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"window_id" uuid NOT NULL,
	"lane_id" uuid NOT NULL,
	CONSTRAINT "operating_window_lanes_window_id_lane_id_pk" PRIMARY KEY("window_id","lane_id")
);
--> statement-breakpoint
CREATE TABLE "pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" text NOT NULL,
	"indoor" boolean DEFAULT true NOT NULL,
	"temp_min_c" smallint,
	"temp_max_c" smallint,
	"depth_min_cm" smallint,
	"depth_max_cm" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pools_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "pools_org_venue_id" UNIQUE("organization_id","venue_id","id"),
	CONSTRAINT "pools_venue_name" UNIQUE("venue_id","name")
);
--> statement-breakpoint
CREATE TABLE "venue_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"announced_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_closures_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "venue_closures_dates_check" CHECK ("venue_closures"."ends_on" >= "venue_closures"."starts_on"),
	CONSTRAINT "venue_closures_source_check" CHECK (source in ('school', 'venue', 'authority', 'technical', 'water_quality', 'holiday'))
);
--> statement-breakpoint
CREATE TABLE "venue_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"kind" text DEFAULT 'rent' NOT NULL,
	"rent_model" text DEFAULT 'fixed_monthly' NOT NULL,
	"amount_agorot" integer DEFAULT 0 NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"renewal_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_contracts_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "venue_contracts_kind_check" CHECK (kind in ('rent', 'tender', 'partnership')),
	CONSTRAINT "venue_contracts_rent_model_check" CHECK (rent_model in ('fixed_monthly', 'per_hour', 'per_lane_hour', 'revenue_share', 'none')),
	CONSTRAINT "venue_contracts_amount_check" CHECK ("venue_contracts"."amount_agorot" >= 0),
	CONSTRAINT "venue_contracts_dates_check" CHECK ("venue_contracts"."ends_on" is null or "venue_contracts"."starts_on" is null or "venue_contracts"."ends_on" >= "venue_contracts"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "venue_operating_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"gender_restriction" text DEFAULT 'mixed' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "windows_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "windows_org_pool_id" UNIQUE("organization_id","pool_id","id"),
	CONSTRAINT "windows_weekday_check" CHECK ("venue_operating_windows"."weekday" between 0 and 6),
	CONSTRAINT "windows_time_check" CHECK ("venue_operating_windows"."ends_at" > "venue_operating_windows"."starts_at"),
	CONSTRAINT "windows_dates_check" CHECK ("venue_operating_windows"."effective_to" is null or "venue_operating_windows"."effective_to" > "venue_operating_windows"."effective_from"),
	CONSTRAINT "windows_gender_check" CHECK (gender_restriction in ('mixed', 'female', 'male', 'women', 'men', 'girls', 'boys'))
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"address" text,
	"city" text,
	"parking_instructions" text,
	"entry_instructions" text,
	"front_desk_script" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "venues_org_name" UNIQUE("organization_id","name"),
	CONSTRAINT "venues_kind_check" CHECK (kind in ('country_club', 'hotel', 'community_center', 'municipal', 'other')),
	CONSTRAINT "venues_status_check" CHECK (status in ('prospect', 'active', 'renovation', 'closing', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_he" text NOT NULL,
	"name_en" text,
	"ordinal" smallint NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "levels_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "levels_program_code" UNIQUE("program_id","code")
);
--> statement-breakpoint
CREATE TABLE "policy_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"venue_id" uuid,
	"program_id" uuid,
	"class_template_id" uuid,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_sets_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "policy_sets_scope_from" UNIQUE NULLS NOT DISTINCT("organization_id","scope_type","venue_id","program_id","class_template_id","effective_from"),
	CONSTRAINT "policy_sets_scope_check" CHECK (scope_type in ('class_template', 'venue_program', 'program', 'venue', 'org')),
	CONSTRAINT "policy_sets_scope_columns_check" CHECK (case "policy_sets"."scope_type"
        when 'org' then "policy_sets"."venue_id" is null and "policy_sets"."program_id" is null and "policy_sets"."class_template_id" is null
        when 'venue' then "policy_sets"."venue_id" is not null and "policy_sets"."program_id" is null and "policy_sets"."class_template_id" is null
        when 'program' then "policy_sets"."venue_id" is null and "policy_sets"."program_id" is not null and "policy_sets"."class_template_id" is null
        when 'venue_program' then "policy_sets"."venue_id" is not null and "policy_sets"."program_id" is not null and "policy_sets"."class_template_id" is null
        when 'class_template' then "policy_sets"."class_template_id" is not null
      end),
	CONSTRAINT "policy_sets_dates_check" CHECK ("policy_sets"."effective_to" is null or "policy_sets"."effective_to" > "policy_sets"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "price_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"duration_min" smallint,
	"sessions_count" smallint,
	"amount_agorot" integer NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_items_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "price_items_key" UNIQUE NULLS NOT DISTINCT("price_list_id","program_id","kind","duration_min","sessions_count"),
	CONSTRAINT "price_items_kind_check" CHECK (kind in ('monthly', 'trial', 'single', 'package', 'entry_fee')),
	CONSTRAINT "price_items_amount_check" CHECK ("price_items"."amount_agorot" >= 0),
	CONSTRAINT "price_items_sessions_check" CHECK ("price_items"."kind" <> 'package' or "price_items"."sessions_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"venue_id" uuid,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "price_lists_status_check" CHECK ("price_lists"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "price_lists_dates_check" CHECK ("price_lists"."effective_to" is null or "price_lists"."effective_to" > "price_lists"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"name_he" text NOT NULL,
	"name_en" text,
	"default_duration_min" smallint NOT NULL,
	"default_capacity" smallint NOT NULL,
	"min_age_months" smallint,
	"max_age_months" smallint,
	"parent_in_water" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "programs_org_code" UNIQUE("organization_id","code"),
	CONSTRAINT "programs_kind_check" CHECK (kind in ('group_kids', 'baby', 'adult_beginner', 'adult_style', 'private', 'pair', 'trio', 'therapy', 'after_school', 'intensive_course', 'camp', 'school_program')),
	CONSTRAINT "programs_duration_check" CHECK ("programs"."default_duration_min" between 5 and 240),
	CONSTRAINT "programs_capacity_check" CHECK ("programs"."default_capacity" between 1 and 100),
	CONSTRAINT "programs_age_check" CHECK ("programs"."min_age_months" is null or "programs"."max_age_months" is null or "programs"."max_age_months" >= "programs"."min_age_months")
);
--> statement-breakpoint
CREATE TABLE "availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"starts_at" time,
	"ends_at" time,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_exceptions_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "availability_exceptions_kind_check" CHECK ("availability_exceptions"."kind" in ('unavailable', 'available')),
	CONSTRAINT "availability_exceptions_dates_check" CHECK ("availability_exceptions"."ends_on" >= "availability_exceptions"."starts_on"),
	CONSTRAINT "availability_exceptions_time_check" CHECK (("availability_exceptions"."starts_at" is null) = ("availability_exceptions"."ends_at" is null) and ("availability_exceptions"."ends_at" is null or "availability_exceptions"."ends_at" > "availability_exceptions"."starts_at"))
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"venue_id" uuid,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_rules_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "availability_rules_weekday_check" CHECK ("availability_rules"."weekday" between 0 and 6),
	CONSTRAINT "availability_rules_time_check" CHECK ("availability_rules"."ends_at" > "availability_rules"."starts_at"),
	CONSTRAINT "availability_rules_dates_check" CHECK ("availability_rules"."effective_to" is null or "availability_rules"."effective_to" > "availability_rules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"type" text NOT NULL,
	"issuer" text,
	"issued_on" date,
	"expires_on" date,
	"file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certifications_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "certifications_type_check" CHECK (type in ('swim_instructor', 'lifeguard', 'hydrotherapy', 'baby_swim', 'first_aid', 'pool_operator'))
);
--> statement-breakpoint
CREATE TABLE "pay_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"basis" text NOT NULL,
	"amount_agorot" integer NOT NULL,
	"program_id" uuid,
	"venue_id" uuid,
	"routing" text DEFAULT 'payslip' NOT NULL,
	"travel_allowance_agorot" integer DEFAULT 0 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_rules_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "pay_rules_basis_check" CHECK (basis in ('per_hour', 'per_session', 'per_head')),
	CONSTRAINT "pay_rules_routing_check" CHECK (routing in ('payslip', 'transfer')),
	CONSTRAINT "pay_rules_amount_check" CHECK ("pay_rules"."amount_agorot" >= 0 and "pay_rules"."travel_allowance_agorot" >= 0),
	CONSTRAINT "pay_rules_dates_check" CHECK ("pay_rules"."effective_to" is null or "pay_rules"."effective_to" > "pay_rules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "staff_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" text NOT NULL,
	"email" text,
	"phone_e164" text,
	"staff_member_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "staff_invites_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "staff_invites_role_check" CHECK (role in ('owner', 'admin', 'instructor', 'escort', 'accountant', 'institution_contact')),
	CONSTRAINT "staff_invites_contact_check" CHECK ("staff_invites"."email" is not null or "staff_invites"."phone_e164" is not null)
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"report" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_runs_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "import_runs_status_check" CHECK ("import_runs"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "ghl_synced_hash" text;--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "ghl_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_members" ADD COLUMN "skills" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_members" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "level_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "preferred_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "student_relations" ADD CONSTRAINT "student_relations_student_fk" FOREIGN KEY ("organization_id","student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_relations" ADD CONSTRAINT "student_relations_related_fk" FOREIGN KEY ("organization_id","related_student_id") REFERENCES "public"."students"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lanes" ADD CONSTRAINT "lanes_pool_fk" FOREIGN KEY ("organization_id","pool_id") REFERENCES "public"."pools"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_window_lanes" ADD CONSTRAINT "window_lanes_window_fk" FOREIGN KEY ("organization_id","pool_id","window_id") REFERENCES "public"."venue_operating_windows"("organization_id","pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_window_lanes" ADD CONSTRAINT "window_lanes_lane_fk" FOREIGN KEY ("organization_id","pool_id","lane_id") REFERENCES "public"."lanes"("organization_id","pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_venue_fk" FOREIGN KEY ("organization_id","venue_id") REFERENCES "public"."venues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_closures" ADD CONSTRAINT "venue_closures_venue_fk" FOREIGN KEY ("organization_id","venue_id") REFERENCES "public"."venues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_contracts" ADD CONSTRAINT "venue_contracts_venue_fk" FOREIGN KEY ("organization_id","venue_id") REFERENCES "public"."venues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_operating_windows" ADD CONSTRAINT "windows_pool_fk" FOREIGN KEY ("organization_id","venue_id","pool_id") REFERENCES "public"."pools"("organization_id","venue_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levels" ADD CONSTRAINT "levels_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_sets" ADD CONSTRAINT "policy_sets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_sets" ADD CONSTRAINT "policy_sets_venue_fk" FOREIGN KEY ("organization_id","venue_id") REFERENCES "public"."venues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_sets" ADD CONSTRAINT "policy_sets_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_items" ADD CONSTRAINT "price_items_list_fk" FOREIGN KEY ("organization_id","price_list_id") REFERENCES "public"."price_lists"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_items" ADD CONSTRAINT "price_items_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_venue_fk" FOREIGN KEY ("organization_id","venue_id") REFERENCES "public"."venues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_venue_fk" FOREIGN KEY ("organization_id","venue_id") REFERENCES "public"."venues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rules" ADD CONSTRAINT "pay_rules_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rules" ADD CONSTRAINT "pay_rules_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rules" ADD CONSTRAINT "pay_rules_venue_fk" FOREIGN KEY ("organization_id","venue_id") REFERENCES "public"."venues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venue_closures_venue_dates" ON "venue_closures" USING btree ("venue_id","starts_on");--> statement-breakpoint
CREATE INDEX "windows_venue_weekday" ON "venue_operating_windows" USING btree ("venue_id","weekday");--> statement-breakpoint
CREATE INDEX "price_lists_org_from" ON "price_lists" USING btree ("organization_id","effective_from");--> statement-breakpoint
CREATE INDEX "certifications_expiry" ON "certifications" USING btree ("organization_id","expires_on");--> statement-breakpoint
CREATE INDEX "import_runs_org_started" ON "import_runs" USING btree ("organization_id","created_at");