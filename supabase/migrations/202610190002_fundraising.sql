begin;
alter table public.organizations add column hebrew_name text not null default '', add column tax_id text not null default '', add column timezone text not null default 'America/New_York';
alter table public.donors add column title text not null default '', add column hebrew_name text not null default '', add column phones jsonb not null default '[]', add column emails jsonb not null default '[]', add column addresses jsonb not null default '[]', add column tags text[] not null default '{}', add column notes text not null default '', add column occasions jsonb not null default '[]', add column custom_fields jsonb not null default '{}', add column receipt_language text not null default 'en' check(receipt_language in ('en','he'));
alter table public.pledges add column pledged_on date not null default current_date, add column description text not null default '', add column receipt_requested boolean not null default true;
alter table public.pledges add constraint pledges_org_id_unique unique(organization_id,id);

create table public.funds(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), name text not null check(length(trim(name)) between 1 and 200), restricted boolean not null default false, created_at timestamptz not null default now(), unique(organization_id,id));
create table public.fundraisers(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), name text not null check(length(trim(name)) between 1 and 200), email text, created_at timestamptz not null default now(), unique(organization_id,id));
create table public.donor_accounts(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), donor_id uuid not null, name text not null, display_name text not null, type text not null check(type in ('personal','business','foundation')), email text, address text not null default '', created_at timestamptz not null default now(), foreign key(organization_id,donor_id) references public.donors(organization_id,id));
create table public.donor_lists(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), name text not null check(length(trim(name)) between 1 and 200), created_at timestamptz not null default now(), unique(organization_id,id));
create table public.list_members(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), list_id uuid not null, donor_id uuid not null, created_at timestamptz not null default now(), unique(list_id,donor_id), foreign key(organization_id,list_id) references public.donor_lists(organization_id,id), foreign key(organization_id,donor_id) references public.donors(organization_id,id));
create table public.events(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), name text not null, description text not null default '', event_date date not null, status text not null default 'planned' check(status in ('planned','active','completed','cancelled')), created_at timestamptz not null default now(), unique(organization_id,id));
create table public.sponsorships(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), name text not null, type text not null default 'general', availability_limit integer not null check(availability_limit>0), default_price_minor bigint not null check(default_price_minor>0), created_at timestamptz not null default now(), unique(organization_id,id));
alter table public.donors add column fundraiser_id uuid, add foreign key(organization_id,fundraiser_id) references public.fundraisers(organization_id,id);
alter table public.campaigns add column fund_id uuid, add column goal_minor bigint not null default 0 check(goal_minor>=0), add column status text not null default 'active' check(status in ('active','completed','planned')), add foreign key(organization_id,fund_id) references public.funds(organization_id,id);
alter table public.pledges add column fundraiser_id uuid, add column sponsorship_id uuid, add column event_id uuid, add foreign key(organization_id,fundraiser_id) references public.fundraisers(organization_id,id), add foreign key(organization_id,sponsorship_id) references public.sponsorships(organization_id,id), add foreign key(organization_id,event_id) references public.events(organization_id,id);

