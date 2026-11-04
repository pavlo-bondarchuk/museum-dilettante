create or replace function public.manage_quiz_admins(p_action text, p_email text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare
 v_email text := lower(trim(coalesce(p_email,'')));
 v_count integer;
 v_emails jsonb;
begin
 if not public.is_quiz_admin() then
   raise exception 'Адміністративний доступ заборонено' using errcode='42501';
 end if;
 if p_action='add' then
   if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_email)>254 then
     raise exception 'Некоректна електронна адреса';
   end if;
   insert into public.quiz_admin_emails(email) values(v_email) on conflict do nothing;
 elsif p_action='remove' then
   if v_email='' then raise exception 'Оберіть email'; end if;
   select count(*) into v_count from public.quiz_admin_emails;
   if v_count<=1 then raise exception 'Не можна видалити останнього адміністратора'; end if;
   if v_email=(select lower(email) from auth.users where id=auth.uid()) then
     raise exception 'Не можна видалити власний доступ';
   end if;
   delete from public.quiz_admin_emails where lower(email)=v_email;
 elsif p_action<>'list' then
   raise exception 'Невідома операція';
 end if;
 select coalesce(jsonb_agg(email order by email),'[]'::jsonb) into v_emails
 from public.quiz_admin_emails;
 return jsonb_build_object('emails',v_emails);
end;
$$;
revoke all on function public.manage_quiz_admins(text,text) from public,anon;
grant execute on function public.manage_quiz_admins(text,text) to authenticated;
