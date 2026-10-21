begin;
create table public.donor_payment_methods (
 id uuid primary key, organization_id uuid not null references public.organizations(id), donor_id uuid not null,
 brand text not null check(length(brand)<=30),last4 text not null check(last4 ~ '^[0-9]{4}$'),expiry text not null check(expiry ~ '^(0[1-9]|1[0-2])[0-9]{2}$'),
 active boolean not null default true,consent_at timestamptz not null default now(),consent_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(organization_id,id),foreign key(organization_id,donor_id) references public.donors(organization_id,id)
);
create table public.sola_card_tokens (
 method_id uuid primary key references public.donor_payment_methods(id),organization_id uuid not null,encrypted_token text not null check(length(encrypted_token) between 40 and 1024),
 foreign key(organization_id,method_id) references public.donor_payment_methods(organization_id,id)
);
alter table public.donor_payment_methods enable row level security;
alter table public.sola_card_tokens enable row level security;
revoke all on public.donor_payment_methods,public.sola_card_tokens from public,anon,authenticated;
grant select on public.donor_payment_methods to authenticated,service_role;
grant select on public.sola_card_tokens to service_role;
create policy donor_card_metadata on public.donor_payment_methods for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin','fundraiser','accountant','viewer']));
create policy server_card_metadata on public.donor_payment_methods for select to service_role using(true);
create policy server_card_tokens on public.sola_card_tokens for select to service_role using(true);

alter table public.sola_payment_attempts add column donation jsonb not null default '{}',add column selected_card uuid references public.donor_payment_methods(id),add column save_requested boolean not null default false,add column card_method_id uuid not null default gen_random_uuid(),add column card_saved boolean not null default false,add column save_error boolean not null default false;

