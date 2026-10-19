begin;
-- Explicitly limited edit functions keep organization keys and financial records immutable.
create function public.update_donor(org uuid, donor uuid, attributes jsonb) returns void language plpgsql security definer set search_path='' as $$
declare previous public.donors; replacement public.donors;
begin
 if not public.has_organization_role(org,array['owner','admin','fundraiser']) then raise exception 'Permission denied'; end if;
 select * into strict previous from public.donors where id=donor and organization_id=org for update;
 replacement:=jsonb_populate_record(previous,attributes);
 update public.donors set name=replacement.name,title=replacement.title,hebrew_name=replacement.hebrew_name,email=replacement.email,emails=replacement.emails,phones=replacement.phones,addresses=replacement.addresses,tags=replacement.tags,notes=replacement.notes,occasions=replacement.occasions,custom_fields=replacement.custom_fields,receipt_language=replacement.receipt_language,fundraiser_id=replacement.fundraiser_id where id=donor and organization_id=org;
 insert into public.activities(organization_id,donor_id,type,details) values(org,donor,'updated','Donor contact information updated');
end $$;
create function public.update_organization(org uuid, attributes jsonb) returns void language plpgsql security definer set search_path='' as $$
declare previous public.organizations; replacement public.organizations;
begin
 if not public.has_organization_role(org,array['owner','admin']) then raise exception 'Permission denied'; end if;
 select * into strict previous from public.organizations where id=org for update;
 replacement:=jsonb_populate_record(previous,attributes);
 if replacement.timezone not in ('America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix','America/Anchorage','Pacific/Honolulu') then raise exception 'Unsupported timezone'; end if;
 update public.organizations set name=replacement.name,hebrew_name=replacement.hebrew_name,tax_id=replacement.tax_id,timezone=replacement.timezone where id=org;
end $$;
create function public.set_task_status(task uuid, new_status text) returns void language plpgsql security definer set search_path='' as $$
declare previous public.tasks;
begin
 select * into strict previous from public.tasks where id=task;
 if not public.has_organization_role(previous.organization_id,array['owner','admin','fundraiser']) then raise exception 'Permission denied'; end if;
 if new_status not in ('open','done') then raise exception 'Invalid task status'; end if;
 update public.tasks set status=new_status where id=task;
 insert into public.activities(organization_id,donor_id,type,details) values(previous.organization_id,previous.donor_id,'task','Task marked '||new_status||': '||previous.subject);
end $$;
revoke all on function public.update_donor(uuid,uuid,jsonb),public.update_organization(uuid,jsonb),public.set_task_status(uuid,text) from public;
grant execute on function public.update_donor(uuid,uuid,jsonb),public.update_organization(uuid,jsonb),public.set_task_status(uuid,text) to authenticated;

create function public.audit_contact_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare linked_donor uuid;
begin
 if tg_table_name='donors' then linked_donor:=new.id; else linked_donor:=(to_jsonb(new)->>'donor_id')::uuid; end if;
 insert into public.activities(organization_id,donor_id,type,details) values(new.organization_id,linked_donor,'created',replace(tg_table_name,'_',' ')||' record created');
 return new;
end $$;
revoke all on function public.audit_contact_insert() from public;
do $$ declare t text; begin
 foreach t in array array['donors','campaigns','pledges','funds','fundraisers','donor_accounts','donor_lists','list_members','events','sponsorships','tasks'] loop
  execute format('create trigger audit_insert after insert on public.%I for each row execute function public.audit_contact_insert()',t);
 end loop;
end $$;

-- Contact collection shapes are validated at the database boundary, including API writes.
alter table public.donors add constraint donor_contact_shapes check(jsonb_typeof(emails)='array' and jsonb_typeof(phones)='array' and jsonb_typeof(addresses)='array' and jsonb_typeof(occasions)='array' and jsonb_typeof(custom_fields)='object');
commit;
