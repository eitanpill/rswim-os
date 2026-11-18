-- The owner is reminded before the free trial ends and the first charge (docs/saas/DECISIONS.md, decision 9).
-- plans.trial_reminder_days is how many days before the first charge the reminder starts.
-- Written to be safe to run twice, so a database can get it ahead of the worker's release step.

ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "trial_reminder_days" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" DROP CONSTRAINT IF EXISTS "plans_trial_reminder_days_check";--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_trial_reminder_days_check" CHECK ("plans"."trial_reminder_days" >= 0);
