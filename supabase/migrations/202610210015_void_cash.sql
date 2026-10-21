begin;
alter table public.payments drop constraint payments_status_check;
alter table public.payments add constraint payments_status_check check(status in ('processed','pending','failed','voided'));
alter table public.payments add column voided_at timestamptz,add column voided_by uuid references auth.users(id),add column void_reason text,add column void_date date,add column cash_void_snapshot jsonb;
alter table public.receipts add column voided_at timestamptz;
create function public.void_cash_payment(payment uuid,dated date,reason text) returns void language plpgsql security definer set search_path='' as $$
declare p public.payments; e record;lines jsonb;archived jsonb;cash_account uuid;
begin
 select * into strict p from public.payments where id=payment;
 if not public.has_organization_role(p.organization_id,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied';end if;
 perform 1 from public.donors where id=p.donor_id for update;
 select * into strict p from public.payments where id=payment for update;
 if p.method<>'cash' or exists(select 1 from public.sola_payment_attempts where payment_id=payment) then raise exception 'Only cash payments can be voided here';end if;
 if p.status='voided' then return;end if;
 if dated is null or dated<p.paid_on or nullif(trim(reason),'') is null or length(reason)>500 then raise exception 'A reason and a void date on or after the payment date are required';end if;
 select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('fund_id',c.fund_id)),'[]') into archived from public.payment_allocations a join public.pledges pl on pl.id=a.pledge_id join public.campaigns c on c.id=pl.campaign_id where a.payment_id=p.id;
 -- Posted journals and reconciliation history remain immutable. Reverse each
 -- allocation event, including incremental allocations, at the correction date.
 for e in select j.* from public.journal_entries j where j.organization_id=p.organization_id and exists(select 1 from public.payment_allocations a where a.payment_id=p.id and j.event_key like 'allocation:'||a.id||':%') order by j.id loop
  if dated<e.entry_date then raise exception 'Void date must be on or after all allocation dates';end if;
  select jsonb_agg(jsonb_build_object('account_id',l.account_id,'fund_id',l.fund_id,'debit_minor',l.credit_minor,'credit_minor',l.debit_minor) order by l.id) into lines from public.journal_lines l where l.entry_id=e.id;
  perform public.write_journal(p.organization_id,'cash-void:'||p.id||':'||e.id,dated,'Void cash allocation: '||reason,'cash_void',lines);
 end loop;
 if p.status='processed' then
  if p.deposit_status='deposited' then
   -- A recorded bank deposit is real cash movement. Keep bank balances and
   -- closed statements intact; hold the correction in suspense for review.
   insert into public.accounts(organization_id,code,name,kind,purpose) values(p.organization_id,'2995','Voided deposited cash suspense','liability','general') on conflict(organization_id,code) do nothing;
   select id into strict cash_account from public.accounts where organization_id=p.organization_id and code='2995' and kind='liability';
   insert into public.tasks(organization_id,donor_id,subject,description,priority,due_date) values(p.organization_id,p.donor_id,'Review voided deposited cash','Payment '||p.id||' was voided. The original bank deposit is retained; clear cash suspense after reviewing the bank records. Reason: '||reason,'high',dated);
  else cash_account:=public.account_for(p.organization_id,'1050');end if;
  perform public.write_journal(p.organization_id,'cash-void:'||p.id||':payment',dated,'Void cash payment: '||reason,'cash_void',jsonb_build_array(jsonb_build_object('account_id',public.account_for(p.organization_id,'2100'),'debit_minor',p.amount_minor),jsonb_build_object('account_id',cash_account,'credit_minor',p.amount_minor)));
 end if;
 delete from public.payment_allocations where payment_id=p.id;
 update public.installments set payment_id=null where payment_id=p.id;
 update public.schedules s set status='active' where s.organization_id=p.organization_id and s.status='completed' and exists(select 1 from public.installments i where i.schedule_id=s.id and i.payment_id is null);
 update public.receipts set voided_at=now() where payment_id=p.id;
 update public.payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=trim(reason),void_date=dated,cash_void_snapshot=jsonb_build_object('original_status',p.status,'allocations',archived,'deposit_status',p.deposit_status),updated_at=now() where id=p.id;
 insert into public.activities(organization_id,donor_id,type,details) values(p.organization_id,p.donor_id,'cash_payment_void','Cash payment '||p.id||' voided: '||reason);
end $$;
revoke all on function public.void_cash_payment(uuid,date,text) from public,anon;
grant execute on function public.void_cash_payment(uuid,date,text) to authenticated;
notify pgrst,'reload schema';
commit;
