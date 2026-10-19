begin;
create table public.invitations(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),email text not null,role text not null check(role in ('admin','fundraiser','accountant','viewer')),token_hash text not null unique,expires_at timestamptz not null default now()+interval '7 days',accepted_at timestamptz,created_at timestamptz not null default now());
create table public.automation_rules(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),name text not null,event text not null check(event='payment_failed'),action text not null check(action='create_task'),min_amount_minor bigint not null default 0 check(min_amount_minor>=0),subject text not null,active boolean not null default true,created_at timestamptz not null default now());
create table public.devices(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),name text not null,serial text not null,location text not null default '',provider text not null default '',status text not null default 'setup_required' check(status='setup_required'),created_at timestamptz not null default now(),unique(organization_id,serial));
create table public.gateway_accounts(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),name text not null,provider text not null,merchant_reference text not null default '',environment text not null check(environment in ('sandbox','production')),status text not null default 'setup_required' check(status='setup_required'),created_at timestamptz not null default now());
create table public.document_templates(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),name text not null,language text not null check(language in ('en','he')),body text not null check(length(body) between 1 and 10000),created_at timestamptz not null default now());
create table public.notification_preferences(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),name text not null,daily_summary boolean not null default false,failed_payment_notices boolean not null default true,receipt_default boolean not null default true,schedule_hour integer not null default 9 check(schedule_hour between 0 and 23),retry_limit integer not null default 3 check(retry_limit between 0 and 10),created_at timestamptz not null default now());
create table public.job_logs(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),name text not null,status text not null check(status in ('completed','failed')),details text not null,created_at timestamptz not null default now());
create table public.webhook_logs(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),provider text not null,event_reference text not null,status text not null check(status in ('processed','failed')),error text not null default '',created_at timestamptz not null default now());

do $$ declare t text;begin
 foreach t in array array['invitations','automation_rules','devices','gateway_accounts','document_templates','notification_preferences','job_logs','webhook_logs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy admin_read on public.%I for select to authenticated using(public.has_organization_role(organization_id,array[''owner'',''admin'']))',t);
 end loop;
 foreach t in array array['automation_rules','devices','gateway_accounts','document_templates','notification_preferences'] loop
  execute format('grant insert on public.%I to authenticated',t);
  execute format('create policy admin_insert on public.%I for insert to authenticated with check(public.has_organization_role(organization_id,array[''owner'',''admin'']))',t);
 end loop;
end $$;

create function public.invite_member(org uuid,invite_email text,invite_role text) returns text language plpgsql security definer set search_path='' as $$
declare token text;begin
 if not public.has_organization_role(org,array['owner','admin']) or invite_role not in ('admin','fundraiser','accountant','viewer') or (invite_role='admin' and not public.has_organization_role(org,array['owner'])) then raise exception 'Permission denied';end if;
 if invite_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(invite_email)>254 then raise exception 'Valid email required';end if;
 perform 1 from public.organizations where id=org for update;
 if (select count(*) from public.invitations where organization_id=org and accepted_at is null and expires_at>now())>=100 then raise exception 'Too many pending invitations';end if;
 token:=gen_random_uuid()::text||gen_random_uuid()::text;
 insert into public.invitations(organization_id,email,role,token_hash) values(org,lower(trim(invite_email)),invite_role,encode(sha256(convert_to(token,'UTF8')),'hex'));return token;
end $$;
create function public.accept_invitation(token text) returns uuid language plpgsql security definer set search_path='' as $$
declare invitation public.invitations;verified_email text;begin
 select email into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if verified_email is null then raise exception 'A verified account is required';end if;
 select * into strict invitation from public.invitations where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') for update;
 if invitation.accepted_at is not null or invitation.expires_at<=now() or lower(verified_email)<>invitation.email then raise exception 'Invitation is unavailable or belongs to another email address';end if;
 insert into public.memberships(organization_id,user_id,role) values(invitation.organization_id,auth.uid(),invitation.role) on conflict(organization_id,user_id) do nothing;
 update public.invitations set accepted_at=now() where id=invitation.id;return invitation.organization_id;