create table public.payments(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), donor_id uuid not null,
 amount_minor bigint not null check(amount_minor between 1 and 99999999999), paid_on date not null,
 status text not null check(status in ('processed','pending','failed')), method text not null check(method in ('check','cash','bank_transfer','external_card','charity_card')),
 reference text not null default '', collector text not null default '', deposit_status text not null default 'undeposited' check(deposit_status in ('undeposited','deposited')),
 idempotency_key uuid not null, request_payload jsonb not null, created_at timestamptz not null default now(), unique(organization_id,id), unique(organization_id,idempotency_key),
 foreign key(organization_id,donor_id) references public.donors(organization_id,id)
);
create table public.payment_allocations(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, payment_id uuid not null, pledge_id uuid not null,
 amount_minor bigint not null check(amount_minor>0), created_at timestamptz not null default now(), unique(payment_id,pledge_id),
 foreign key(organization_id,payment_id) references public.payments(organization_id,id), foreign key(organization_id,pledge_id) references public.pledges(organization_id,id)
);
create table public.schedules(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), donor_id uuid not null, pledge_id uuid not null,
 kind text not null check(kind in ('installment','recurring')), frequency text not null check(frequency in ('weekly','monthly','quarterly','yearly')),
 start_date date not null, total_minor bigint not null check(total_minor>0), payment_count integer not null check(payment_count between 1 and 120),
 status text not null default 'active' check(status in ('active','paused','completed','cancelled')), error text not null default '', created_at timestamptz not null default now(),
 unique(organization_id,id), foreign key(organization_id,donor_id) references public.donors(organization_id,id), foreign key(organization_id,pledge_id) references public.pledges(organization_id,id)
);
create table public.installments(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, schedule_id uuid not null, due_date date not null,
 amount_minor bigint not null check(amount_minor>0), payment_id uuid, created_at timestamptz not null default now(),
 foreign key(organization_id,schedule_id) references public.schedules(organization_id,id), foreign key(organization_id,payment_id) references public.payments(organization_id,id)
);
create table public.receipts(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, payment_id uuid not null, number bigint generated always as identity,
 language text not null check(language in ('en','he')), snapshot jsonb not null, created_at timestamptz not null default now(), unique(payment_id),
 foreign key(organization_id,payment_id) references public.payments(organization_id,id)
);
create table public.tasks(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), donor_id uuid, subject text not null, description text not null default '', assignee text not null default '', priority text not null default 'normal' check(priority in ('low','normal','high')), due_date date not null, status text not null default 'open' check(status in ('open','done')), created_at timestamptz not null default now(), foreign key(organization_id,donor_id) references public.donors(organization_id,id));
create table public.activities(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), donor_id uuid, type text not null, details text not null, responsible_user uuid default auth.uid(), created_at timestamptz not null default now(), foreign key(organization_id,donor_id) references public.donors(organization_id,id));

