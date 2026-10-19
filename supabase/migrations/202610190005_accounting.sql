begin;
create table public.accounts(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),code text not null,name text not null,kind text not null check(kind in ('asset','liability','income','expense','equity')),purpose text not null default 'general',created_at timestamptz not null default now(),unique(organization_id,code),unique(organization_id,id));
create table public.journal_entries(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),entry_date date not null,description text not null,event_key text not null,source text not null,payload jsonb not null,created_at timestamptz not null default now(),unique(organization_id,event_key),unique(organization_id,id));
create table public.journal_lines(id uuid primary key default gen_random_uuid(),organization_id uuid not null,entry_id uuid not null,account_id uuid not null,fund_id uuid,debit_minor bigint not null default 0 check(debit_minor>=0),credit_minor bigint not null default 0 check(credit_minor>=0),created_at timestamptz not null default now(),check((debit_minor>0 and credit_minor=0) or (credit_minor>0 and debit_minor=0)),foreign key(organization_id,entry_id) references public.journal_entries(organization_id,id),foreign key(organization_id,account_id) references public.accounts(organization_id,id),foreign key(organization_id,fund_id) references public.funds(organization_id,id));
create table public.pledge_recognitions(id uuid primary key default gen_random_uuid(),organization_id uuid not null,pledge_id uuid not null unique,amount_minor bigint not null check(amount_minor>0),recognized_on date not null,entry_id uuid not null,created_at timestamptz not null default now(),foreign key(organization_id,pledge_id) references public.pledges(organization_id,id),foreign key(organization_id,entry_id) references public.journal_entries(organization_id,id));
create table public.vendors(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),name text not null check(length(trim(name)) between 1 and 200),contact text not null default '',email text not null default '',phone text not null default '',address text not null default '',created_at timestamptz not null default now(),unique(organization_id,id));
create table public.bills(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),vendor_id uuid not null,invoice_reference text not null,bill_date date not null,due_date date not null,amount_minor bigint not null check(amount_minor>0),expense_account_id uuid not null,fund_id uuid,description text not null default '',created_at timestamptz not null default now(),unique(organization_id,id),unique(organization_id,vendor_id,invoice_reference),foreign key(organization_id,vendor_id) references public.vendors(organization_id,id),foreign key(organization_id,expense_account_id) references public.accounts(organization_id,id),foreign key(organization_id,fund_id) references public.funds(organization_id,id));
create table public.bill_payments(id uuid primary key default gen_random_uuid(),organization_id uuid not null,bill_id uuid not null,bank_account_id uuid not null,amount_minor bigint not null check(amount_minor>0),paid_on date not null,method text not null check(method in ('check','bank_transfer')),check_number text,memo text not null default '',request_key uuid not null,created_at timestamptz not null default now(),unique(organization_id,request_key),foreign key(organization_id,bill_id) references public.bills(organization_id,id),foreign key(organization_id,bank_account_id) references public.accounts(organization_id,id));
create unique index bill_check_number_unique on public.bill_payments(bank_account_id,check_number) where method='check';
create table public.bank_transactions(id uuid primary key default gen_random_uuid(),organization_id uuid not null,bank_account_id uuid not null,external_id text not null,transaction_date date not null,description text not null,amount_minor bigint not null check(amount_minor<>0),entry_id uuid,status text not null default 'unmatched' check(status in ('unmatched','matched')),created_at timestamptz not null default now(),unique(organization_id,bank_account_id,external_id),unique(bank_account_id,entry_id),foreign key(organization_id,bank_account_id) references public.accounts(organization_id,id),foreign key(organization_id,entry_id) references public.journal_entries(organization_id,id));
create table public.reconciliations(id uuid primary key default gen_random_uuid(),organization_id uuid not null,bank_account_id uuid not null,statement_date date not null,ending_balance_minor bigint not null,starting_balance_minor bigint not null,created_at timestamptz not null default now(),unique(organization_id,id),unique(bank_account_id,statement_date),foreign key(organization_id,bank_account_id) references public.accounts(organization_id,id));
create table public.reconciliation_items(id uuid primary key default gen_random_uuid(),organization_id uuid not null,reconciliation_id uuid not null,bank_account_id uuid not null,entry_id uuid not null,created_at timestamptz not null default now(),unique(bank_account_id,entry_id),foreign key(organization_id,reconciliation_id) references public.reconciliations(organization_id,id),foreign key(organization_id,bank_account_id) references public.accounts(organization_id,id),foreign key(organization_id,entry_id) references public.journal_entries(organization_id,id));
create table public.import_runs(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),name text not null,added integer not null,updated integer not null default 0,failed integer not null,errors jsonb not null default '[]',created_at timestamptz not null default now());

