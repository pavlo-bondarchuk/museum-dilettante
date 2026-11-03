create table if not exists public.quiz_questions (
  id bigint generated always as identity primary key,
  question text not null,
  answer numeric not null,
  unit text not null default '',
  active boolean not null default true
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_secret uuid not null,
  question_ids bigint[] not null,
  created_at timestamptz not null default now()
);

create table if not exists public.game_public (
  game_id uuid primary key references public.games(id) on delete cascade,
  code text not null unique,
  status text not null default 'lobby' check (status in ('lobby','answer','reveal','finished')),
  round integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.game_players (
  game_id uuid not null references public.games(id) on delete cascade,
  token uuid not null,
  name text not null,
  points integer not null default 0,
  penalties integer not null default 0,
  primary key (game_id, token)
);

create table if not exists public.game_guesses (
  game_id uuid not null references public.games(id) on delete cascade,
  round integer not null,
  token uuid not null,
  value numeric not null,
  primary key (game_id, round, token),
  foreign key (game_id, token) references public.game_players(game_id, token) on delete cascade
);

create table if not exists public.game_penalties (
  game_id uuid not null references public.games(id) on delete cascade,
  round integer not null,
  loser uuid,
  punishment text,
  primary key (game_id, round)
);

alter table public.quiz_questions enable row level security;
alter table public.games enable row level security;
alter table public.game_public enable row level security;
alter table public.game_players enable row level security;
alter table public.game_guesses enable row level security;
alter table public.game_penalties enable row level security;

drop policy if exists "Public live game state" on public.game_public;
create policy "Public live game state" on public.game_public for select to anon, authenticated using (true);

grant select on public.game_public to anon, authenticated;

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
  v_punishments text[] := array[
    'Проведіть 20-секундну екскурсію про найближчий стілець.',
    'Скажіть урочистий тост від імені однієї з шести колон портика.',
    'Придумайте абсолютно неправдиву легенду про грот.',
    'Зобразіть реакцію музейника на фразу: «А можна руками?»',
    'Вигадайте музейну етикетку для самого себе.',
    'Поясніть, чому музейний туалет — шедевр архітектури.',
    'Зробіть рекламу грота в стилі телемагазину.',
    'Придумайте назву виставки про сьогоднішній корпоратив.',
    'Розкажіть про музейний експонат, який ніхто ніколи не бачив.',
    'Протягом 20 секунд стійте як музейна скульптура.'
  ];
begin
  if p_action = 'create' then
    v_host := (p_data->>'host_secret')::uuid;
    if v_host is null then raise exception 'Missing host token'; end if;
    select count(*) into v_count from public.quiz_questions where active;
    if v_count < 1 then raise exception 'Спочатку додайте запитання в quiz_questions'; end if;
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    insert into public.games (code, host_secret, question_ids)
    values (v_code, v_host, array(select id from public.quiz_questions where active order by random() limit 20))
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
      select g.token into v_worst
      from public.game_guesses g
      where g.game_id = v_game.id and g.round = v_state.round
      order by abs(g.value - v_question.answer) desc, g.token
      limit 1;
      update public.game_players p set points = points +
        case when g.value = v_question.answer then 5
             when abs(g.value - v_question.answer) = (
               select min(abs(z.value - v_question.answer)) from public.game_guesses z
               where z.game_id = v_game.id and z.round = v_state.round
             ) then 3 else 0 end
      from public.game_guesses g
      where p.game_id = v_game.id and g.game_id = v_game.id and g.round = v_state.round and p.token = g.token;
      if v_worst is not null then
        update public.game_players set penalties = penalties + 1 where game_id = v_game.id and token = v_worst;
        insert into public.game_penalties(game_id, round, loser, punishment)
        values(v_game.id, v_state.round, v_worst, v_punishments[1 + floor(random() * array_length(v_punishments,1))::integer]);
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
      'id', p.token::text, 'name', p.name, 'points', p.points, 'penalties', p.penalties,
      'answered', g.token is not null,
      'value', case when v_state.status in ('reveal','finished') then g.value else null end,
      'error', case when v_state.status in ('reveal','finished') then abs(g.value - v_question.answer) else null end
    ) order by p.points desc, p.name), '[]'::jsonb) into v_players
    from public.game_players p
    left join public.game_guesses g on g.game_id = p.game_id and g.token = p.token and g.round = v_state.round
    where p.game_id = v_game.id;
    return jsonb_build_object('ok', true, 'snapshot', jsonb_build_object(
      'code', v_code, 'status', v_state.status, 'round', v_state.round,
      'total', array_length(v_game.question_ids, 1), 'question', v_question.question,
      'unit', case when v_state.status in ('reveal','finished') then v_question.unit else null end,
      'correct', case when v_state.status in ('reveal','finished') then v_question.answer else null end,
      'answered', v_answered, 'players', v_players,
      'loser', (select p.name from public.game_players p where p.game_id = v_game.id and p.token = v_penalty.loser),
      'punishment', v_penalty.punishment
    ));
  end if;
  return jsonb_build_object('ok', false, 'message', 'Невідома дія');
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok', false, 'message', 'Некоректні дані');
end;
$$;

revoke all on function public.game_api(text,jsonb) from public;
grant execute on function public.game_api(text,jsonb) to anon, authenticated;

insert into public.quiz_questions (question, answer, unit) values
('Скільки колон підтримує головний портик музею?', 6, 'колон'),
('У якому році Мартин Католіков отримав ділянку майбутнього музею?', 1810, 'рік'),
('Скільки вітражів було у старому готичному вікні над сходами?', 7, 'вітражів'),
('У якому році відкрився Одеський художній музей?', 1899, 'рік'),
('Скільки рублів додатково планували виділити на підземні роботи для виставки?', 2000, 'рублів'),
('Скільки великих і малих кімнат налічував опис палацу наприкінці XIX століття?', 22, 'кімнати'),
('Скільки вікон другого поверху з боку моря заклали у 1902 році?', 7, 'вікон'),
('У якому році Маразлі придбав палац?', 1888, 'рік'),
('Скільки людей могли йти підземною галереєю поруч?', 2, 'людини'),
('Скільки секунд, за газетним описом 1895 року, залишалося йти до виходу з галереї?', 30, 'секунд'),
('У якому році відреставрували овальну клумбу, засадивши її самшитом?', 1988, 'рік'),
('Скільки нових виставкових залів утворилося внаслідок перебудови лівої частини музею?', 3, 'зали');

do $$ begin
  begin
    alter publication supabase_realtime add table public.game_public;
  exception when duplicate_object then null;
  end;
end $$;
