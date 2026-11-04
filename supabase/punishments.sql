create table if not exists public.quiz_punishments (
 id bigint generated always as identity primary key,
 body text not null check(length(trim(body)) between 3 and 500),
 category text not null default 'Музейний абсурд',
 active boolean not null default true,
 question_id bigint references public.quiz_questions(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists quiz_punishments_question_idx on public.quiz_punishments(question_id) where active;
alter table public.quiz_punishments enable row level security;
create table if not exists public.quiz_settings(
 id integer primary key default 1 check (id=1),
 punishment_mode text not null default 'random' check (punishment_mode in ('random','no_repeat','linked'))
);
alter table public.quiz_settings enable row level security;
insert into public.quiz_settings (id,punishment_mode) values (1,'random') on conflict(id) do nothing;
insert into public.quiz_punishments (body,category)
select seed.body,seed.category
from (values ('Проведіть 20-секундну екскурсію про найближчий стілець.','Екскурсійні'),
('Скажіть урочистий тост від імені однієї з шести колон портика.','Акторські'),
('Придумайте абсолютно неправдиву легенду про грот.','Музейний абсурд'),
('Зобразіть реакцію музейника на фразу: «А можна руками?»','Акторські'),
('Вигадайте музейну етикетку для самого себе.','Музейний абсурд'),
('Поясніть, чому музейний туалет — шедевр архітектури.','Екскурсійні'),
('Зробіть рекламу грота в стилі телемагазину.','Акторські'),
('Придумайте назву виставки про сьогоднішній корпоратив.','Для колективу'),
('Розкажіть про музейний експонат, який ніхто ніколи не бачив.','Музейний абсурд'),
('Протягом 20 секунд стійте як музейна скульптура.','Акторські')) as seed(body,category)
where not exists(select 1 from public.quiz_punishments p where p.body=seed.body);

alter table public.games add column if not exists punishment_mode text not null default 'random'
 check (punishment_mode in ('random','no_repeat','linked'));
alter table public.game_penalties add column if not exists punishment_id bigint references public.quiz_punishments(id) on delete set null;

drop policy if exists "Quiz admins manage punishments" on public.quiz_punishments;
create policy "Quiz admins manage punishments" on public.quiz_punishments for all to authenticated
 using ((select public.is_quiz_admin())) with check ((select public.is_quiz_admin()));
drop policy if exists "Quiz admins manage settings" on public.quiz_settings;
create policy "Quiz admins manage settings" on public.quiz_settings for all to authenticated
 using ((select public.is_quiz_admin())) with check ((select public.is_quiz_admin()));
grant select,insert,update,delete on public.quiz_punishments, public.quiz_settings to authenticated;
grant usage,select on sequence public.quiz_punishments_id_seq to authenticated;

create or replace function public.game_api(p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.games%rowtype;
  v_state public.game_public%rowtype;
  v_code text := upper(coalesce(p_data->>'code', ''));
  v_token uuid;
  v_host uuid;
  v_name text;
  v_value numeric;
  v_question public.quiz_questions%rowtype;
  v_count integer;
  v_answered integer;
  v_players jsonb;
  v_penalty public.game_penalties%rowtype;
  v_worst uuid;
  v_penalty_id bigint;
  v_penalty_text text;
  v_mode text;
begin
  if p_action = 'create' then
    v_host := (p_data->>'host_secret')::uuid;
    if v_host is null then raise exception 'Missing host token'; end if;
    select count(*) into v_count from public.quiz_questions where active;
    if v_count < 1 then raise exception 'Спочатку додайте запитання в quiz_questions'; end if;
    if not exists (select 1 from public.quiz_questions where active and deck_id = coalesce(nullif(p_data->>'deck_id','')::bigint, (select id from public.quiz_decks where slug = 'building-history'))) then
      return jsonb_build_object('ok', false, 'message', 'У цій колоді немає активних запитань');
    end if;
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    insert into public.games (code, host_secret, question_ids, punishment_mode)
    values (v_code, v_host, array(select id from public.quiz_questions where active and deck_id = coalesce(nullif(p_data->>'deck_id','')::bigint, (select id from public.quiz_decks where slug = 'building-history')) order by random() limit 20), (select punishment_mode from public.quiz_settings where id = 1))
    returning * into v_game;
    insert into public.game_public (game_id, code) values (v_game.id, v_code);
    return jsonb_build_object('ok', true, 'code', v_code);
  end if;

  select * into v_game from public.games where code = v_code;
  if not found then return jsonb_build_object('ok', false, 'message', 'Кімнату не знайдено'); end if;

  if p_action in ('start', 'reveal', 'next', 'submit', 'join') then
    perform 1 from public.game_public where game_id = v_game.id for update;
  end if;
  select * into v_state from public.game_public where game_id = v_game.id;

  if p_action = 'join' then
    v_token := (p_data->>'player_token')::uuid;
    v_name := trim(coalesce(p_data->>'name', ''));
    if length(v_name) < 1 or length(v_name) > 28 then
      return jsonb_build_object('ok', false, 'message', 'Ім’я повинно містити від 1 до 28 символів');
    end if;
    if v_state.status <> 'lobby' and not exists (select 1 from public.game_players where game_id = v_game.id and token = v_token) then
      return jsonb_build_object('ok', false, 'message', 'Гра вже почалася');
    end if;
    select count(*) into v_count from public.game_players where game_id = v_game.id;
    if v_count >= 40 and not exists (select 1 from public.game_players where game_id = v_game.id and token = v_token) then
      return jsonb_build_object('ok', false, 'message', 'Кімната заповнена');
    end if;
    insert into public.game_players (game_id, token, name) values (v_game.id, v_token, v_name)
    on conflict (game_id, token) do nothing;
    update public.game_public set updated_at = now() where game_id = v_game.id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action in ('start', 'reveal', 'next') then
    v_host := (p_data->>'host_secret')::uuid;
    if v_host is distinct from v_game.host_secret then
      return jsonb_build_object('ok', false, 'message', 'Доступ ведучого відхилено');
    end if;
    if p_action = 'start' and v_state.status = 'lobby' then
      update public.game_public set status = 'answer', updated_at = now() where game_id = v_game.id;
    elsif p_action = 'reveal' and v_state.status = 'answer' then
      select * into v_question from public.quiz_questions where id = v_game.question_ids[v_state.round + 1];
      select count(*) into v_count from public.game_guesses g
      where g.game_id = v_game.id and g.round = v_state.round;
      v_worst := null;
      if v_count >= 2 and exists (
        select 1 from public.game_guesses g
        where g.game_id = v_game.id and g.round = v_state.round and g.value <> v_question.answer
      ) then
        select g.token into v_worst
        from public.game_guesses g
        where g.game_id = v_game.id and g.round = v_state.round
        order by abs(g.value - v_question.answer) desc, random()
        limit 1;
      end if;
      update public.game_players p set points = points +
        case when g.value = v_question.answer then 5
             when abs(g.value - v_question.answer) = (
               select min(abs(z.value - v_question.answer)) from public.game_guesses z
               where z.game_id = v_game.id and z.round = v_state.round
             ) then 3 else 0 end
      from public.game_guesses g
      where p.game_id = v_game.id and g.game_id = v_game.id and g.round = v_state.round and p.token = g.token;
      if v_worst is not null then
        v_penalty_id := null;
        v_penalty_text := null;
        v_mode := coalesce(v_game.punishment_mode, 'random');
        if v_mode = 'linked' then
          select p.id, p.body into v_penalty_id, v_penalty_text
          from public.quiz_punishments p
          where p.active and p.question_id = v_question.id
            and not exists (
              select 1 from public.game_penalties gp
              where gp.game_id = v_game.id
                and (gp.punishment_id = p.id or gp.punishment = p.body)
            )
          order by random() limit 1;
          if v_penalty_id is null then
            select p.id, p.body into v_penalty_id, v_penalty_text
            from public.quiz_punishments p
            where p.active and p.question_id is null
              and not exists (
                select 1 from public.game_penalties gp
                where gp.game_id = v_game.id
                  and (gp.punishment_id = p.id or gp.punishment = p.body)
              )
            order by random() limit 1;
          end if;
        end if;
        if v_penalty_id is null then
          select p.id, p.body into v_penalty_id, v_penalty_text
          from public.quiz_punishments p
          where p.active
            and not exists (
              select 1 from public.game_penalties gp
              where gp.game_id = v_game.id
                and (gp.punishment_id = p.id or gp.punishment = p.body)
            )
          order by random() limit 1;
        end if;
        if v_penalty_id is not null then
          update public.game_players set penalties = penalties + 1
          where game_id = v_game.id and token = v_worst;
          insert into public.game_penalties(game_id, round, loser, punishment, punishment_id)
          values(v_game.id, v_state.round, v_worst, v_penalty_text, v_penalty_id);
        end if;
      end if;
      update public.game_public set status = 'reveal', updated_at = now() where game_id = v_game.id;
    elsif p_action = 'next' and v_state.status = 'reveal' then
      if v_state.round + 1 >= array_length(v_game.question_ids,1) then
        update public.game_public set status = 'finished', updated_at = now() where game_id = v_game.id;
      else
        update public.game_public set round = round + 1, status = 'answer', updated_at = now() where game_id = v_game.id;
      end if;
    else
      return jsonb_build_object('ok', false, 'message', 'Ця дія недоступна на поточному етапі');
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'submit' then
    v_token := (p_data->>'player_token')::uuid;
    v_value := (p_data->>'value')::numeric;
    if v_state.status <> 'answer' then
      return jsonb_build_object('ok', false, 'message', 'Приймання відповідей завершено');
    end if;
    if v_value is null or abs(v_value) > 1000000000 then
      return jsonb_build_object('ok', false, 'message', 'Введіть число від -1 млрд до 1 млрд');
    end if;
    if not exists (select 1 from public.game_players where game_id = v_game.id and token = v_token) then
      return jsonb_build_object('ok', false, 'message', 'Спочатку приєднайтеся до гри');
    end if;
    insert into public.game_guesses (game_id, round, token, value)
    values(v_game.id, v_state.round, v_token, v_value)
    on conflict (game_id, round, token) do nothing;
    update public.game_public set updated_at = now() where game_id = v_game.id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'snapshot' then
    select * into v_question from public.quiz_questions where id = v_game.question_ids[v_state.round + 1];
    select count(*) into v_answered from public.game_guesses where game_id = v_game.id and round = v_state.round;
    select * into v_penalty from public.game_penalties where game_id = v_game.id and round = v_state.round;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(p.token::text), 'mine', case when p_data->>'player_token' = p.token::text then true else false end, 'name', p.name, 'points', p.points, 'penalties', p.penalties,
      'answered', g.token is not null,
      'value', case when v_state.status in ('reveal','finished') then g.value else null end,
      'error', case when v_state.status in ('reveal','finished') then abs(g.value - v_question.answer) else null end
    ) order by p.points desc, p.name), '[]'::jsonb) into v_players
    from public.game_players p
    left join public.game_guesses g on g.game_id = p.game_id and g.token = p.token and g.round = v_state.round
    where p.game_id = v_game.id;
    return jsonb_build_object('ok', true, 'snapshot', jsonb_build_object(
      'code', v_code, 'deck_name', (select d.name from public.quiz_questions q join public.quiz_decks d on d.id = q.deck_id where q.id = v_game.question_ids[1]), 'status', v_state.status, 'round', v_state.round,
      'total', array_length(v_game.question_ids, 1), 'question', v_question.question,
      'unit', case when v_state.status in ('reveal','finished') then v_question.unit else null end,
      'correct', case when v_state.status in ('reveal','finished') then v_question.answer else null end,
      'explanation', case when v_state.status in ('reveal','finished') then v_question.explanation else null end, 'answered', v_answered, 'players', v_players,
      'loser', (select p.name from public.game_players p where p.game_id = v_game.id and p.token = v_penalty.loser),
      'punishment', v_penalty.punishment
    ));
  end if;
  return jsonb_build_object('ok', false, 'message', 'Невідома дія');
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok', false, 'message', 'Некоректні дані');
end;
$$;


