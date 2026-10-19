-- US/USD foundation. Apply once through Supabase migrations or the SQL editor.
begin;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  country text not null default 'US' check (country = 'US'),
  currency text not null default 'USD' check (currency = 'USD'),
  created_at timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','admin','fundraiser','accountant','viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);
create index memberships_user_id_idx on public.memberships(user_id);

create table public.donors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (length(trim(name)) between 1 and 200),
  email text check (length(email) <= 254),
  created_at timestamptz not null default now(),
  unique (organization_id,id)
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (length(trim(name)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (organization_id,id)
);

create table public.pledges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  donor_id uuid not null,
  campaign_id uuid not null,
  amount_minor bigint not null check (amount_minor between 1 and 99999999999),
  due_date date not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id,donor_id) references public.donors(organization_id,id),
  foreign key (organization_id,campaign_id) references public.campaigns(organization_id,id)
);
create index pledges_organization_created_idx on public.pledges(organization_id,created_at);

-- Avoid recursive membership policies; callers receive only a boolean for their own role.
create function public.has_organization_role(org uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = auth.uid() and m.role = any(allowed_roles)
  );
$$;
revoke all on function public.has_organization_role(uuid,text[]) from public;
grant execute on function public.has_organization_role(uuid,text[]) to authenticated;

-- Both rows are created in one transaction. There is no client membership insert policy.
create function public.create_organization(organization_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if organization_name is null or length(trim(organization_name)) not between 1 and 200 then
    raise exception 'Invalid organization name';
  end if;
  insert into public.organizations(name) values (trim(organization_name)) returning id into new_id;
  insert into public.memberships(organization_id,user_id,role) values (new_id,auth.uid(),'owner');
  return new_id;
end;
$$;
revoke all on function public.create_organization(text) from public;
grant execute on function public.create_organization(text) to authenticated;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.donors enable row level security;
alter table public.campaigns enable row level security;
alter table public.pledges enable row level security;

revoke all on public.organizations, public.memberships, public.donors, public.campaigns, public.pledges from anon, authenticated;
grant select on public.organizations, public.memberships, public.donors, public.campaigns, public.pledges to authenticated;
grant insert on public.donors, public.campaigns, public.pledges to authenticated;

create policy organization_read on public.organizations for select to authenticated
using (public.has_organization_role(id,array['owner','admin','fundraiser','accountant','viewer']));
create policy membership_read_self on public.memberships for select to authenticated using (user_id = auth.uid());

create policy donor_read on public.donors for select to authenticated
using (public.has_organization_role(organization_id,array['owner','admin','fundraiser','accountant','viewer']));
create policy donor_insert on public.donors for insert to authenticated
with check (public.has_organization_role(organization_id,array['owner','admin','fundraiser']));

create policy campaign_read on public.campaigns for select to authenticated
using (public.has_organization_role(organization_id,array['owner','admin','fundraiser','accountant','viewer']));
create policy campaign_insert on public.campaigns for insert to authenticated
with check (public.has_organization_role(organization_id,array['owner','admin','fundraiser']));

create policy pledge_read on public.pledges for select to authenticated
using (public.has_organization_role(organization_id,array['owner','admin','fundraiser','accountant','viewer']));
create policy pledge_insert on public.pledges for insert to authenticated
with check (public.has_organization_role(organization_id,array['owner','admin','fundraiser']));

commit;
