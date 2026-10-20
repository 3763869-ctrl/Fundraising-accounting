begin;
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check check(method in ('check','cash','bank_transfer','external_card','charity_card','zelle','other'));
alter table public.payments
 add column campaign_id uuid, add column fundraiser_id uuid, add column sponsorship_id uuid, add column event_id uuid,
 add column description text not null default '' check(length(description)<=10000),
 add column donation_payload jsonb,
 add column updated_at timestamptz not null default now(),
 add foreign key(organization_id,campaign_id) references public.campaigns(organization_id,id),
 add foreign key(organization_id,fundraiser_id) references public.fundraisers(organization_id,id),
 add foreign key(organization_id,sponsorship_id) references public.sponsorships(organization_id,id),
 add foreign key(organization_id,event_id) references public.events(organization_id,id);
alter table public.pledges add column updated_at timestamptz not null default now(), add column voided_at timestamptz;

-- Keep historical IDs and amounts, while preventing new money or plans on voided pledges.
create function public.guard_active_pledge() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.pledges;
begin
 select * into strict p from public.pledges where id=new.pledge_id;
 perform 1 from public.donors where id=p.donor_id for update;
 select * into strict p from public.pledges where id=new.pledge_id;
 if p.voided_at is not null then raise exception 'Pledge is void'; end if;
 return new;
end $$;
create trigger active_allocation before insert or update on public.payment_allocations for each row execute function public.guard_active_pledge();
create trigger active_schedule before insert on public.schedules for each row execute function public.guard_active_pledge();
create trigger active_recognition before insert on public.pledge_recognitions for each row execute function public.guard_active_pledge();

