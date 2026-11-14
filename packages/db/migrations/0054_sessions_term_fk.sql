-- Deleting a term must clear only sessions.term_id. The composite foreign key (organization_id, term_id) used
-- "on delete set null" on both columns, so a term deleted before its sessions (e.g. when an organization is deleted
-- and the cascade reaches terms first) tried to null sessions.organization_id and failed. Same pattern as 0005.
alter table sessions drop constraint sessions_term_fk;
--> statement-breakpoint
alter table sessions add constraint sessions_term_fk foreign key (organization_id, term_id)
    references terms (organization_id, id) on delete set null (term_id);
