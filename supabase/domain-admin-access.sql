create or replace function public.is_quiz_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and lower(u.email) = 'bonddesign85@gmail.com'
  );
$$;

create or replace function public.is_quiz_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and (
        lower(u.email) = 'bonddesign85@gmail.com'
        or lower(u.email) ~ '^[^@[:space:]]+@ofam[.]ua$'
      )
  );
$$;

revoke all on function public.is_quiz_owner() from public, anon;
revoke all on function public.is_quiz_admin() from public, anon;
grant execute on function public.is_quiz_owner() to authenticated;
grant execute on function public.is_quiz_admin() to authenticated;

drop function if exists public.manage_quiz_admins(text,text);