do $$ declare t text; begin
 foreach t in array array['accounts','journal_entries','journal_lines','pledge_recognitions','vendors','bills','bill_payments','bank_transactions','reconciliations','reconciliation_items','import_runs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy org_read on public.%I for select to authenticated using(public.has_organization_role(organization_id,array[''owner'',''admin'',''accountant'',''viewer'']))',t);
 end loop;
end $$;
grant insert on public.vendors to authenticated;
create policy vendor_insert on public.vendors for insert to authenticated with check(public.has_organization_role(organization_id,array['owner','admin','accountant']));

create function public.initialize_accounts(org uuid) returns void language sql security definer set search_path='' as $$
 insert into public.accounts(organization_id,code,name,kind,purpose) values
 (org,'1000','Chase operating account','asset','bank'),(org,'1050','Undeposited funds','asset','undeposited'),(org,'1100','Pledges receivable','asset','receivable'),
 (org,'2000','Accounts payable','liability','payable'),(org,'2100','Unapplied donor credit','liability','donor_credit'),(org,'3000','Opening net assets','equity','opening'),
 (org,'4000','Contributions','income','contributions'),(org,'4100','Other income','income','general'),(org,'5000','Program expenses','expense','general'),(org,'5100','Office & administration','expense','general'),(org,'5200','Processing fees','expense','general') on conflict(organization_id,code) do nothing;
$$;
create function public.initialize_organization_accounts() returns trigger language plpgsql security definer set search_path='' as $$ begin perform public.initialize_accounts(new.id);return new;end $$;
create trigger organization_accounts after insert on public.organizations for each row execute function public.initialize_organization_accounts();
do $$ declare o record; begin for o in select id from public.organizations loop perform public.initialize_accounts(o.id);end loop;end $$;

