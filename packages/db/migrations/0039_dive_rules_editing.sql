-- The club's rules are edited in a screen (owner and manager). The front desk keeps reading them, but writing a
-- version needs settings.write, and a version that took effect before today is history: it is never changed or
-- removed, because past decisions (closing the sea, the deepest allowed target) were made under it.
create policy dive_rule_sets_write_insert on dive_rule_sets as restrictive for insert to authenticated
  with check ((select app.has_permission('settings.write')) and effective_from >= app.today());
--> statement-breakpoint
create policy dive_rule_sets_write_update on dive_rule_sets as restrictive for update to authenticated
  using ((select app.has_permission('settings.write')) and effective_from >= app.today())
  with check ((select app.has_permission('settings.write')) and effective_from >= app.today());
--> statement-breakpoint
create policy dive_rule_sets_write_delete on dive_rule_sets as restrictive for delete to authenticated
  using ((select app.has_permission('settings.write')) and effective_from >= app.today());