create function public.record_donation_payment(org uuid, details jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare donor uuid:=(details->>'donor_id')::uuid; existing public.payments; result uuid; allocation jsonb:=coalesce(details->'allocations','[]');
begin
 if not public.has_organization_role(org,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied'; end if;
 perform 1 from public.donors where id=donor and organization_id=org for update;
 if not found then raise exception 'Donor not found'; end if;
 select * into existing from public.payments where organization_id=org and idempotency_key=(details->>'idempotency_key')::uuid;
 if found then
  if existing.donation_payload is distinct from details then raise exception 'Request key already used for different donation'; end if;
  return existing.id;
 end if;
 if not exists(select 1 from public.campaigns where organization_id=org and id=(details->>'campaign_id')::uuid) then raise exception 'Select a campaign'; end if;
 if jsonb_typeof(allocation)<>'array' then raise exception 'Allocation list required'; end if;
 if jsonb_array_length(allocation)=0 and nullif(details->>'installment','') is null and coalesce((details->>'credit_confirmed')::boolean,false)=false and exists(
  select 1 from public.pledges p where p.organization_id=org and p.donor_id=donor and p.voided_at is null and p.amount_minor>coalesce((select sum(a.amount_minor) from public.payment_allocations a where a.pledge_id=p.id),0)
 ) then raise exception 'Confirm leaving this donation unapplied to open pledges'; end if;
 result:=public.record_payment(org,donor,(details->>'amount_minor')::bigint,(details->>'paid_on')::date,details->>'method',details->>'status',coalesce(details->>'reference',''),(details->>'idempotency_key')::uuid,allocation,nullif(details->>'installment','')::uuid,coalesce(details->>'collector',''));
 update public.payments set campaign_id=(details->>'campaign_id')::uuid, fundraiser_id=nullif(details->>'fundraiser_id','')::uuid, sponsorship_id=nullif(details->>'sponsorship_id','')::uuid, event_id=nullif(details->>'event_id','')::uuid,description=coalesce(details->>'description',''), donation_payload=details,updated_at=now() where id=result;
 return result;
end $$;

create function public.edit_donation_record(org uuid, kind text, record_id uuid, attributes jsonb) returns void language plpgsql security definer set search_path='' as $$
declare p public.pledges; pay public.payments; donor uuid; financial_change boolean;
begin
 if not public.has_organization_role(org,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied'; end if;
 if kind='pledges' then
  select * into strict p from public.pledges where id=record_id and organization_id=org;
  donor:=p.donor_id;
  perform 1 from public.donors where id=donor for update;
  select * into strict p from public.pledges where id=record_id and organization_id=org for update;
  if p.voided_at is not null then raise exception 'Voided pledges cannot be edited'; end if;
  financial_change := (attributes->>'amount_minor')::bigint is distinct from p.amount_minor or (attributes->>'campaign_id')::uuid is distinct from p.campaign_id or (attributes->>'pledged_on')::date is distinct from p.pledged_on;
  if financial_change and (exists(select 1 from public.payment_allocations where pledge_id=p.id) or exists(select 1 from public.schedules where pledge_id=p.id and status in ('active','paused')) or exists(select 1 from public.pledge_recognitions where pledge_id=p.id)) then raise exception 'Amount, campaign and pledge date are locked after payments, active plans or accounting recognition'; end if;
  update public.pledges set amount_minor=(attributes->>'amount_minor')::bigint,campaign_id=(attributes->>'campaign_id')::uuid,pledged_on=(attributes->>'pledged_on')::date,due_date=(attributes->>'due_date')::date,description=coalesce(attributes->>'description',''),fundraiser_id=nullif(attributes->>'fundraiser_id','')::uuid,event_id=nullif(attributes->>'event_id','')::uuid,sponsorship_id=nullif(attributes->>'sponsorship_id','')::uuid, receipt_requested=coalesce((attributes->>'receipt_requested')::boolean,true),updated_at=now() where id=p.id;
 elsif kind='payments' then
  select * into strict pay from public.payments where id=record_id and organization_id=org;
  donor:=pay.donor_id;
  perform 1 from public.donors where id=donor for update;
  -- Never rewrite settled amounts, allocations, merchant references or immutable receipts.
  update public.payments set description=coalesce(attributes->>'description',''),collector=coalesce(attributes->>'collector',''),fundraiser_id=nullif(attributes->>'fundraiser_id','')::uuid,sponsorship_id=nullif(attributes->>'sponsorship_id','')::uuid,event_id=nullif(attributes->>'event_id','')::uuid, updated_at=now() where id=pay.id;
 else raise exception 'Invalid record kind'; end if;
 insert into public.activities(organization_id,donor_id,type,details) values(org,donor,'edited',kind||' record updated: '||record_id);
end $$;

create function public.void_pledge(org uuid, pledge uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.pledges;
begin
 if not public.has_organization_role(org,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied'; end if;
 select * into strict p from public.pledges where id=pledge and organization_id=org;
 perform 1 from public.donors where id=p.donor_id for update;
 if exists(select 1 from public.payment_allocations where pledge_id=pledge) or exists(select 1 from public.schedules where pledge_id=pledge and status in ('active','paused')) or exists(select 1 from public.pledge_recognitions where pledge_id=pledge) then raise exception 'Cannot void a pledge with payments, active plans or accounting recognition'; end if;
 update public.pledges set voided_at=now(),updated_at=now() where id=pledge;
 insert into public.activities(organization_id,donor_id,type,details) values(org,p.donor_id,'voided','Pledge voided: '||pledge);
end $$;
revoke all on function public.guard_active_pledge(),public.record_donation_payment(uuid,jsonb),public.edit_donation_record(uuid,text,uuid,jsonb),public.void_pledge(uuid,uuid) from public;
grant execute on function public.record_donation_payment(uuid,jsonb),public.edit_donation_record(uuid,text,uuid,jsonb),public.void_pledge(uuid,uuid) to authenticated;
create or replace function public.issue_receipt(payment uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.payments;d public.donors;o public.organizations;receipt uuid;template text;
begin
 select * into strict p from public.payments where id=payment and status='processed';
 if not public.has_organization_role(p.organization_id,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied';end if;
 select * into strict d from public.donors where id=p.donor_id;
 select * into strict o from public.organizations where id=p.organization_id;
 select body into template from public.document_templates where organization_id=o.id and language=d.receipt_language order by created_at desc,id desc limit 1;
 insert into public.receipts(organization_id,payment_id,language,snapshot) values(p.organization_id,p.id,d.receipt_language,jsonb_build_object('organization',o.name,'tax_id',o.tax_id,'donor',d.name,'hebrew_name',d.hebrew_name,'amount_minor',p.amount_minor,'paid_on',p.paid_on,'method',p.method,'reference',p.reference,'description',coalesce(nullif(p.description,''),(select string_agg(nullif(pl.description,''),'; ' order by pl.pledged_on,pl.id) from public.payment_allocations a join public.pledges pl on pl.id=a.pledge_id where a.payment_id=p.id),''),'template',coalesce(template,''))) on conflict(payment_id) do nothing returning id into receipt;
 if receipt is null then select id into receipt from public.receipts where payment_id=payment;end if;return receipt;
end $$;
notify pgrst,'reload schema';
commit;