do $$ declare t text; begin
 foreach t in array array['funds','fundraisers','donor_accounts','donor_lists','list_members','events','sponsorships','payments','payment_allocations','schedules','installments','receipts','tasks','activities'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy member_read on public.%I for select to authenticated using(public.has_organization_role(organization_id,array[''owner'',''admin'',''fundraiser'',''accountant'',''viewer'']))',t);
 end loop;
 foreach t in array array['funds','fundraisers','donor_accounts','donor_lists','list_members','events','sponsorships','tasks'] loop
  execute format('grant insert on public.%I to authenticated',t);
  execute format('create policy staff_insert on public.%I for insert to authenticated with check(public.has_organization_role(organization_id,array[''owner'',''admin'',''fundraiser'']))',t);
 end loop;
end $$;

-- Money is changed only through these atomic functions, never direct client writes.
create function public.allocate_payment(payment uuid, allocations jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare p public.payments; item jsonb; pledge public.pledges; allocated bigint; settled bigint; reserved bigint; requested bigint;
begin
 select * into strict p from public.payments where id=payment;
 if not public.has_organization_role(p.organization_id,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied'; end if;
 perform 1 from public.donors where id=p.donor_id and organization_id=p.organization_id for update;
 if p.status<>'processed' then raise exception 'Only processed payments can be allocated'; end if;
 if jsonb_typeof(allocations)<>'array' then raise exception 'Allocation list required'; end if;
 for item in select * from jsonb_array_elements(allocations) loop
  requested := (item->>'amount_minor')::bigint;
  if requested is null or requested<=0 then raise exception 'Positive allocation required'; end if;
  select * into strict pledge from public.pledges where id=(item->>'pledge_id')::uuid and organization_id=p.organization_id and donor_id=p.donor_id;
  select coalesce(sum(amount_minor),0) into allocated from public.payment_allocations where payment_id=p.id;
  if allocated+requested>p.amount_minor then raise exception 'Allocation exceeds available payment credit'; end if;
  select coalesce(sum(amount_minor),0) into settled from public.payment_allocations where pledge_id=pledge.id;
  select coalesce(sum(i.amount_minor),0) into reserved from public.installments i join public.schedules s on s.id=i.schedule_id where s.pledge_id=pledge.id and s.status in ('active','paused') and i.payment_id is null;
  if settled+reserved+requested>pledge.amount_minor then raise exception 'Allocation exceeds unscheduled pledge balance'; end if;
  insert into public.payment_allocations(organization_id,payment_id,pledge_id,amount_minor) values(p.organization_id,p.id,pledge.id,requested)
  on conflict(payment_id,pledge_id) do update set amount_minor=public.payment_allocations.amount_minor+excluded.amount_minor;
 end loop;
 insert into public.activities(organization_id,donor_id,type,details) values(p.organization_id,p.donor_id,'allocation','Payment credit allocated to pledges');
end $$;

create function public.record_payment(org uuid, donor uuid, amount bigint, payment_date date, payment_method text, payment_status text, payment_reference text, request_key uuid, allocations jsonb default '[]', installment uuid default null,collector_name text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare payment uuid; existing public.payments; inst public.installments; plan public.schedules; payload jsonb;
begin
 if not public.has_organization_role(org,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied'; end if;
 perform 1 from public.donors where organization_id=org and id=donor for update;
 if not found then raise exception 'Donor not found'; end if;
 payload:=jsonb_build_object('donor',donor,'amount',amount,'date',payment_date,'method',payment_method,'status',payment_status,'reference',coalesce(payment_reference,''),'allocations',allocations,'installment',installment,'collector',coalesce(collector_name,''));
 select * into existing from public.payments where organization_id=org and idempotency_key=request_key;
 if found then
  if existing.request_payload is distinct from payload then raise exception 'Idempotency key used for a different payment'; end if;
  return existing.id;
 end if;
 insert into public.payments(organization_id,donor_id,amount_minor,paid_on,method,status,reference,idempotency_key,request_payload,collector) values(org,donor,amount,payment_date,payment_method,payment_status,coalesce(payment_reference,''),request_key,payload,coalesce(collector_name,'')) returning id into payment;
 if installment is not null then
  select * into strict inst from public.installments where id=installment and organization_id=org for update;
  select * into strict plan from public.schedules where id=inst.schedule_id and donor_id=donor and status='active';
  if inst.payment_id is not null or inst.amount_minor<>amount or payment_status<>'processed' or allocations<>'[]'::jsonb then raise exception 'Invalid installment payment'; end if;
  update public.installments set payment_id=payment where id=inst.id;
  perform public.allocate_payment(payment,jsonb_build_array(jsonb_build_object('pledge_id',plan.pledge_id,'amount_minor',amount)));
  if not exists(select 1 from public.installments where schedule_id=plan.id and payment_id is null) then update public.schedules set status='completed' where id=plan.id; end if;
 else
  if payment_status<>'processed' and allocations<>'[]'::jsonb then raise exception 'Pending or failed payments cannot fulfill pledges'; end if;
  if payment_status='processed' then perform public.allocate_payment(payment,allocations); end if;
 end if;
 insert into public.activities(organization_id,donor_id,type,details) values(org,donor,'payment','Manual payment recorded: '||payment_status);
 return payment;
end $$;

create function public.record_payment_batch(org uuid, entries jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare item jsonb; n integer:=0;
begin
 if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries) not between 1 and 100 then raise exception 'Batch requires 1–100 rows'; end if;
 for item in select value from jsonb_array_elements(entries) order by value->>'donor_id' loop
  perform public.record_payment(org,(item->>'donor_id')::uuid,(item->>'amount_minor')::bigint,(item->>'paid_on')::date,item->>'method',item->>'status',coalesce(item->>'reference',''),(item->>'idempotency_key')::uuid,coalesce(item->'allocations','[]'::jsonb),null,coalesce(item->>'collector',''));
  n:=n+1;
 end loop;
 return n;
end $$;

create function public.create_schedule(org uuid, pledge uuid, schedule_kind text, schedule_frequency text, first_date date, total bigint, count integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.pledges; settled bigint; reserved bigint; plan uuid; n integer; step interval;
begin
 if not public.has_organization_role(org,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied'; end if;
 select * into strict p from public.pledges where id=pledge and organization_id=org;
 perform 1 from public.donors where id=p.donor_id and organization_id=org for update;
 if count is null or count not between 1 and 120 or total is null or total<count then raise exception 'Invalid installment count or amount'; end if;
 select coalesce(sum(amount_minor),0) into settled from public.payment_allocations where pledge_id=pledge;
 select coalesce(sum(i.amount_minor),0) into reserved from public.installments i join public.schedules s on s.id=i.schedule_id where s.pledge_id=pledge and s.status in ('active','paused') and i.payment_id is null;
 if total+settled+reserved>p.amount_minor then raise exception 'Schedule exceeds available pledge balance'; end if;
 step:=case schedule_frequency when 'weekly' then interval '1 week' when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' when 'yearly' then interval '1 year' else null end;
 if step is null then raise exception 'Invalid frequency'; end if;
 insert into public.schedules(organization_id,donor_id,pledge_id,kind,frequency,start_date,total_minor,payment_count) values(org,p.donor_id,pledge,schedule_kind,schedule_frequency,first_date,total,count) returning id into plan;
 for n in 0..count-1 loop
  insert into public.installments(organization_id,schedule_id,due_date,amount_minor) values(org,plan,(first_date+n*step)::date,total/count+case when n<total%count then 1 else 0 end);
 end loop;
 insert into public.activities(organization_id,donor_id,type,details) values(org,p.donor_id,'schedule','Payment plan created; no automatic charge enabled');
 return plan;
end $$;

create function public.change_schedule(plan uuid, new_status text) returns void language plpgsql security definer set search_path='' as $$
declare s public.schedules;
begin
 select * into strict s from public.schedules where id=plan;
 if not public.has_organization_role(s.organization_id,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied'; end if;
 perform 1 from public.donors where id=s.donor_id and organization_id=s.organization_id for update;
 select * into strict s from public.schedules where id=plan;
 if new_status not in ('active','paused','cancelled') or s.status in ('completed','cancelled') then raise exception 'Invalid status transition'; end if;
 update public.schedules set status=new_status where id=plan;
end $$;

create function public.issue_receipt(payment uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.payments; d public.donors; o public.organizations; receipt uuid;
begin
 select * into strict p from public.payments where id=payment and status='processed';
 if not public.has_organization_role(p.organization_id,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied'; end if;
 select * into strict d from public.donors where id=p.donor_id;
 select * into strict o from public.organizations where id=p.organization_id;
 insert into public.receipts(organization_id,payment_id,language,snapshot) values(p.organization_id,p.id,d.receipt_language,jsonb_build_object('organization',o.name,'tax_id',o.tax_id,'donor',d.name,'hebrew_name',d.hebrew_name,'amount_minor',p.amount_minor,'paid_on',p.paid_on,'method',p.method,'reference',p.reference)) on conflict(payment_id) do nothing returning id into receipt;
 if receipt is null then select id into receipt from public.receipts where payment_id=payment; end if;
 return receipt;
end $$;

-- No grants to public/anon; security-definer entry points verify organization roles.
revoke all on function public.allocate_payment(uuid,jsonb),public.record_payment(uuid,uuid,bigint,date,text,text,text,uuid,jsonb,uuid,text),public.record_payment_batch(uuid,jsonb),public.create_schedule(uuid,uuid,text,text,date,bigint,integer),public.change_schedule(uuid,text),public.issue_receipt(uuid) from public;
grant execute on function public.allocate_payment(uuid,jsonb),public.record_payment(uuid,uuid,bigint,date,text,text,text,uuid,jsonb,uuid,text),public.record_payment_batch(uuid,jsonb),public.create_schedule(uuid,uuid,text,text,date,bigint,integer),public.change_schedule(uuid,text),public.issue_receipt(uuid) to authenticated;
create index payments_org_donor_idx on public.payments(organization_id,donor_id);
create index allocations_pledge_idx on public.payment_allocations(pledge_id);
create index installments_schedule_idx on public.installments(schedule_id);
commit;