end $$;
create function public.organization_members(org uuid) returns table(id uuid,email text,role text,created_at timestamptz) language plpgsql security definer set search_path='' as $$ begin
 if not public.has_organization_role(org,array['owner','admin']) then return;end if;
 return query select m.user_id,u.email::text,m.role,m.created_at from public.memberships m join auth.users u on u.id=m.user_id where m.organization_id=org;
end $$;
create function public.change_member_role(org uuid,member uuid,new_role text) returns void language plpgsql security definer set search_path='' as $$
declare previous text;begin
 if not public.has_organization_role(org,array['owner']) or new_role not in ('owner','admin','fundraiser','accountant','viewer') then raise exception 'Permission denied';end if;
 perform 1 from public.organizations where id=org for update;
 select role into strict previous from public.memberships where organization_id=org and user_id=member;
 if previous='owner' and new_role<>'owner' and (select count(*) from public.memberships where organization_id=org and role='owner')<=1 then raise exception 'An organization must retain an owner';end if;
 update public.memberships set role=new_role where organization_id=org and user_id=member;
end $$;

create function public.run_failed_payment_rules() returns trigger language plpgsql security definer set search_path='' as $$
declare rule public.automation_rules;begin
 if new.status<>'failed' then return new;end if;
 for rule in select * from public.automation_rules where organization_id=new.organization_id and active and event='payment_failed' and new.amount_minor>=min_amount_minor loop
  begin
   insert into public.tasks(organization_id,donor_id,subject,description,assignee,priority,due_date,status) values(new.organization_id,new.donor_id,rule.subject,'Follow up on failed payment '||new.id,'','high',current_date+1,'open');
   insert into public.job_logs(organization_id,name,status,details) values(new.organization_id,rule.name,'completed','Created donor follow-up task for payment '||new.id);
  exception when others then insert into public.job_logs(organization_id,name,status,details) values(new.organization_id,rule.name,'failed',sqlerrm);end;
 end loop;
 return new;
end $$;
create trigger payment_automation after insert or update of status on public.payments for each row execute function public.run_failed_payment_rules();
create function public.toggle_automation(rule uuid,enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare org uuid;begin
 select organization_id into strict org from public.automation_rules where id=rule;
 if not public.has_organization_role(org,array['owner','admin']) then raise exception 'Permission denied';end if;
 update public.automation_rules set active=enabled where id=rule;
end $$;
revoke all on function public.invite_member(uuid,text,text),public.accept_invitation(text),public.organization_members(uuid),public.change_member_role(uuid,uuid,text),public.run_failed_payment_rules(),public.toggle_automation(uuid,boolean) from public;
grant execute on function public.invite_member(uuid,text,text),public.accept_invitation(text),public.organization_members(uuid),public.change_member_role(uuid,uuid,text),public.toggle_automation(uuid,boolean) to authenticated;

create or replace function public.issue_receipt(payment uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.payments;d public.donors;o public.organizations;receipt uuid;template text;
begin
 select * into strict p from public.payments where id=payment and status='processed';
 if not public.has_organization_role(p.organization_id,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied';end if;
 select * into strict d from public.donors where id=p.donor_id;
 select * into strict o from public.organizations where id=p.organization_id;
 select body into template from public.document_templates where organization_id=o.id and language=d.receipt_language order by created_at desc,id desc limit 1;
 insert into public.receipts(organization_id,payment_id,language,snapshot) values(p.organization_id,p.id,d.receipt_language,jsonb_build_object('organization',o.name,'tax_id',o.tax_id,'donor',d.name,'hebrew_name',d.hebrew_name,'amount_minor',p.amount_minor,'paid_on',p.paid_on,'method',p.method,'reference',p.reference,'template',coalesce(template,''))) on conflict(payment_id) do nothing returning id into receipt;
 if receipt is null then select id into receipt from public.receipts where payment_id=payment;end if;return receipt;
end $$;
commit;
