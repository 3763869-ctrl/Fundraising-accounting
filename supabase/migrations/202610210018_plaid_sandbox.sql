begin;
-- Deliberately isolated: these tables never post journals or populate live bank feeds.
create table public.plaid_sandbox_connections(id uuid primary key default gen_random_uuid(),organization_id uuid not null unique references public.organizations(id),institution_name text not null default 'Simulated Chase',state text not null default 'disconnected' check(state in ('disconnected','connecting','connected','error')),last_synced_at timestamptz,operation_until timestamptz,error_code text,created_at timestamptz not null default now(),unique(organization_id,id));
create table public.plaid_sandbox_secrets(connection_id uuid primary key references public.plaid_sandbox_connections(id) on delete cascade,encrypted_token text not null,cursor text not null default '',version bigint not null default 0,lease_until timestamptz);
create table public.plaid_sandbox_transactions(id uuid primary key default gen_random_uuid(),organization_id uuid not null,connection_id uuid not null,transaction_id text not null,account_id text not null,posted_on date not null,name text not null check(length(name)<=500),amount_minor bigint not null,currency text not null check(currency='USD'),pending boolean not null,removed boolean not null default false,updated_at timestamptz not null default now(),unique(connection_id,transaction_id),foreign key(organization_id,connection_id) references public.plaid_sandbox_connections(organization_id,id) on delete cascade);
alter table public.plaid_sandbox_connections enable row level security;alter table public.plaid_sandbox_secrets enable row level security;alter table public.plaid_sandbox_transactions enable row level security;
revoke all on public.plaid_sandbox_connections,public.plaid_sandbox_secrets,public.plaid_sandbox_transactions from public,anon,authenticated;
grant select on public.plaid_sandbox_connections,public.plaid_sandbox_transactions to authenticated;
grant all on public.plaid_sandbox_connections,public.plaid_sandbox_transactions,public.plaid_sandbox_secrets to service_role;
create policy sandbox_connection_read on public.plaid_sandbox_connections for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin','accountant']));
create policy sandbox_transaction_read on public.plaid_sandbox_transactions for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin','accountant']));
create policy sandbox_connection_server on public.plaid_sandbox_connections for all to service_role using(true) with check(true);
create policy sandbox_transaction_server on public.plaid_sandbox_transactions for all to service_role using(true) with check(true);
create policy sandbox_secret_server on public.plaid_sandbox_secrets for all to service_role using(true) with check(true);
create function public.reserve_plaid_sandbox(org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.plaid_sandbox_connections;s public.plaid_sandbox_secrets;begin
 insert into public.plaid_sandbox_connections(organization_id) values(org) on conflict(organization_id) do nothing;
 select * into strict c from public.plaid_sandbox_connections where organization_id=org for update;
 if c.operation_until>now() then raise exception 'Bank operation already running';end if;
 update public.plaid_sandbox_connections set operation_until=now()+interval '3 minutes' where id=c.id;
 select * into s from public.plaid_sandbox_secrets where connection_id=c.id;
 return jsonb_build_object('id',c.id,'encrypted_token',s.encrypted_token,'cursor',coalesce(s.cursor,''),'version',coalesce(s.version,0));
end $$;
revoke all on function public.reserve_plaid_sandbox(uuid) from public,anon,authenticated;
grant execute on function public.reserve_plaid_sandbox(uuid) to service_role;
create function public.commit_plaid_sandbox_sync(connection uuid,expected_version bigint,added jsonb,modified jsonb,removed jsonb,next_cursor text) returns void language plpgsql security definer set search_path='' as $$
declare c public.plaid_sandbox_connections;s public.plaid_sandbox_secrets;r jsonb;begin
 select * into strict c from public.plaid_sandbox_connections where id=connection for update;
 select * into strict s from public.plaid_sandbox_secrets where connection_id=connection for update;
 if s.version<>expected_version then raise exception 'Sync changed; refresh saved state';end if;
 if jsonb_typeof(added)<>'array' or jsonb_typeof(modified)<>'array' or jsonb_typeof(removed)<>'array' or length(next_cursor)>20000 then raise exception 'Invalid sync batch';end if;
 for r in select value from jsonb_array_elements(added||modified) loop
  insert into public.plaid_sandbox_transactions(organization_id,connection_id,transaction_id,account_id,posted_on,name,amount_minor,currency,pending)
  values(c.organization_id,connection,r->>'transaction_id',r->>'account_id',(r->>'posted_on')::date,r->>'name',(r->>'amount_minor')::bigint,r->>'currency',(r->>'pending')::boolean)
  on conflict(connection_id,transaction_id) do update set account_id=excluded.account_id,posted_on=excluded.posted_on,name=excluded.name,amount_minor=excluded.amount_minor,currency=excluded.currency,pending=excluded.pending,removed=false,updated_at=now();
  if nullif(r->>'pending_transaction_id','') is not null then update public.plaid_sandbox_transactions set removed=true,updated_at=now() where connection_id=connection and transaction_id=r->>'pending_transaction_id' and transaction_id<>r->>'transaction_id';end if;
 end loop;
 update public.plaid_sandbox_transactions set removed=true,updated_at=now() where connection_id=connection and transaction_id in (select jsonb_array_elements_text(commit_plaid_sandbox_sync.removed));
 update public.plaid_sandbox_secrets set cursor=next_cursor,version=version+1,lease_until=null where connection_id=connection;
 update public.plaid_sandbox_connections set state='connected',last_synced_at=now(),operation_until=null,error_code=null where id=connection;
end $$;
revoke all on function public.commit_plaid_sandbox_sync(uuid,bigint,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.commit_plaid_sandbox_sync(uuid,bigint,jsonb,jsonb,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
