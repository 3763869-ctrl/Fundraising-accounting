begin;
create function public.resolve_pending_payment(payment uuid,new_status text,dated date) returns void language plpgsql security definer set search_path='' as $$
declare p public.payments;begin
 select * into strict p from public.payments where id=payment;
 if not public.has_organization_role(p.organization_id,array['owner','admin','fundraiser','accountant']) then raise exception 'Permission denied';end if;
 perform 1 from public.donors where id=p.donor_id for update;
 select * into strict p from public.payments where id=payment for update;
 if p.status<>'pending' or new_status not in ('processed','failed') or dated<p.paid_on then raise exception 'Invalid pending-payment resolution';end if;
 update public.payments set status=new_status,paid_on=dated where id=payment;
 insert into public.activities(organization_id,donor_id,type,details) values(p.organization_id,p.donor_id,'payment','Pending payment resolved as '||new_status);
end $$;
revoke all on function public.resolve_pending_payment(uuid,text,date) from public;
grant execute on function public.resolve_pending_payment(uuid,text,date) to authenticated;
commit;
