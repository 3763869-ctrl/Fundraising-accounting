begin;
create table public.sola_merchant_binding (
 singleton boolean primary key default true check(singleton),
 organization_id uuid not null unique references public.organizations(id),
 owner_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.sola_merchant_binding enable row level security;
grant select on public.sola_merchant_binding to service_role;
create policy sola_server_binding_read on public.sola_merchant_binding for select to service_role using(true);
create function public.bind_sola_merchant(org uuid, owner_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare existing uuid;
begin
 if not exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.organization_id=org and m.user_id=owner_user and m.role='owner' and u.email_confirmed_at is not null) then raise exception 'Verified organization owner required';end if;
 perform pg_advisory_xact_lock(846230105);
 select organization_id into existing from public.sola_merchant_binding where singleton=true;
 if found then if existing<>org then raise exception 'Merchant is already bound to another organization';end if;return existing;end if;
 insert into public.sola_merchant_binding(singleton,organization_id,owner_id) values(true,org,owner_user);
 return org;
end $$;
revoke all on function public.bind_sola_merchant(uuid,uuid) from public,anon,authenticated;
grant execute on function public.bind_sola_merchant(uuid,uuid) to service_role;

create table public.sola_payment_attempts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 donor_id uuid not null,
 actor_id uuid not null references auth.users(id),
 request_key uuid not null,
 payment_id uuid not null unique references public.payments(id),
 amount_minor bigint not null check(amount_minor>0),
 allocations jsonb not null default '[]' check(jsonb_typeof(allocations)='array'),
 state text not null default 'sending' check(state in ('sending','approved','declined','unknown')),
 provider_reference text,
 allocation_review boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,request_key),
 foreign key(organization_id,donor_id) references public.donors(organization_id,id)
);
create unique index sola_reference_unique on public.sola_payment_attempts(organization_id,provider_reference) where provider_reference is not null;
alter table public.sola_payment_attempts enable row level security;
grant select on public.sola_payment_attempts to authenticated;
create policy sola_attempt_read on public.sola_payment_attempts for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));

create function public.prepare_sola_payment(org uuid, donor uuid, amount bigint, request_key uuid, allocations jsonb default '[]') returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.sola_payment_attempts; p uuid; a uuid; item jsonb; pledged public.pledges; total bigint:=0; available bigint;
begin
 if not public.has_organization_role(org,array['owner','admin']) then raise exception 'Permission denied'; end if;
 perform 1 from public.donors where id=donor and organization_id=org for update;
 if not found then raise exception 'Donor not found'; end if;
 select * into previous from public.sola_payment_attempts s where s.organization_id=org and s.request_key=prepare_sola_payment.request_key;
 if found then
  if previous.donor_id<>donor or previous.amount_minor<>amount or previous.allocations<>allocations then raise exception 'Payment attempt key reused for a different request'; end if;
  return jsonb_build_object('send',false,'attempt',previous.id,'state',previous.state,'payment',previous.payment_id,'reference',previous.provider_reference);
 end if;
 if exists(select 1 from public.sola_payment_attempts where organization_id=org and donor_id=donor and state in ('sending','unknown')) then raise exception 'An earlier card payment needs review before another payment can be submitted'; end if;
 if (select count(*) from public.sola_payment_attempts where organization_id=org and created_at>now()-interval '1 hour')>=30 then raise exception 'Payment attempt limit reached'; end if;
 if amount is null or amount<=0 or amount>99999999999 or jsonb_typeof(allocations)<>'array' then raise exception 'Invalid payment request'; end if;
 for item in select * from jsonb_array_elements(allocations) loop
  select * into strict pledged from public.pledges where id=(item->>'pledge_id')::uuid and organization_id=org and donor_id=donor;
  if (item->>'amount_minor')::bigint is null or (item->>'amount_minor')::bigint<=0 then raise exception 'Invalid allocation';end if;
  select pledged.amount_minor-coalesce((select sum(amount_minor) from public.payment_allocations where pledge_id=pledged.id),0)-coalesce((select sum(i.amount_minor) from public.installments i join public.schedules s on s.id=i.schedule_id where s.pledge_id=pledged.id and s.status='active' and i.payment_id is null),0) into available;
  if (select sum((j->>'amount_minor')::bigint) from jsonb_array_elements(allocations) j where j->>'pledge_id'=pledged.id::text)>available then raise exception 'Allocation exceeds unscheduled pledge balance'; end if;
  total:=total+(item->>'amount_minor')::bigint;
 end loop;
 if total>amount then raise exception 'Allocations exceed payment';end if;
 p:=public.record_payment(org,donor,amount,(now() at time zone (select timezone from public.organizations where id=org))::date,'external_card','pending','',request_key,'[]'::jsonb,null,'Sola secure card entry');
 insert into public.sola_payment_attempts(organization_id,donor_id,actor_id,request_key,payment_id,amount_minor,allocations) values(org,donor,auth.uid(),request_key,p,amount,allocations) returning id into a;
 return jsonb_build_object('send',true,'attempt',a,'state','sending','payment',p,'amount_minor',amount);
