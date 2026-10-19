begin;
create table public.attachments(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), donor_id uuid not null,
 file_name text not null check(length(file_name) between 1 and 255), mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg','text/plain')),
 size_bytes integer not null check(size_bytes between 1 and 5242880), storage_path text not null unique,
 created_at timestamptz not null default now(), foreign key(organization_id,donor_id) references public.donors(organization_id,id),
 check(split_part(storage_path,'/',1)=organization_id::text and split_part(storage_path,'/',2)=donor_id::text)
);
alter table public.attachments enable row level security;
revoke all on public.attachments from anon,authenticated;
grant select,insert on public.attachments to authenticated;
create policy attachment_read on public.attachments for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin','fundraiser','accountant','viewer']));
create policy attachment_insert on public.attachments for insert to authenticated with check(public.has_organization_role(organization_id,array['owner','admin','fundraiser']));

-- Supabase Storage is installed on hosted projects. Embedded PostgreSQL tests
-- validate metadata policies; hosted object policy validation remains required.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('donor-attachments','donor-attachments',false,5242880,array['application/pdf','image/png','image/jpeg','text/plain']) on conflict(id) do nothing;
  execute $policy$create policy donor_file_read on storage.objects for select to authenticated using(bucket_id='donor-attachments' and public.has_organization_role((storage.foldername(name))[1]::uuid,array['owner','admin','fundraiser','accountant','viewer']))$policy$;
  execute $policy$create policy donor_file_insert on storage.objects for insert to authenticated with check(bucket_id='donor-attachments' and public.has_organization_role((storage.foldername(name))[1]::uuid,array['owner','admin','fundraiser']))$policy$;
  execute $policy$create policy donor_file_cleanup on storage.objects for delete to authenticated using(bucket_id='donor-attachments' and public.has_organization_role((storage.foldername(name))[1]::uuid,array['owner','admin','fundraiser']))$policy$;
 end if;
end $$;
commit;
