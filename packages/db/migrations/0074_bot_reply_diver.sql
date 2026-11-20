ALTER TABLE "bot_replies" ADD COLUMN "diver_id" uuid;--> statement-breakpoint
CREATE INDEX "bot_replies_diver" ON "bot_replies" USING btree ("diver_id","created_at");