-- Internal atomic writer. No client has direct write access to entries or lines.
create function public.write_journal(org uuid,event text,dated date,description text,source_type text,lines jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare entry uuid; previous public.journal_entries; item jsonb; debits bigint:=0;credits bigint:=0; cutoff date;
begin
 if dated is null or nullif(trim(description),'') is null or jsonb_typeof(lines)<>'array' or jsonb_array_length(lines)<2 then raise exception 'Journal needs a date, description and at least two lines'; end if;
 select * into previous from public.journal_entries where organization_id=org and event_key=event;
 if found then if previous.payload is distinct from lines or previous.entry_date<>dated or previous.description<>write_journal.description or previous.source<>source_type then raise exception 'Journal request key used for different data';end if;return previous.id;end if;
 perform 1 from public.accounts where organization_id=org and id in (select (value->>'account_id')::uuid from jsonb_array_elements(lines)) order by id for update;
 for item in select * from jsonb_array_elements(lines) loop
  if coalesce((item->>'debit_minor')::bigint,0)<0 or coalesce((item->>'credit_minor')::bigint,0)<0 or (coalesce((item->>'debit_minor')::bigint,0)>0)=(coalesce((item->>'credit_minor')::bigint,0)>0) then raise exception 'Each line must have exactly one positive debit or credit'; end if;
  if not exists(select 1 from public.accounts where id=(item->>'account_id')::uuid and organization_id=org) then raise exception 'Account not found'; end if;
  select max(statement_date) into cutoff from public.reconciliations where bank_account_id=(item->>'account_id')::uuid and organization_id=org;
  if cutoff is not null and dated<=cutoff then raise exception 'Cannot backdate transactions into a reconciled bank period'; end if;
  debits:=debits+coalesce((item->>'debit_minor')::bigint,0);credits:=credits+coalesce((item->>'credit_minor')::bigint,0);
 end loop;
 if debits<>credits or debits<=0 then raise exception 'Journal debits must equal credits';end if;
 insert into public.journal_entries(organization_id,event_key,entry_date,description,source,payload) values(org,event,dated,description,source_type,lines) returning id into entry;
 for item in select * from jsonb_array_elements(lines) loop
  insert into public.journal_lines(organization_id,entry_id,account_id,fund_id,debit_minor,credit_minor) values(org,entry,(item->>'account_id')::uuid,(item->>'fund_id')::uuid,coalesce((item->>'debit_minor')::bigint,0),coalesce((item->>'credit_minor')::bigint,0));
 end loop;
 return entry;
end $$;
create function public.account_for(org uuid,code text) returns uuid language sql stable security definer set search_path='' as $$ select a.id from public.accounts a where a.organization_id=org and a.code=$2 $$;

create function public.post_payment_to_ledger() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='processed' then perform public.write_journal(new.organization_id,'payment:'||new.id,new.paid_on,'Manual payment received','payment',jsonb_build_array(jsonb_build_object('account_id',public.account_for(new.organization_id,'1050'),'debit_minor',new.amount_minor),jsonb_build_object('account_id',public.account_for(new.organization_id,'2100'),'credit_minor',new.amount_minor)));end if;
 return new;
end $$;
create trigger payment_ledger after insert or update of status on public.payments for each row execute function public.post_payment_to_ledger();
create function public.post_allocation_to_ledger() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.payments;pledge public.pledges;fund uuid;delta bigint;target uuid;recognized date;
begin
 delta:=new.amount_minor-case when tg_op='UPDATE' then old.amount_minor else 0 end;
 if delta<=0 then raise exception 'Allocations cannot be reduced without a reversal';end if;
 select * into strict p from public.payments where id=new.payment_id;
 select * into strict pledge from public.pledges where id=new.pledge_id;
 select fund_id into fund from public.campaigns where id=pledge.campaign_id;
 select recognized_on into recognized from public.pledge_recognitions where pledge_id=new.pledge_id;
 target:=public.account_for(new.organization_id,case when recognized is not null then '1100' else '4000' end);
 perform public.write_journal(new.organization_id,'allocation:'||new.id||':'||new.amount_minor,greatest(p.paid_on,coalesce(recognized,p.paid_on)),'Donation allocated to pledge','allocation',jsonb_build_array(jsonb_build_object('account_id',public.account_for(new.organization_id,'2100'),'debit_minor',delta),jsonb_build_object('account_id',target,'fund_id',fund,'credit_minor',delta)));
 return new;
end $$;
create trigger allocation_ledger after insert or update on public.payment_allocations for each row execute function public.post_allocation_to_ledger();

-- Backfill existing first-phase records without recognizing any pledge automatically.
do $$ declare p record;a record;fund uuid; begin
 for p in select * from public.payments where status='processed' loop
  perform public.write_journal(p.organization_id,'payment:'||p.id,p.paid_on,'Manual payment received','payment',jsonb_build_array(jsonb_build_object('account_id',public.account_for(p.organization_id,'1050'),'debit_minor',p.amount_minor),jsonb_build_object('account_id',public.account_for(p.organization_id,'2100'),'credit_minor',p.amount_minor)));
 end loop;
 for a in select allocrow.*,payrow.paid_on,c.fund_id from public.payment_allocations allocrow join public.payments payrow on payrow.id=allocrow.payment_id join public.pledges pl on pl.id=allocrow.pledge_id join public.campaigns c on c.id=pl.campaign_id loop
  perform public.write_journal(a.organization_id,'allocation:'||a.id||':'||a.amount_minor,a.paid_on,'Donation allocated to pledge','allocation',jsonb_build_array(jsonb_build_object('account_id',public.account_for(a.organization_id,'2100'),'debit_minor',a.amount_minor),jsonb_build_object('account_id',public.account_for(a.organization_id,'4000'),'fund_id',a.fund_id,'credit_minor',a.amount_minor)));
 end loop;
end $$;

create function public.create_account(org uuid,account_code text,account_name text,account_kind text,account_purpose text) returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid;begin
 if not public.has_organization_role(org,array['owner','admin','accountant']) then raise exception 'Permission denied';end if;
 if nullif(trim(account_name),'') is null or nullif(trim(account_code),'') is null or account_purpose not in ('general','bank') or (account_purpose='bank' and account_kind<>'asset') then raise exception 'Invalid account';end if;
 insert into public.accounts(organization_id,code,name,kind,purpose) values(org,account_code,account_name,account_kind,account_purpose) returning accounts.id into id;return id;
end $$;
create function public.post_manual_journal(org uuid,dated date,memo text,request_key uuid,lines jsonb) returns uuid language plpgsql security definer set search_path='' as $$ begin
 if not public.has_organization_role(org,array['owner','admin','accountant']) then raise exception 'Permission denied';end if;
 if exists(select 1 from public.accounts where organization_id=org and id in (select (value->>'account_id')::uuid from jsonb_array_elements(lines)) and purpose in ('receivable','payable','donor_credit','undeposited','contributions')) then raise exception 'Use the donor, payment, deposit or bill workflow for control accounts';end if;
 return public.write_journal(org,'manual:'||request_key,dated,memo,'manual',lines);
end $$;
create function public.recognize_pledge(pledge uuid,dated date) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.pledges;outstanding bigint;fund uuid;entry uuid;begin
 select * into strict p from public.pledges where id=pledge;
 if not public.has_organization_role(p.organization_id,array['owner','admin','accountant']) then raise exception 'Permission denied';end if;
 perform 1 from public.donors where id=p.donor_id for update;
 if exists(select 1 from public.pledge_recognitions where pledge_id=pledge) then raise exception 'Pledge already recognized';end if;
 select p.amount_minor-coalesce(sum(amount_minor),0) into outstanding from public.payment_allocations where pledge_id=pledge;
 if outstanding<=0 then raise exception 'No unrecognized balance remains';end if;
 select fund_id into fund from public.campaigns where id=p.campaign_id;
 entry:=public.write_journal(p.organization_id,'recognition:'||pledge,dated,'Unconditional pledge recognized','recognition',jsonb_build_array(jsonb_build_object('account_id',public.account_for(p.organization_id,'1100'),'fund_id',fund,'debit_minor',outstanding),jsonb_build_object('account_id',public.account_for(p.organization_id,'4000'),'fund_id',fund,'credit_minor',outstanding)));
 insert into public.pledge_recognitions(organization_id,pledge_id,amount_minor,recognized_on,entry_id) values(p.organization_id,pledge,outstanding,dated,entry);return entry;
end $$;
create function public.deposit_payments(org uuid,bank uuid,dated date,payments uuid[],request_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p record;amount bigint:=0;entry uuid;begin
 if not public.has_organization_role(org,array['owner','admin','accountant']) then raise exception 'Permission denied';end if;
 if not exists(select 1 from public.accounts where id=bank and organization_id=org and purpose='bank') then raise exception 'Bank account required';end if;
 if coalesce(cardinality(deposit_payments.payments),0)<1 or cardinality(deposit_payments.payments)<>(select count(distinct x) from unnest(deposit_payments.payments) x) then raise exception 'Select distinct payments';end if;
 if exists(select 1 from public.journal_entries where organization_id=org and event_key='deposit:'||request_key) then raise exception 'Deposit request already recorded';end if;
 for p in select * from public.payments where organization_id=org and id=any(deposit_payments.payments) order by id for update loop
  if p.status<>'processed' or p.deposit_status<>'undeposited' or p.paid_on>dated then raise exception 'Payment cannot be deposited on this date';end if;amount:=amount+p.amount_minor;
 end loop;
 if (select count(*) from public.payments where organization_id=org and id=any(deposit_payments.payments))<>cardinality(deposit_payments.payments) then raise exception 'Unknown payment';end if;
 entry:=public.write_journal(org,'deposit:'||request_key,dated,'Deposit of received payments','deposit',jsonb_build_array(jsonb_build_object('account_id',bank,'debit_minor',amount),jsonb_build_object('account_id',public.account_for(org,'1050'),'credit_minor',amount)));
 update public.payments set deposit_status='deposited' where organization_id=org and id=any(deposit_payments.payments);return entry;
end $$;

create function public.create_bill(org uuid,vendor uuid,invoice text,dated date,due date,amount bigint,expense_account uuid,fund uuid,memo text) returns uuid language plpgsql security definer set search_path='' as $$
declare bill uuid;begin
 if not public.has_organization_role(org,array['owner','admin','accountant']) then raise exception 'Permission denied';end if;
 if not exists(select 1 from public.accounts where id=expense_account and organization_id=org and kind='expense') or nullif(trim(invoice),'') is null then raise exception 'Expense account and invoice required';end if;
 insert into public.bills(organization_id,vendor_id,invoice_reference,bill_date,due_date,amount_minor,expense_account_id,fund_id,description) values(org,vendor,invoice,dated,due,amount,expense_account,fund,coalesce(memo,'')) returning id into bill;
 perform public.write_journal(org,'bill:'||bill,dated,'Bill '||invoice,'bill',jsonb_build_array(jsonb_build_object('account_id',expense_account,'fund_id',fund,'debit_minor',amount),jsonb_build_object('account_id',public.account_for(org,'2000'),'fund_id',fund,'credit_minor',amount)));return bill;
end $$;
create function public.pay_bill(bill uuid,bank uuid,amount bigint,dated date,payment_method text,check_reference text,memo text,request_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.bills;settled bigint;payment uuid;begin
 select * into strict b from public.bills where id=bill for update;
 if not public.has_organization_role(b.organization_id,array['owner','admin','accountant']) then raise exception 'Permission denied';end if;
 if not exists(select 1 from public.accounts where id=bank and organization_id=b.organization_id and purpose='bank') then raise exception 'Bank account required';end if;
 if exists(select 1 from public.bill_payments where organization_id=b.organization_id and bill_payments.request_key=pay_bill.request_key) then raise exception 'Bill payment request already recorded';end if;
 select coalesce(sum(amount_minor),0) into settled from public.bill_payments where bill_id=bill;
 if amount<=0 or amount>b.amount_minor-settled or dated<b.bill_date or (payment_method='check' and nullif(trim(check_reference),'') is null) then raise exception 'Invalid bill payment';end if;
 insert into public.bill_payments(organization_id,bill_id,bank_account_id,amount_minor,paid_on,method,check_number,memo,request_key) values(b.organization_id,bill,bank,amount,dated,payment_method,nullif(check_reference,''),coalesce(memo,''),request_key) returning id into payment;
 perform public.write_journal(b.organization_id,'bill-payment:'||payment,dated,'Bill payment '||b.invoice_reference,'bill_payment',jsonb_build_array(jsonb_build_object('account_id',public.account_for(b.organization_id,'2000'),'fund_id',b.fund_id,'debit_minor',amount),jsonb_build_object('account_id',bank,'fund_id',b.fund_id,'credit_minor',amount)));return payment;
end $$;

revoke all on function public.initialize_accounts(uuid),public.initialize_organization_accounts(),public.account_for(uuid,text),public.write_journal(uuid,text,date,text,text,jsonb),public.post_payment_to_ledger(),public.post_allocation_to_ledger() from public;
revoke all on function public.create_account(uuid,text,text,text,text),public.post_manual_journal(uuid,date,text,uuid,jsonb),public.recognize_pledge(uuid,date),public.deposit_payments(uuid,uuid,date,uuid[],uuid),public.create_bill(uuid,uuid,text,date,date,bigint,uuid,uuid,text),public.pay_bill(uuid,uuid,bigint,date,text,text,text,uuid) from public;
grant execute on function public.create_account(uuid,text,text,text,text),public.post_manual_journal(uuid,date,text,uuid,jsonb),public.recognize_pledge(uuid,date),public.deposit_payments(uuid,uuid,date,uuid[],uuid),public.create_bill(uuid,uuid,text,date,date,bigint,uuid,uuid,text),public.pay_bill(uuid,uuid,bigint,date,text,text,text,uuid) to authenticated;
create index journal_lines_entry_idx on public.journal_lines(entry_id);
create index journal_lines_account_idx on public.journal_lines(account_id);

create function public.verify_journal_balance() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;n bigint;difference bigint;begin
 target:=coalesce((to_jsonb(new)->>'entry_id')::uuid,new.id);
 select count(*),coalesce(sum(debit_minor-credit_minor),0) into n,difference from public.journal_lines where entry_id=target;
 if n<2 or difference<>0 then raise exception 'Posted journal is not balanced';end if;return null;
end $$;
create constraint trigger journal_balanced after insert on public.journal_entries deferrable initially deferred for each row execute function public.verify_journal_balance();
create constraint trigger lines_balanced after insert on public.journal_lines deferrable initially deferred for each row execute function public.verify_journal_balance();
create function public.reject_ledger_change() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Posted ledger records are immutable; post a reversing entry';end $$;
create trigger immutable_entries before update or delete on public.journal_entries for each row execute function public.reject_ledger_change();
create trigger immutable_lines before update or delete on public.journal_lines for each row execute function public.reject_ledger_change();
revoke all on function public.verify_journal_balance(),public.reject_ledger_change() from public;
commit;
