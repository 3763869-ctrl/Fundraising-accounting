begin;
-- Transaction defaults and anonymous bookkeeping identity are organization-scoped.
alter table public.organizations add column default_donation_campaign_id uuid;
alter table public.organizations add foreign key(id,default_donation_campaign_id) references public.campaigns(organization_id,id);
alter table public.donors add column system_role text check(system_role is null or system_role='anonymous');
create unique index one_anonymous_donor on public.donors(organization_id) where system_role='anonymous';
alter table public.payments add column remainder_mode text not null default 'credit' check(remainder_mode in ('donation','credit')),add column direct_pledge_id uuid;
alter table public.payments add foreign key(organization_id,direct_pledge_id) references public.pledges(organization_id,id);
alter table public.pledges add column source_type text not null default 'pledge' check(source_type in ('pledge','direct_donation'));

create function public.ensure_transaction_setup(org uuid) returns void language plpgsql security definer set search_path='' as $$
declare campaign uuid;general_fund uuid;begin
 if not public.has_organization_role(org,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied';end if;
 select default_donation_campaign_id into campaign from public.organizations where id=org for update;
 if campaign is null then
  select id into general_fund from public.funds where organization_id=org and not restricted order by created_at,id limit 1;
  if general_fund is null then insert into public.funds(organization_id,name,restricted) values(org,'General operating',false) returning id into general_fund;end if;
  insert into public.campaigns(organization_id,name,fund_id) values(org,'Synagogue — General donations',general_fund) returning id into campaign;
  update public.organizations set default_donation_campaign_id=campaign where id=org;
 end if;
 insert into public.donors(organization_id,name,system_role) values(org,'Anonymous donor','anonymous') on conflict(organization_id) where system_role='anonymous' do nothing;
end $$;

-- Internal helpers: browsers cannot set financial disposition after a charge.
create function public.set_transaction_disposition(payment uuid,details jsonb) returns void language plpgsql security definer set search_path='' as $$
declare mode text:=coalesce(details->>'remainder_mode','credit');p public.payments;begin
 if mode not in ('donation','credit') then raise exception 'Invalid remainder mode';end if;
 select * into strict p from public.payments where id=payment;
 if details ? 'remainder_mode' and not exists(select 1 from public.campaigns where organization_id=p.organization_id and id=p.campaign_id) then raise exception 'Donation campaign required';end if;
 if details ? 'remainder_mode' and mode='credit' and exists(select 1 from public.donors where id=p.donor_id and system_role='anonymous') then raise exception 'Select a named donor for account credit';end if;
 update public.payments set remainder_mode=mode where id=payment;
end $$;
create function public.complete_transaction_donation(payment uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.payments;remainder bigint;pledge uuid;begin
 select * into strict p from public.payments where id=payment;
 perform 1 from public.donors where id=p.donor_id for update;
 select * into strict p from public.payments where id=payment for update;
 if p.status<>'processed' or p.remainder_mode<>'donation' or p.direct_pledge_id is not null then return;end if;
 select p.amount_minor-coalesce(sum(amount_minor),0) into remainder from public.payment_allocations where payment_id=p.id;
 if remainder<=0 then return;end if;
 insert into public.pledges(organization_id,donor_id,campaign_id,amount_minor,pledged_on,due_date,description,source_type,fundraiser_id,sponsorship_id,event_id)
 values(p.organization_id,p.donor_id,p.campaign_id,remainder,p.paid_on,p.paid_on,p.description,'direct_donation',p.fundraiser_id,p.sponsorship_id,p.event_id) returning id into pledge;
 perform public.allocate_payment(p.id,jsonb_build_array(jsonb_build_object('pledge_id',pledge,'amount_minor',remainder)));
 update public.payments set direct_pledge_id=pledge where id=p.id;
end $$;
alter table public.pledges add column transaction_key uuid,add column transaction_payload jsonb;
create unique index pledge_transaction_key on public.pledges(organization_id,transaction_key) where transaction_key is not null;
create function public.record_transaction_pledge(org uuid,details jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.pledges;begin
 if not public.has_organization_role(org,array['owner','admin','fundraiser']) then raise exception 'Permission denied';end if;
 perform 1 from public.donors where organization_id=org and id=(details->>'donor_id')::uuid and system_role is distinct from 'anonymous' for update;
 if not found then raise exception 'Select a named donor for a pledge';end if;
 select * into p from public.pledges where organization_id=org and transaction_key=(details->>'transaction_key')::uuid;
 if found then if p.transaction_payload is distinct from details then raise exception 'Transaction key reused';end if;return p.id;end if;
 insert into public.pledges(organization_id,donor_id,campaign_id,amount_minor,pledged_on,due_date,description,transaction_key,transaction_payload)
 values(org,(details->>'donor_id')::uuid,(details->>'campaign_id')::uuid,(details->>'amount_minor')::bigint,(details->>'pledged_on')::date,(details->>'due_date')::date,coalesce(details->>'description',''),(details->>'transaction_key')::uuid,details) returning id into p.id;
 return p.id;
end $$;
revoke all on function public.record_transaction_pledge(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_transaction_pledge(uuid,jsonb) to authenticated;
create function public.record_transaction_payment(org uuid,details jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare p uuid;begin
 if details->>'method'='external_card' then raise exception 'Use secure credit-card processing';end if;
 if details->>'status'<>'processed' then raise exception 'Only received manual payments may be entered here';end if;
 if details->>'remainder_mode' is null then raise exception 'Select donation or credit';end if;
 p:=public.record_donation_payment(org,details);
 perform public.set_transaction_disposition(p,details);
 perform public.complete_transaction_donation(p);
 return p;
end $$;
create or replace function public.prepare_sola_donation(org uuid,donor uuid,amount bigint,request_key uuid,allocations jsonb,details jsonb,stored_card uuid,save_card boolean) returns jsonb language plpgsql security definer set search_path='' as $$
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
  perform public.set_transaction_disposition(a.payment_id,details);
 else select * into strict a from public.sola_payment_attempts where id=(result->>'attempt')::uuid;end if;
 return result||jsonb_build_object('card_method_id',a.card_method_id,'card_saved',a.card_saved,'save_error',a.save_error);
end $$;
create or replace function public.finish_sola_payment_vault(attempt uuid,outcome text,reference text,card jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.sola_payment_attempts;result jsonb;saved boolean:=false;failed boolean:=false;
begin
 select * into strict a from public.sola_payment_attempts where id=attempt;
 perform 1 from public.donors where id=a.donor_id for update;
 select * into strict a from public.sola_payment_attempts where id=attempt for update;
 if a.state<>'sending' then return jsonb_build_object('state',a.state,'payment',a.payment_id,'reference',a.provider_reference,'allocation_review',a.allocation_review,'card_saved',a.card_saved,'save_error',a.save_error);end if;
 result:=public.finish_sola_payment(attempt,outcome,reference);
 if result->>'state'='approved' and not coalesce((result->>'allocation_review')::boolean,false) then perform public.complete_transaction_donation(a.payment_id);end if;
 if outcome='approved' and a.save_requested then
  begin perform public.persist_sola_card(a.organization_id,a.donor_id,a.actor_id,a.card_method_id,card);saved:=true;
  exception when others then failed:=true;end;
 end if;
 update public.sola_payment_attempts set card_saved=saved,save_error=failed where id=attempt;
 return result||jsonb_build_object('card_saved',saved,'save_error',failed);
end $$;
create or replace function public.prepare_matbia_payment(org uuid,donor uuid,amount bigint,request_key uuid,allocations jsonb,details jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.matbia_payment_attempts;item jsonb;pledged public.pledges;available bigint;total bigint:=0;p uuid;
begin
 if not public.has_organization_role(org,array['owner','admin']) then raise exception 'Permission denied';end if;
 if not exists(select 1 from public.matbia_merchant_binding where organization_id=org) then raise exception 'Matbia merchant is not connected';end if;
 perform 1 from public.donors where id=donor and organization_id=org for update;if not found then raise exception 'Donor not found';end if;
 select * into a from public.matbia_payment_attempts s where s.organization_id=org and s.request_key=prepare_matbia_payment.request_key;
 if found then
  if a.donor_id<>donor or a.amount_minor<>amount or a.allocations<>allocations or a.donation<>details then raise exception 'Attempt key reused for different payment';end if;
  return jsonb_build_object('send',false,'state',a.state,'payment',a.payment_id,'reference',a.provider_reference,'allocation_review',a.allocation_review);
 end if;
 if exists(select 1 from public.matbia_payment_attempts where organization_id=org and donor_id=donor and state in ('sending','unknown')) then raise exception 'Previous Matbia payment needs review';end if;
 if (select count(*) from public.matbia_payment_attempts where organization_id=org and created_at>now()-interval '1 hour')>=30 then raise exception 'Payment attempt limit reached';end if;
 if amount is null or amount<=0 or amount>99999999999 or jsonb_typeof(allocations)<>'array' or jsonb_typeof(details)<>'object' then raise exception 'Invalid payment';end if;
 if not exists(select 1 from public.campaigns where organization_id=org and id=(details->>'campaign_id')::uuid) then raise exception 'Select a campaign';end if;
 if jsonb_array_length(allocations)=0 and coalesce((details->>'credit_confirmed')::boolean,false)=false and exists(select 1 from public.pledges pl where pl.organization_id=org and pl.donor_id=donor and pl.voided_at is null and pl.amount_minor>coalesce((select sum(amount_minor) from public.payment_allocations where pledge_id=pl.id),0)) then raise exception 'Confirm leaving payment unapplied';end if;
 for item in select * from jsonb_array_elements(allocations) loop
  if (item->>'amount_minor')::bigint is null or (item->>'amount_minor')::bigint<=0 then raise exception 'Invalid allocation';end if;
  select * into strict pledged from public.pledges where id=(item->>'pledge_id')::uuid and organization_id=org and donor_id=donor and voided_at is null;
  select pledged.amount_minor-coalesce((select sum(amount_minor) from public.payment_allocations where pledge_id=pledged.id),0)-coalesce((select sum(i.amount_minor) from public.installments i join public.schedules s on s.id=i.schedule_id where s.pledge_id=pledged.id and s.status in ('active','paused') and i.payment_id is null),0) into available;
  if (select sum((j->>'amount_minor')::bigint) from jsonb_array_elements(allocations) j where j->>'pledge_id'=pledged.id::text)>available then raise exception 'Allocation exceeds available balance';end if;
  total:=total+(item->>'amount_minor')::bigint;
 end loop;
 if total>amount then raise exception 'Allocations exceed payment';end if;
 p:=public.record_payment(org,donor,amount,(now() at time zone (select timezone from public.organizations where id=org))::date,'charity_card','pending','',request_key,'[]',null,'Matbia');
 update public.payments set provider='matbia',campaign_id=(details->>'campaign_id')::uuid,fundraiser_id=nullif(details->>'fundraiser_id','')::uuid,sponsorship_id=nullif(details->>'sponsorship_id','')::uuid,event_id=nullif(details->>'event_id','')::uuid,description=coalesce(details->>'description',''),collector=coalesce(details->>'collector','') where id=p;
 perform public.set_transaction_disposition(p,details);
 insert into public.matbia_payment_attempts(organization_id,donor_id,actor_id,request_key,payment_id,amount_minor,allocations,donation) values(org,donor,auth.uid(),request_key,p,amount,allocations,details) returning * into a;
 return jsonb_build_object('send',true,'attempt',a.id,'payment',p,'amount_minor',amount,'created_at',a.created_at);
end $$;
create or replace function public.finish_matbia_payment(attempt uuid,outcome text,reference text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.matbia_payment_attempts;review boolean:=false;
begin
 select * into strict a from public.matbia_payment_attempts where id=attempt;perform 1 from public.donors where id=a.donor_id for update;select * into strict a from public.matbia_payment_attempts where id=attempt for update;
 if a.state<>'sending' then return jsonb_build_object('state',a.state,'payment',a.payment_id,'reference',a.provider_reference,'allocation_review',a.allocation_review);end if;
 if outcome not in ('approved','declined','unknown') or outcome='approved' and coalesce(reference,'')='' then raise exception 'Invalid outcome';end if;
 perform set_config('request.jwt.claim.sub',a.actor_id::text,true);
 if outcome='approved' then
  update public.payments set status='processed',reference=finish_matbia_payment.reference where id=a.payment_id;
  begin perform public.allocate_payment(a.payment_id,a.allocations);exception when others then review:=true;end;
 elsif outcome='declined' then update public.payments set status='failed',reference=coalesce(finish_matbia_payment.reference,'') where id=a.payment_id;end if;
 update public.matbia_payment_attempts set state=outcome,provider_reference=finish_matbia_payment.reference,allocation_review=review,updated_at=now() where id=attempt;
 insert into public.activities(organization_id,donor_id,type,details) values(a.organization_id,a.donor_id,'payment','Matbia payment: '||outcome);
 if outcome='approved' and not review then perform public.complete_transaction_donation(a.payment_id);end if;
 return jsonb_build_object('state',outcome,'payment',a.payment_id,'reference',reference,'allocation_review',review);
end $$;

create function public.void_direct_donation() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.status='voided' and old.status<>'voided' and new.direct_pledge_id is not null then update public.pledges set voided_at=now() where id=new.direct_pledge_id;end if;return new;end $$;
create trigger transaction_void after update of status on public.payments for each row execute function public.void_direct_donation();
revoke all on function public.ensure_transaction_setup(uuid),public.record_transaction_payment(uuid,jsonb),public.set_transaction_disposition(uuid,jsonb),public.complete_transaction_donation(uuid),public.void_direct_donation() from public,anon,authenticated;
grant execute on function public.ensure_transaction_setup(uuid),public.record_transaction_payment(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
