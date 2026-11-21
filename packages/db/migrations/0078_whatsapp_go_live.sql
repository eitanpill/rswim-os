ALTER TABLE "message_templates" ADD COLUMN "meta_template_id" text;--> statement-breakpoint
ALTER TABLE "message_templates" ADD COLUMN "meta_status" text;--> statement-breakpoint
ALTER TABLE "message_templates" ADD COLUMN "meta_error" text;--> statement-breakpoint
ALTER TABLE "message_templates" ADD COLUMN "meta_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD COLUMN "verified_name" text;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD COLUMN "quality" text;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD COLUMN "subscribed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD COLUMN "check_error" text;--> statement-breakpoint
-- WhatsApp track W10: the office reads the connection check's result like the rest of the connection (never secrets).
grant select (verified_name, quality, checked_at, subscribed_at, check_error) on whatsapp_connections to authenticated;
