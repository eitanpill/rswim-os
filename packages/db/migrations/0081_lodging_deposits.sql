CREATE TABLE "lodging_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" text DEFAULT 'payment' NOT NULL,
	"method" text NOT NULL,
	"amount_agorot" integer NOT NULL,
	"checkout_id" uuid,
	"external_id" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lodging_payments_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "lodging_payments_checkout" UNIQUE("organization_id","checkout_id"),
	CONSTRAINT "lodging_payments_kind_check" CHECK (kind in ('payment', 'refund')),
	CONSTRAINT "lodging_payments_method_check" CHECK (method in ('cash', 'card', 'bit', 'transfer', 'online')),
	CONSTRAINT "lodging_payments_amount_check" CHECK (amount_agorot > 0)
);
--> statement-breakpoint
ALTER TABLE "checkouts" DROP CONSTRAINT "checkouts_purpose_check";--> statement-breakpoint
ALTER TABLE "lodging_settings" ADD COLUMN "deposit_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lodging_settings" ADD COLUMN "hold_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "lodging_stays" ADD COLUMN "booking_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "lodging_stays" ADD COLUMN "hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lodging_payments" ADD CONSTRAINT "lodging_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lodging_payments" ADD CONSTRAINT "lodging_payments_checkout_fk" FOREIGN KEY ("organization_id","checkout_id") REFERENCES "public"."checkouts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lodging_payments_booking" ON "lodging_payments" USING btree ("organization_id","booking_id");--> statement-breakpoint
CREATE INDEX "lodging_stays_booking" ON "lodging_stays" USING btree ("organization_id","booking_id");--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_purpose_check" CHECK (purpose in ('household', 'mandate', 'dive_booking', 'dive_pass', 'lodging_stay'));--> statement-breakpoint
ALTER TABLE "lodging_settings" ADD CONSTRAINT "lodging_settings_deposit" CHECK (deposit_percent between 0 and 100);--> statement-breakpoint
ALTER TABLE "lodging_settings" ADD CONSTRAINT "lodging_settings_hold_hours" CHECK (hold_hours between 1 and 168);--> statement-breakpoint
-- A booking's money is the office's, like its stays (0072), and append-only: a mistake is corrected by a refund.
alter table lodging_payments enable row level security;
--> statement-breakpoint
grant select, insert on lodging_payments to authenticated, rswim_system;
--> statement-breakpoint
create policy lodging_payments_office on lodging_payments for all to authenticated, rswim_system
  using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
  with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()));
--> statement-breakpoint
create trigger audit_row after insert or update or delete on lodging_payments for each row execute function app.audit_row();