end $$;
revoke all on function public.prepare_sola_payment(uuid,uuid,bigint,uuid,jsonb) from public;
grant execute on function public.prepare_sola_payment(uuid,uuid,bigint,uuid,jsonb) to authenticated;

-- Only the application server can finalize a gateway response. Browsers cannot
-- invoke this function to fabricate an approval or overwrite an uncertain result.
create function public.finish_sola_payment(attempt uuid, outcome text, reference text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.sola_payment_attempts; review boolean:=false;
begin
 select * into strict a from public.sola_payment_attempts where id=attempt;
 perform 1 from public.donors where id=a.donor_id for update;
 select * into strict a from public.sola_payment_attempts where id=attempt for update;
 if a.state<>'sending' then return jsonb_build_object('state',a.state,'payment',a.payment_id,'reference',a.provider_reference,'allocation_review',a.allocation_review);end if;
 if outcome not in ('approved','declined','unknown') then raise exception 'Invalid provider outcome';end if;
 if outcome='approved' and (reference is null or length(reference)=0) then raise exception 'Approval reference required';end if;
 perform set_config('request.jwt.claim.sub',a.actor_id::text,true);
 if outcome='approved' then
  update public.payments set status='processed',reference=finish_sola_payment.reference where id=a.payment_id;
  begin
   perform public.allocate_payment(a.payment_id,a.allocations);
  exception when others then
   -- Preserve the received money as donor credit if a pledge changed while the
   -- gateway request was in flight. Never discard an approved payment.
   review:=true;
  end;
 elsif outcome='declined' then
  update public.payments set status='failed',reference=coalesce(finish_sola_payment.reference,'') where id=a.payment_id;
 end if;
 update public.sola_payment_attempts set state=outcome,provider_reference=finish_sola_payment.reference,allocation_review=review,updated_at=now() where id=attempt;
 insert into public.activities(organization_id,donor_id,type,details) values(a.organization_id,a.donor_id,'payment','Sola payment attempt: '||outcome);
 return jsonb_build_object('state',outcome,'payment',a.payment_id,'reference',reference,'allocation_review',review);
end $$;
revoke all on function public.finish_sola_payment(uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_sola_payment(uuid,text,text) to service_role;

create or replace function public.resolve_pending_payment(payment uuid,new_status text,dated date) returns void language plpgsql security definer set search_path='' as $$
declare p public.payments;begin
 select * into strict p from public.payments where id=payment;
 if not public.has_organization_role(p.organization_id,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied';end if;
 if exists(select 1 from public.sola_payment_attempts where payment_id=payment) then raise exception 'Processor payment requires verified provider resolution';end if;
 perform 1 from public.donors where id=p.donor_id for update;
 select * into strict p from public.payments where id=payment for update;
 if p.status<>'pending' or new_status not in ('processed','failed') or dated<p.paid_on then raise exception 'Invalid pending-payment resolution';end if;
 update public.payments set status=new_status,paid_on=dated where id=payment;
 insert into public.activities(organization_id,donor_id,type,details) values(p.organization_id,p.donor_id,'payment','Pending payment resolved as '||new_status);
end $$;
commit;
