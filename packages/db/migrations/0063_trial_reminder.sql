-- The owner is reminded before the free trial ends and the first charge (docs/saas/DECISIONS.md, decision 9).
-- plans.trial_reminder_days is how many days before the trial's last day the reminder starts.

ALTER TABLE "plans" ADD COLUMN "trial_reminder_days" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_trial_reminder_days_check" CHECK ("plans"."trial_reminder_days" >= 0);
