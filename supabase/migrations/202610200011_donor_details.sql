begin;
alter table public.donors
 add column first_name text not null default '',
 add column last_name text not null default '',
 add column english_name text not null default '',
 add column alternate_names jsonb not null default '[]' check(jsonb_typeof(alternate_names)='array'),
 add column phone_contacts jsonb not null default '[]' check(jsonb_typeof(phone_contacts)='array'),
 add column email_contacts jsonb not null default '[]' check(jsonb_typeof(email_contacts)='array'),
 add column active boolean not null default true;

-- Preserve existing display names; separate fields are initialized when edited.
create or replace function public.update_donor(org uuid, donor uuid, attributes jsonb) returns void language plpgsql security definer set search_path='' as $$
declare previous public.donors; replacement public.donors;
begin
 if not public.has_organization_role(org,array['owner','admin','fundraiser']) then raise exception 'Permission denied'; end if;
 select * into strict previous from public.donors where id=donor and organization_id=org for update;
 replacement:=jsonb_populate_record(previous,attributes);
 update public.donors set name=replacement.name,title=replacement.title,hebrew_name=replacement.hebrew_name,email=replacement.email,emails=replacement.emails,phones=replacement.phones,addresses=replacement.addresses,tags=replacement.tags,notes=replacement.notes,occasions=replacement.occasions,custom_fields=replacement.custom_fields,receipt_language=replacement.receipt_language,fundraiser_id=replacement.fundraiser_id,
 first_name=replacement.first_name,last_name=replacement.last_name,english_name=replacement.english_name,alternate_names=replacement.alternate_names,phone_contacts=replacement.phone_contacts,email_contacts=replacement.email_contacts,active=replacement.active
 where id=donor and organization_id=org;
 insert into public.activities(organization_id,donor_id,type,details) values(org,donor,'updated','Donor contact information updated');
end $$;
revoke all on function public.update_donor(uuid,uuid,jsonb) from public;
grant execute on function public.update_donor(uuid,uuid,jsonb) to authenticated;
commit;
