begin;
alter table public.payments add column provider text not null default 'manual' check(provider in ('manual','sola','matbia'));
update public.payments set provider='sola' where id in (select payment_id from public.sola_payment_attempts);
create function public.mark_sola_provider() returns trigger language plpgsql security definer set search_path='' as $$ begin update public.payments set provider='sola' where id=new.payment_id;return new;end $$;
revoke all on function public.mark_sola_provider() from public;
create trigger sola_provider after insert on public.sola_payment_attempts for each row execute function public.mark_sola_provider();

create table public.matbia_merchant_binding(singleton boolean primary key default true check(singleton),organization_id uuid not null unique references public.organizations(id),owner_id uuid not null references auth.users(id),created_at timestamptz not null default now());
alter table public.matbia_merchant_binding enable row level security;
revoke all on public.matbia_merchant_binding from public,anon,authenticated;
grant select on public.matbia_merchant_binding to service_role;
create policy matbia_server_binding on public.matbia_merchant_binding for select to service_role using(true);
create function public.bind_matbia_merchant(org uuid,owner_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare existing uuid;
begin
 if not exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.organization_id=org and m.user_id=owner_user and m.role='owner' and u.email_confirmed_at is not null) then raise exception 'Verified owner required';end if;
 perform pg_advisory_xact_lock(846230106);select organization_id into existing from public.matbia_merchant_binding where singleton=true;
 if found then if existing<>org then raise exception 'Matbia already belongs to another organization';end if;return existing;end if;
 insert into public.matbia_merchant_binding(singleton,organization_id,owner_id) values(true,org,owner_user);return org;
end $$;
create table public.matbia_payment_attempts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),donor_id uuid not null,actor_id uuid not null references auth.users(id),request_key uuid not null,payment_id uuid not null unique references public.payments(id),amount_minor bigint not null check(amount_minor>0),allocations jsonb not null check(jsonb_typeof(allocations)='array'),donation jsonb not null,state text not null default 'sending' check(state in ('sending','approved','declined','unknown')),provider_reference text,allocation_review boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,request_key),foreign key(organization_id,donor_id) references public.donors(organization_id,id)
);
create unique index matbia_reference_unique on public.matbia_payment_attempts(organization_id,provider_reference) where provider_reference is not null;
alter table public.matbia_payment_attempts enable row level security;
revoke all on public.matbia_payment_attempts from public,anon,authenticated;
grant select on public.matbia_payment_attempts to authenticated;
create policy matbia_attempt_read on public.matbia_payment_attempts for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));
create function public.prepare_matbia_payment(org uuid,donor uuid,amount bigint,request_key uuid,allocations jsonb,details jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 insert into public.matbia_payment_attempts(organization_id,donor_id,actor_id,request_key,payment_id,amount_minor,allocations,donation) values(org,donor,auth.uid(),request_key,p,amount,allocations,details) returning * into a;
 return jsonb_build_object('send',true,'attempt',a.id,'payment',p,'amount_minor',amount,'created_at',a.created_at);
end $$;
create function public.finish_matbia_payment(attempt uuid,outcome text,reference text) returns jsonb language plpgsql security definer set search_path='' as $$
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
 return jsonb_build_object('state',outcome,'payment',a.payment_id,'reference',reference,'allocation_review',review);
end $$;

create or replace function public.resolve_pending_payment(payment uuid,new_status text,dated date) returns void language plpgsql security definer set search_path='' as $$
declare p public.payments;begin
 select * into strict p from public.payments where id=payment;
 if not public.has_organization_role(p.organization_id,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied';end if;
 if exists(select 1 from public.sola_payment_attempts where payment_id=payment) or exists(select 1 from public.matbia_payment_attempts where payment_id=payment) then raise exception 'Processor payment requires verified provider resolution';end if;
 perform 1 from public.donors where id=p.donor_id for update;
 select * into strict p from public.payments where id=payment for update;
 if p.status<>'pending' or new_status not in ('processed','failed') or dated<p.paid_on then raise exception 'Invalid pending-payment resolution';end if;
 update public.payments set status=new_status,paid_on=dated where id=payment;
 insert into public.activities(organization_id,donor_id,type,details) values(p.organization_id,p.donor_id,'payment','Pending payment resolved as '||new_status);
end $$;
revoke all on function public.bind_matbia_merchant(uuid,uuid),public.prepare_matbia_payment(uuid,uuid,bigint,uuid,jsonb,jsonb),public.finish_matbia_payment(uuid,text,text) from public,anon,authenticated;
grant execute on function public.bind_matbia_merchant(uuid,uuid),public.finish_matbia_payment(uuid,text,text) to service_role;
grant execute on function public.prepare_matbia_payment(uuid,uuid,bigint,uuid,jsonb,jsonb) to authenticated;
create or replace function public.issue_receipt(payment uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.payments;d public.donors;o public.organizations;receipt uuid;template text;
begin
 select * into strict p from public.payments where id=payment and status='processed';
 if not public.has_organization_role(p.organization_id,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied';end if;
 select * into strict d from public.donors where id=p.donor_id;
 select * into strict o from public.organizations where id=p.organization_id;
 select body into template from public.document_templates where organization_id=o.id and language=d.receipt_language order by created_at desc,id desc limit 1;
 insert into public.receipts(organization_id,payment_id,language,snapshot) values(p.organization_id,p.id,d.receipt_language,jsonb_build_object('organization',o.name,'tax_id',o.tax_id,'donor',d.name,'hebrew_name',d.hebrew_name,'amount_minor',p.amount_minor,'paid_on',p.paid_on,'method',p.method,'reference',p.reference,'provider',p.provider,'description',coalesce(nullif(p.description,''),(select string_agg(nullif(pl.description,''),'; ' order by pl.pledged_on,pl.id) from public.payment_allocations a join public.pledges pl on pl.id=a.pledge_id where a.payment_id=p.id),''),'template',coalesce(template,''))) on conflict(payment_id) do nothing returning id into receipt;
 if receipt is null then select id into receipt from public.receipts where payment_id=payment;end if;return receipt;
end $$;
notify pgrst,'reload schema';
commit;
