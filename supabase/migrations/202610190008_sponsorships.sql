begin;
alter table public.pledges add column sponsorship_date date,add column expected_payment_type text not null default 'unspecified' check(expected_payment_type in ('unspecified','check','cash','bank_transfer','external_card','charity_card'));
create function public.enforce_sponsorship_capacity() returns trigger language plpgsql security definer set search_path='' as $$
declare capacity integer;begin
 if new.sponsorship_id is null then return new;end if;
 select availability_limit into strict capacity from public.sponsorships where id=new.sponsorship_id and organization_id=new.organization_id for update;
 if (select count(*) from public.pledges where sponsorship_id=new.sponsorship_id)>=capacity then raise exception 'This sponsorship has no remaining availability';end if;
 return new;
end $$;
create trigger sponsorship_capacity before insert on public.pledges for each row execute function public.enforce_sponsorship_capacity();
revoke all on function public.enforce_sponsorship_capacity() from public;
commit;
