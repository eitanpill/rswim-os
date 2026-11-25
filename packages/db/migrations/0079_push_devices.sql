CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "push_devices_token" UNIQUE("organization_id","token"),
	CONSTRAINT "push_devices_platform_check" CHECK (platform in ('ios', 'android'))
);
--> statement-breakpoint
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_channel_check";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_channel_check";--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_devices_user" ON "push_devices" USING btree ("organization_id","user_id");--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_channel_check" CHECK (channel in ('whatsapp', 'sms', 'push'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_check" CHECK (channel in ('whatsapp', 'sms', 'push'));--> statement-breakpoint
-- Store stage 6: the store app's push tokens. A person sees and forgets only their own; the tenant's worker reads them
-- to send and removes dead ones. Registering goes through public.register_push_device, which also moves a token from
-- whoever used the phone before (a shared family phone, someone signing in after another signed out).
alter table push_devices enable row level security;
--> statement-breakpoint
grant select, delete on push_devices to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on push_devices to rswim_system;
--> statement-breakpoint
create policy push_devices_own on push_devices for all to authenticated, rswim_system
  using (organization_id = (select app.current_org())
         and (user_id = (select app.current_user_id()) or (select app.current_app_role()) = 'system'))
  with check (organization_id = (select app.current_org())
         and (user_id = (select app.current_user_id()) or (select app.current_app_role()) = 'system'));
--> statement-breakpoint
create trigger set_updated_at before update on push_devices for each row execute function app.set_updated_at();
--> statement-breakpoint
create or replace function public.register_push_device(p_platform text, p_token text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := app.current_user_id();
  org uuid := app.current_org();
begin
  if uid is null or org is null or not exists (
    select 1 from memberships m where m.organization_id = org and m.user_id = uid and m.status = 'active'
  ) then
    raise exception 'common.errors.forbidden' using errcode = 'RSW01';
  end if;
  if p_platform not in ('ios', 'android') or length(coalesce(p_token, '')) not between 16 and 4096 then
    raise exception 'common.errors.invalid' using errcode = 'RSW01';
  end if;
  insert into push_devices (organization_id, user_id, platform, token)
  values (org, uid, p_platform, p_token)
  on conflict (organization_id, token)
  do update set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
end $$;
--> statement-breakpoint
revoke execute on function public.register_push_device(text, text) from public, anon;
--> statement-breakpoint
grant execute on function public.register_push_device(text, text) to authenticated;
--> statement-breakpoint
-- Deleting an account takes the person's push tokens with it.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := app.current_user_id();
begin
  if uid is null then raise exception 'common.errors.forbidden' using errcode = 'RSW01'; end if;
  if exists (select 1 from public.my_sole_owned_schools()) then
    raise exception 'account.errors.soleOwner' using errcode = 'RSW01';
  end if;
  delete from join_requests where user_id = uid and status in ('new', 'declined', 'withdrawn');
  delete from push_devices where user_id = uid;
  delete from auth.users where id = uid;
end $$;
