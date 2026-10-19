begin;
create function public.import_bank_rows(org uuid,bank uuid,import_name text,rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb;added integer:=0;failed integer:=0;duplicates integer:=0;n integer:=0;errors jsonb:='[]';did_insert integer;begin
 if not public.has_organization_role(org,array['owner','admin','accountant']) then raise exception 'Permission denied';end if;
 if not exists(select 1 from public.accounts where id=bank and organization_id=org and purpose='bank') or jsonb_typeof(rows)<>'array' or jsonb_array_length(rows) not between 1 and 500 then raise exception 'Select a bank and 1–500 rows';end if;
 for item in select * from jsonb_array_elements(rows) loop
  n:=n+1;
  begin
   if nullif(trim(item->>'external_id'),'') is null or nullif(trim(item->>'description'),'') is null then raise exception 'External ID and description required';end if;
   insert into public.bank_transactions(organization_id,bank_account_id,external_id,transaction_date,description,amount_minor) values(org,bank,item->>'external_id',(item->>'transaction_date')::date,item->>'description',(item->>'amount_minor')::bigint) on conflict(organization_id,bank_account_id,external_id) do nothing;
   get diagnostics did_insert=row_count;
   if did_insert=1 then added:=added+1;else duplicates:=duplicates+1;end if;
  exception when others then failed:=failed+1;errors:=errors||jsonb_build_array(jsonb_build_object('row',n,'error',sqlerrm));end;
 end loop;
 insert into public.import_runs(organization_id,name,added,updated,failed,errors) values(org,coalesce(import_name,'Bank import'),added,0,failed,errors||case when duplicates>0 then jsonb_build_array(jsonb_build_object('duplicates_skipped',duplicates)) else '[]'::jsonb end);
 return jsonb_build_object('added',added,'failed',failed,'duplicates',duplicates,'errors',errors);
end $$;

create function public.match_bank_transaction(bank_transaction uuid,entry uuid) returns void language plpgsql security definer set search_path='' as $$
declare b public.bank_transactions;amount bigint;begin
 select * into strict b from public.bank_transactions where id=bank_transaction for update;
 if not public.has_organization_role(b.organization_id,array['owner','admin','accountant']) then raise exception 'Permission denied';end if;
 if b.status<>'unmatched' then raise exception 'Bank row already matched';end if;
 if not exists(select 1 from public.journal_entries where id=entry and organization_id=b.organization_id) then raise exception 'Entry not found';end if;
 select coalesce(sum(debit_minor-credit_minor),0) into amount from public.journal_lines where entry_id=entry and account_id=b.bank_account_id and organization_id=b.organization_id;
 if amount<>b.amount_minor then raise exception 'Bank amount does not match ledger amount';end if;
 update public.bank_transactions set entry_id=entry,status='matched' where id=b.id;
end $$;

create function public.create_bank_entry(bank_transaction uuid,category uuid,fund uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.bank_transactions;a public.accounts;entry uuid;lines jsonb;begin
 select * into strict b from public.bank_transactions where id=bank_transaction for update;
 if not public.has_organization_role(b.organization_id,array['owner','admin','accountant']) then raise exception 'Permission denied';end if;
 if b.status<>'unmatched' then raise exception 'Bank row already matched';end if;
 select * into strict a from public.accounts where id=category and organization_id=b.organization_id;
 if a.purpose in ('receivable','payable','donor_credit','undeposited','contributions') then raise exception 'Use the linked donor or bill workflow for this control account';end if;
 if (b.amount_minor>0 and a.kind not in ('income','liability','equity')) or (b.amount_minor<0 and a.kind not in ('expense','liability','equity')) then raise exception 'Select a suitable income or expense category';end if;
 if b.amount_minor>0 then lines:=jsonb_build_array(jsonb_build_object('account_id',b.bank_account_id,'fund_id',fund,'debit_minor',b.amount_minor),jsonb_build_object('account_id',category,'fund_id',fund,'credit_minor',b.amount_minor));
 else lines:=jsonb_build_array(jsonb_build_object('account_id',category,'fund_id',fund,'debit_minor',-b.amount_minor),jsonb_build_object('account_id',b.bank_account_id,'fund_id',fund,'credit_minor',-b.amount_minor));end if;
 entry:=public.write_journal(b.organization_id,'bank:'||b.id,b.transaction_date,b.description,'bank',lines);
 perform public.match_bank_transaction(b.id,entry);return entry;
end $$;

create function public.reconcile_bank(org uuid,bank uuid,statement_date date,ending_balance bigint,entries uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.reconciliations;delta bigint;reconciliation uuid;entry uuid;dated date;begin
 if not public.has_organization_role(org,array['owner','admin','accountant']) then raise exception 'Permission denied';end if;
 perform 1 from public.accounts where id=bank and organization_id=org and purpose='bank' for update;
 if not found then raise exception 'Bank account required';end if;
 select * into previous from public.reconciliations where bank_account_id=bank order by reconciliations.statement_date desc limit 1;
 if previous.statement_date is not null and statement_date<=previous.statement_date then raise exception 'Statement must follow previous reconciliation';end if;
 if cardinality(entries)<>(select count(distinct x) from unnest(entries) x) then raise exception 'Duplicate cleared entries';end if;
 foreach entry in array coalesce(entries,'{}') loop
  select entry_date into strict dated from public.journal_entries where id=entry and organization_id=org;
  if dated>statement_date or not exists(select 1 from public.journal_lines where entry_id=entry and account_id=bank) or exists(select 1 from public.reconciliation_items where entry_id=entry and bank_account_id=bank) then raise exception 'Invalid or already reconciled entry';end if;
 end loop;
 select coalesce(sum(debit_minor-credit_minor),0) into delta from public.journal_lines where entry_id=any(entries) and account_id=bank and organization_id=org;
 if coalesce(previous.ending_balance_minor,0)+delta<>ending_balance then raise exception 'Reconciliation difference must be zero';end if;
 insert into public.reconciliations(organization_id,bank_account_id,statement_date,ending_balance_minor,starting_balance_minor) values(org,bank,statement_date,ending_balance,coalesce(previous.ending_balance_minor,0)) returning id into reconciliation;
 foreach entry in array coalesce(entries,'{}') loop insert into public.reconciliation_items(organization_id,reconciliation_id,bank_account_id,entry_id) values(org,reconciliation,bank,entry);end loop;
 return reconciliation;
end $$;

revoke all on function public.import_bank_rows(uuid,uuid,text,jsonb),public.match_bank_transaction(uuid,uuid),public.create_bank_entry(uuid,uuid,uuid),public.reconcile_bank(uuid,uuid,date,bigint,uuid[]) from public;
grant execute on function public.import_bank_rows(uuid,uuid,text,jsonb),public.match_bank_transaction(uuid,uuid),public.create_bank_entry(uuid,uuid,uuid),public.reconcile_bank(uuid,uuid,date,bigint,uuid[]) to authenticated;
commit;
