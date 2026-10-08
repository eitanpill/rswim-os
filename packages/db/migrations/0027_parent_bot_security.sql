-- Parents' bot security layer: FKs drizzle cannot express, triggers, grants and RLS for the bot's log and knowledge.

-- ─── FKs with SET NULL on one column of a composite key ─────────────────────
alter table bot_replies
  add constraint bot_replies_household_fk foreign key (organization_id, household_id)
    references households (organization_id, id) on delete set null (household_id),
  add constraint bot_replies_message_fk foreign key (organization_id, message_id)
    references messages (organization_id, id) on delete set null (message_id);
alter table bot_knowledge
  add constraint bot_knowledge_inbound_fk foreign key (organization_id, source_inbound_message_id)
    references inbound_messages (organization_id, id) on delete set null (source_inbound_message_id);
--> statement-breakpoint

-- ─── Triggers ───────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['bot_replies', 'bot_knowledge'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function app.set_updated_at()', t);
  end loop;
end $$;
create trigger audit_row after insert or update or delete on bot_knowledge
  for each row execute function app.audit_row();
--> statement-breakpoint

-- ─── Grants ─────────────────────────────────────────────────────────────────
select app.apply_standard_grants();
revoke select on staff_invites from authenticated;
grant select (id, organization_id, role, email, phone_e164, staff_member_id, expires_at, accepted_at,
              accepted_by, revoked_at, created_by, created_at) on staff_invites to authenticated;
grant execute on all functions in schema app to authenticated, rswim_system;
revoke execute on function app.apply_standard_grants() from public, authenticated, rswim_system;
--> statement-breakpoint

-- ─── Row level security ─────────────────────────────────────────────────────
-- Like the inbox: owner/admin (and the tenant's worker, which runs the bot) only. Families see the bot's answers as
-- ordinary messages in their conversation, never the log or the knowledge base.
do $$
declare t text;
begin
  foreach t in array array['bot_replies', 'bot_knowledge'] loop
    execute format($p$create policy %1$s_office on %1$I for all to authenticated, rswim_system
      using (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))
      with check (organization_id = (select app.current_org()) and (select app.is_owner_or_admin()))$p$, t);
  end loop;
end $$;
