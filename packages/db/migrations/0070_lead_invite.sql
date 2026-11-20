ALTER TABLE "leads" ADD COLUMN "invite_token" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "invite_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "invite_used_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_invite_token" ON "leads" USING btree ("invite_token") WHERE invite_token is not null;