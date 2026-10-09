CREATE TABLE "dive_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"diver_id" uuid NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"target_depth_m" smallint,
	"line_label" text,
	"buddy_diver_id" uuid,
	"pass_id" uuid,
	"price_agorot" integer DEFAULT 0 NOT NULL,
	"booked_via" text DEFAULT 'office' NOT NULL,
	"rule_set_id" uuid,
	"checked_in_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_bookings_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_bookings_session_diver" UNIQUE("session_id","diver_id"),
	CONSTRAINT "dive_bookings_status_check" CHECK (status in ('booked', 'checked_in', 'no_show', 'cancelled')),
	CONSTRAINT "dive_bookings_via_check" CHECK (booked_via in ('office', 'online', 'instructor', 'whatsapp'))
);
--> statement-breakpoint
CREATE TABLE "dive_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"observed_on" date NOT NULL,
	"is_forecast" boolean DEFAULT false NOT NULL,
	"wind_kts" smallint NOT NULL,
	"wind_dir" text NOT NULL,
	"wave_cm" smallint NOT NULL,
	"visibility_m" smallint NOT NULL,
	"water_temp_c" smallint NOT NULL,
	"current" text DEFAULT 'none' NOT NULL,
	"call" text NOT NULL,
	"rule_set_id" uuid,
	"note" text,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_conditions_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_conditions_dir_check" CHECK (wind_dir in ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW')),
	CONSTRAINT "dive_conditions_current_check" CHECK (current in ('none', 'light', 'strong')),
	CONSTRAINT "dive_conditions_call_check" CHECK (call in ('go', 'caution', 'no_go'))
);
--> statement-breakpoint
CREATE TABLE "dive_divers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"guardian_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone_e164" text,
	"email" text,
	"origin" text DEFAULT 'israel' NOT NULL,
	"city" text,
	"country" text,
	"dob" date,
	"gender" text,
	"cert_level" smallint DEFAULT 0 NOT NULL,
	"cert_agency" text,
	"cert_name" text,
	"cert_number" text,
	"pb_cwt_m" smallint,
	"pb_fim_m" smallint,
	"pb_sta_sec" smallint,
	"pb_dyn_m" smallint,
	"depth_limit_m" smallint,
	"medical_expires_on" date,
	"waiver_signed_on" date,
	"emergency_name" text,
	"emergency_phone" text,
	"source" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"joined_on" date DEFAULT current_date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_divers_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_divers_origin_check" CHECK (origin in ('eilat', 'israel', 'abroad')),
	CONSTRAINT "dive_divers_level_check" CHECK (cert_level between 0 and 5),
	CONSTRAINT "dive_divers_gender_check" CHECK (gender is null or gender in ('female', 'male'))
);
--> statement-breakpoint
CREATE TABLE "dive_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"diver_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"instructor_staff_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"started_on" date NOT NULL,
	"completed_on" date,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"theory_score" smallint,
	"cert_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_enrollments_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_enrollments_status_check" CHECK (status in ('active', 'completed', 'dropped'))
);
--> statement-breakpoint
CREATE TABLE "dive_gear" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"size" text,
	"brand" text,
	"status" text DEFAULT 'available' NOT NULL,
	"purchased_on" date,
	"last_service_on" date,
	"service_every_days" smallint,
	"rental_price_agorot" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_gear_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_gear_org_code" UNIQUE("organization_id","code"),
	CONSTRAINT "dive_gear_kind_check" CHECK (kind in ('fins', 'monofin', 'mask', 'snorkel', 'wetsuit', 'weight_belt', 'neck_weight', 'lanyard', 'computer', 'buoy', 'noseclip')),
	CONSTRAINT "dive_gear_status_check" CHECK (status in ('available', 'rented', 'maintenance', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "dive_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid,
	"diver_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"depth_m" smallint,
	"description" text NOT NULL,
	"action_taken" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reported_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_incidents_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_incidents_kind_check" CHECK (kind in ('blackout', 'lmc', 'squeeze', 'barotrauma', 'marine_life', 'cut', 'equipment', 'other')),
	CONSTRAINT "dive_incidents_severity_check" CHECK (severity in ('low', 'medium', 'high')),
	CONSTRAINT "dive_incidents_status_check" CHECK (status in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "dive_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text,
	"source" text NOT NULL,
	"origin" text DEFAULT 'israel' NOT NULL,
	"interest_program_id" uuid,
	"stage" text DEFAULT 'new' NOT NULL,
	"note" text,
	"next_action_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_leads_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_leads_stage_check" CHECK (stage in ('new', 'contacted', 'booked', 'lost')),
	CONSTRAINT "dive_leads_source_check" CHECK (source in ('instagram', 'google', 'referral', 'hotel', 'walk_in', 'whatsapp')),
	CONSTRAINT "dive_leads_origin_check" CHECK (origin in ('eilat', 'israel', 'abroad'))
);
--> statement-breakpoint
CREATE TABLE "dive_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"diver_id" uuid NOT NULL,
	"session_id" uuid,
	"dived_on" date NOT NULL,
	"discipline" text NOT NULL,
	"depth_m" smallint,
	"distance_m" smallint,
	"duration_sec" smallint,
	"outcome" text DEFAULT 'clean' NOT NULL,
	"notes" text,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_logs_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_logs_discipline_check" CHECK (discipline in ('CWT', 'CWTB', 'CNF', 'FIM', 'VWT', 'STA', 'DYN', 'DYNB', 'DNF')),
	CONSTRAINT "dive_logs_outcome_check" CHECK (outcome in ('clean', 'early_turn', 'lmc', 'blackout', 'squeeze', 'ear')),
	CONSTRAINT "dive_logs_measure_check" CHECK (coalesce(depth_m, distance_m, duration_sec) is not null)
);
--> statement-breakpoint
CREATE TABLE "dive_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"diver_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sessions_total" smallint,
	"valid_from" date NOT NULL,
	"valid_until" date NOT NULL,
	"price_agorot" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_passes_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_passes_kind_check" CHECK (kind in ('punch5', 'punch10', 'monthly', 'annual')),
	CONSTRAINT "dive_passes_dates_check" CHECK (valid_until >= valid_from)
);
--> statement-breakpoint
CREATE TABLE "dive_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_he" text NOT NULL,
	"name_en" text NOT NULL,
	"kind" text NOT NULL,
	"agency" text DEFAULT 'club' NOT NULL,
	"min_level" smallint DEFAULT 0 NOT NULL,
	"grants_level" smallint,
	"days" smallint DEFAULT 1 NOT NULL,
	"duration_min" smallint DEFAULT 150 NOT NULL,
	"max_depth_m" smallint,
	"price_agorot" integer NOT NULL,
	"color" text,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_programs_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_programs_org_code" UNIQUE("organization_id","code"),
	CONSTRAINT "dive_programs_kind_check" CHECK (kind in ('experience', 'course', 'training', 'workshop', 'trip')),
	CONSTRAINT "dive_programs_agency_check" CHECK (agency in ('molchanovs', 'aida', 'ssi', 'padi', 'club')),
	CONSTRAINT "dive_programs_level_check" CHECK (min_level between 0 and 5 and (grants_level is null or grants_level between 0 and 5)),
	CONSTRAINT "dive_programs_price_check" CHECK (price_agorot >= 0)
);
--> statement-breakpoint
CREATE TABLE "dive_rentals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"gear_id" uuid NOT NULL,
	"diver_id" uuid NOT NULL,
	"out_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"returned_at" timestamp with time zone,
	"price_agorot" integer DEFAULT 0 NOT NULL,
	"condition_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_rentals_org_id" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "dive_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_rule_sets_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_rule_sets_org_from" UNIQUE("organization_id","effective_from")
);
--> statement-breakpoint
CREATE TABLE "dive_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"diver_id" uuid,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"amount_agorot" integer NOT NULL,
	"method" text NOT NULL,
	"sold_at" timestamp with time zone DEFAULT now() NOT NULL,
	"program_id" uuid,
	"session_id" uuid,
	"receipt_no" text,
	"sold_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_sales_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_sales_kind_check" CHECK (kind in ('course', 'training', 'experience', 'workshop', 'trip', 'pass', 'rental', 'retail')),
	CONSTRAINT "dive_sales_method_check" CHECK (method in ('card', 'cash', 'bit', 'transfer', 'pass'))
);
--> statement-breakpoint
CREATE TABLE "dive_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"lead_staff_id" uuid,
	"assist_staff_id" uuid,
	"capacity" smallint NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"title" text,
	"boat" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_sessions_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_sessions_status_check" CHECK (status in ('scheduled', 'go', 'hold', 'cancelled', 'done')),
	CONSTRAINT "dive_sessions_time_check" CHECK (ends_at > starts_at),
	CONSTRAINT "dive_sessions_capacity_check" CHECK (capacity between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "dive_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"kind" text NOT NULL,
	"max_depth_m" smallint NOT NULL,
	"has_line" boolean DEFAULT true NOT NULL,
	"meeting_point" text,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_sites_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_sites_org_name" UNIQUE("organization_id","name"),
	CONSTRAINT "dive_sites_kind_check" CHECK (kind in ('shore', 'boat', 'pool'))
);
--> statement-breakpoint
CREATE TABLE "dive_staff_certs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"agency" text,
	"number" text,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_staff_certs_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "dive_staff_certs_kind_check" CHECK (kind in ('instructor', 'first_aid', 'oxygen', 'insurance', 'boat_license'))
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "vertical" text DEFAULT 'swim' NOT NULL;--> statement-breakpoint
ALTER TABLE "dive_bookings" ADD CONSTRAINT "dive_bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_bookings" ADD CONSTRAINT "dive_bookings_session_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."dive_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_bookings" ADD CONSTRAINT "dive_bookings_diver_fk" FOREIGN KEY ("organization_id","diver_id") REFERENCES "public"."dive_divers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_conditions" ADD CONSTRAINT "dive_conditions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_divers" ADD CONSTRAINT "dive_divers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_divers" ADD CONSTRAINT "dive_divers_guardian_fk" FOREIGN KEY ("organization_id","guardian_id") REFERENCES "public"."guardians"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_enrollments" ADD CONSTRAINT "dive_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_enrollments" ADD CONSTRAINT "dive_enrollments_diver_fk" FOREIGN KEY ("organization_id","diver_id") REFERENCES "public"."dive_divers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_enrollments" ADD CONSTRAINT "dive_enrollments_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."dive_programs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_gear" ADD CONSTRAINT "dive_gear_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_incidents" ADD CONSTRAINT "dive_incidents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_leads" ADD CONSTRAINT "dive_leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_logs" ADD CONSTRAINT "dive_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_logs" ADD CONSTRAINT "dive_logs_diver_fk" FOREIGN KEY ("organization_id","diver_id") REFERENCES "public"."dive_divers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_passes" ADD CONSTRAINT "dive_passes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_passes" ADD CONSTRAINT "dive_passes_diver_fk" FOREIGN KEY ("organization_id","diver_id") REFERENCES "public"."dive_divers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_programs" ADD CONSTRAINT "dive_programs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_rentals" ADD CONSTRAINT "dive_rentals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_rentals" ADD CONSTRAINT "dive_rentals_gear_fk" FOREIGN KEY ("organization_id","gear_id") REFERENCES "public"."dive_gear"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_rentals" ADD CONSTRAINT "dive_rentals_diver_fk" FOREIGN KEY ("organization_id","diver_id") REFERENCES "public"."dive_divers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_rule_sets" ADD CONSTRAINT "dive_rule_sets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_sales" ADD CONSTRAINT "dive_sales_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_sessions" ADD CONSTRAINT "dive_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_sessions" ADD CONSTRAINT "dive_sessions_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."dive_programs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_sessions" ADD CONSTRAINT "dive_sessions_site_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."dive_sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_staff_certs" ADD CONSTRAINT "dive_staff_certs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dive_staff_certs" ADD CONSTRAINT "dive_staff_certs_staff_fk" FOREIGN KEY ("organization_id","staff_member_id") REFERENCES "public"."staff_members"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dive_bookings_org_diver" ON "dive_bookings" USING btree ("organization_id","diver_id");--> statement-breakpoint
CREATE INDEX "dive_conditions_org_day" ON "dive_conditions" USING btree ("organization_id","observed_on");--> statement-breakpoint
CREATE INDEX "dive_divers_org_guardian" ON "dive_divers" USING btree ("organization_id","guardian_id");--> statement-breakpoint
CREATE INDEX "dive_logs_org_diver" ON "dive_logs" USING btree ("organization_id","diver_id","dived_on");--> statement-breakpoint
CREATE INDEX "dive_sales_org_sold" ON "dive_sales" USING btree ("organization_id","sold_at");--> statement-breakpoint
CREATE INDEX "dive_sessions_org_starts" ON "dive_sessions" USING btree ("organization_id","starts_at");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_vertical_check" CHECK ("organizations"."vertical" in ('swim', 'freediving'));