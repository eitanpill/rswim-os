ALTER TABLE "bot_replies" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
CREATE INDEX "bot_replies_lead" ON "bot_replies" USING btree ("lead_id","created_at");--> statement-breakpoint
alter table bot_replies
  add constraint bot_replies_lead_fk foreign key (organization_id, lead_id)
    references leads (organization_id, id) on delete set null (lead_id);