create function public.prepare_sola_donation(org uuid,donor uuid,amount bigint,request_key uuid,allocations jsonb,details jsonb,stored_card uuid,save_card boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.sola_payment_attempts; result jsonb; item jsonb; pledged public.pledges;available bigint;
begin
 if not public.has_organization_role(org,array['owner','admin']) then raise exception 'Permission denied';end if;
 perform 1 from public.donors where id=donor and organization_id=org for update;
 if not found then raise exception 'Donor not found';end if;
 if not exists(select 1 from public.sola_merchant_binding where organization_id=org) then raise exception 'Merchant not connected';end if;
 select * into a from public.sola_payment_attempts s where s.organization_id=org and s.request_key=prepare_sola_donation.request_key;
 if found and (a.donation is distinct from details or a.selected_card is distinct from stored_card or a.save_requested is distinct from save_card) then raise exception 'Attempt key reused';end if;
 if stored_card is not null and (save_card or not exists(select 1 from public.donor_payment_methods where id=stored_card and organization_id=org and donor_id=donor and active)) then raise exception 'Saved card unavailable';end if;
 if details<>'{}'::jsonb then
  if not exists(select 1 from public.campaigns where id=(details->>'campaign_id')::uuid and organization_id=org) then raise exception 'Select a campaign';end if;
  if jsonb_array_length(allocations)=0 and coalesce((details->>'credit_confirmed')::boolean,false)=false and exists(select 1 from public.pledges p where p.organization_id=org and p.donor_id=donor and p.voided_at is null and p.amount_minor>coalesce((select sum(amount_minor) from public.payment_allocations where pledge_id=p.id),0)) then raise exception 'Confirm leaving payment unapplied';end if;
 end if;
 for item in select * from jsonb_array_elements(allocations) loop
  select * into strict pledged from public.pledges where id=(item->>'pledge_id')::uuid and organization_id=org and donor_id=donor and voided_at is null;
  select pledged.amount_minor-coalesce((select sum(amount_minor) from public.payment_allocations where pledge_id=pledged.id),0)-coalesce((select sum(i.amount_minor) from public.installments i join public.schedules s on s.id=i.schedule_id where s.pledge_id=pledged.id and s.status in ('active','paused') and i.payment_id is null),0) into available;
  if (select sum((j->>'amount_minor')::bigint) from jsonb_array_elements(allocations) j where j->>'pledge_id'=pledged.id::text)>available then raise exception 'Allocation exceeds available balance';end if;
 end loop;
 result:=public.prepare_sola_payment(org,donor,amount,request_key,allocations);
 if (result->>'send')::boolean then
  update public.sola_payment_attempts set donation=details,selected_card=stored_card,save_requested=save_card where id=(result->>'attempt')::uuid returning * into a;
  if details<>'{}'::jsonb then update public.payments set campaign_id=(details->>'campaign_id')::uuid,fundraiser_id=nullif(details->>'fundraiser_id','')::uuid,sponsorship_id=nullif(details->>'sponsorship_id','')::uuid,event_id=nullif(details->>'event_id','')::uuid,description=coalesce(details->>'description',''),collector=coalesce(details->>'collector','') where id=a.payment_id;end if;
 else select * into strict a from public.sola_payment_attempts where id=(result->>'attempt')::uuid;end if;
 return result||jsonb_build_object('card_method_id',a.card_method_id,'card_saved',a.card_saved,'save_error',a.save_error);
end $$;

create function public.persist_sola_card(org uuid,donor uuid,actor uuid,method uuid,card jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if card is null then raise exception 'Missing saved card';end if;
 insert into public.donor_payment_methods(id,organization_id,donor_id,brand,last4,expiry,consent_by) values(method,org,donor,card->>'brand',card->>'last4',card->>'expiry',actor);
 insert into public.sola_card_tokens(method_id,organization_id,encrypted_token) values(method,org,card->>'encrypted_token');
 insert into public.activities(organization_id,donor_id,type,details) values(org,donor,'payment_method','Sola card saved with permission; ending '||(card->>'last4'));
end $$;

create function public.finish_sola_payment_vault(attempt uuid,outcome text,reference text,card jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.sola_payment_attempts;result jsonb;saved boolean:=false;failed boolean:=false;
begin
 select * into strict a from public.sola_payment_attempts where id=attempt;
 perform 1 from public.donors where id=a.donor_id for update;
 select * into strict a from public.sola_payment_attempts where id=attempt for update;
 if a.state<>'sending' then return jsonb_build_object('state',a.state,'payment',a.payment_id,'reference',a.provider_reference,'allocation_review',a.allocation_review,'card_saved',a.card_saved,'save_error',a.save_error);end if;
 result:=public.finish_sola_payment(attempt,outcome,reference);
 if outcome='approved' and a.save_requested then
  begin perform public.persist_sola_card(a.organization_id,a.donor_id,a.actor_id,a.card_method_id,card);saved:=true;
  exception when others then failed:=true;end;
 end if;
 update public.sola_payment_attempts set card_saved=saved,save_error=failed where id=attempt;
 return result||jsonb_build_object('card_saved',saved,'save_error',failed);
end $$;

create table public.sola_card_save_attempts (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),donor_id uuid not null,actor_id uuid not null references auth.users(id),request_key uuid not null,method_id uuid not null default gen_random_uuid(),state text not null default 'sending' check(state in ('sending','approved','declined','unknown')),created_at timestamptz not null default now(),unique(organization_id,request_key),foreign key(organization_id,donor_id) references public.donors(organization_id,id)
);
alter table public.sola_card_save_attempts enable row level security;
revoke all on public.sola_card_save_attempts from public,anon,authenticated;
grant select on public.sola_card_save_attempts to service_role;
create policy server_card_save_attempt on public.sola_card_save_attempts for select to service_role using(true);
create function public.prepare_sola_card_save(org uuid,donor uuid,actor uuid,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.sola_card_save_attempts;
begin
 if not exists(select 1 from public.memberships where organization_id=org and user_id=actor and role in ('owner','admin')) or not exists(select 1 from public.sola_merchant_binding where organization_id=org) then raise exception 'Permission denied';end if;
 perform 1 from public.donors where id=donor and organization_id=org for update;if not found then raise exception 'Donor not found';end if;
 select * into a from public.sola_card_save_attempts s where s.organization_id=org and s.request_key=prepare_sola_card_save.request_key;
 if found then if a.donor_id<>donor then raise exception 'Attempt key reused';end if;return jsonb_build_object('send',false,'state',a.state,'attempt',a.id,'method',a.method_id);end if;
 if exists(select 1 from public.sola_card_save_attempts where organization_id=org and donor_id=donor and state in ('sending','unknown')) then raise exception 'Previous card save needs review';end if;
 if (select count(*) from public.sola_card_save_attempts where organization_id=org and created_at>now()-interval '1 hour')>=30 then raise exception 'Card save limit reached';end if;
 insert into public.sola_card_save_attempts(organization_id,donor_id,actor_id,request_key) values(org,donor,actor,request_key) returning * into a;
 return jsonb_build_object('send',true,'state',a.state,'attempt',a.id,'method',a.method_id);
end $$;
create function public.finish_sola_card_save(attempt uuid,outcome text,card jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.sola_card_save_attempts;
begin
 select * into strict a from public.sola_card_save_attempts where id=attempt;
 perform 1 from public.donors where id=a.donor_id for update;
 select * into strict a from public.sola_card_save_attempts where id=attempt for update;
 if a.state<>'sending' then return jsonb_build_object('state',a.state);end if;
 if outcome not in ('approved','declined','unknown') then raise exception 'Invalid result';end if;
 if outcome='approved' then perform public.persist_sola_card(a.organization_id,a.donor_id,a.actor_id,a.method_id,card);end if;
 update public.sola_card_save_attempts set state=outcome where id=attempt;
 return jsonb_build_object('state',outcome,'card_saved',outcome='approved');
end $$;
create function public.retire_sola_card(org uuid,method uuid) returns void language plpgsql security definer set search_path='' as $$
declare d uuid;
begin
 select donor_id into strict d from public.donor_payment_methods where id=method and organization_id=org;
 perform 1 from public.donors where id=d for update;
 update public.donor_payment_methods set active=false where id=method;
 delete from public.sola_card_tokens where method_id=method;
 insert into public.activities(organization_id,donor_id,type,details) values(org,d,'payment_method','Saved card removed from donor file');
end $$;
revoke all on function public.prepare_sola_donation(uuid,uuid,bigint,uuid,jsonb,jsonb,uuid,boolean),public.persist_sola_card(uuid,uuid,uuid,uuid,jsonb),public.finish_sola_payment_vault(uuid,text,text,jsonb),public.prepare_sola_card_save(uuid,uuid,uuid,uuid),public.finish_sola_card_save(uuid,text,jsonb),public.retire_sola_card(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_sola_donation(uuid,uuid,bigint,uuid,jsonb,jsonb,uuid,boolean) to authenticated;
grant execute on function public.finish_sola_payment_vault(uuid,text,text,jsonb),public.prepare_sola_card_save(uuid,uuid,uuid,uuid),public.finish_sola_card_save(uuid,text,jsonb),public.retire_sola_card(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
