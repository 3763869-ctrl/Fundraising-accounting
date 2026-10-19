begin;
create table public.custom_field_definitions(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),name text not null,field_key text not null check(field_key~'^[a-z][a-z0-9_]{0,49}$'),field_type text not null check(field_type in ('text','number','date','boolean')),required boolean not null default false,created_at timestamptz not null default now(),unique(organization_id,field_key));
alter table public.custom_field_definitions enable row level security;
revoke all on public.custom_field_definitions from anon,authenticated;
grant select,insert on public.custom_field_definitions to authenticated;
create policy field_read on public.custom_field_definitions for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin','fundraiser','accountant','viewer']));
create policy field_insert on public.custom_field_definitions for insert to authenticated with check(public.has_organization_role(organization_id,array['owner','admin']));
create function public.validate_donor_custom_fields() returns trigger language plpgsql security definer set search_path='' as $$
declare field public.custom_field_definitions;value jsonb;begin
 for field in select * from public.custom_field_definitions where organization_id=new.organization_id loop
  value:=new.custom_fields->field.field_key;
  if value is null or value='null'::jsonb or value='""'::jsonb then if field.required then raise exception 'Required custom field: %',field.name;else continue;end if;end if;
  if (field.field_type in ('text','date') and jsonb_typeof(value)<>'string') or (field.field_type='number' and jsonb_typeof(value)<>'number') or (field.field_type='boolean' and jsonb_typeof(value)<>'boolean') then raise exception 'Incorrect type for custom field: %',field.name;end if;
  if field.field_type='date' then perform (new.custom_fields->>field.field_key)::date;end if;
 end loop;return new;
end $$;
create trigger donor_custom_fields before insert or update of custom_fields on public.donors for each row execute function public.validate_donor_custom_fields();
revoke all on function public.validate_donor_custom_fields() from public;
commit;
