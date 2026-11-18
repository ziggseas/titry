-- «Титры» — схема базы Supabase.
-- Скрипт идемпотентный: его можно выполнять повторно поверх существующей базы.

-- ───────────── Профили ─────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text check (char_length(display_name) <= 60),
  bio text check (char_length(bio) <= 500),
  is_private boolean not null default false,
  created_at timestamptz not null default now()
);

-- ───────────── Записи: одна строка на пользователя и тайтл ─────────────
create table if not exists public.entries (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  media text not null check (media in ('movie','tv')),
  tmdb_id integer not null,
  title text not null,
  year integer,
  poster_path text,
  rating numeric(2,1) check (rating is null or (rating between 0.5 and 5 and rating * 2 = floor(rating * 2))),
  liked boolean not null default false,
  watchlist boolean not null default false,
  watched boolean not null default false,
  review text check (char_length(review) <= 20000),
  review_at timestamptz,
  episodes jsonb not null default '{}'::jsonb,
  seasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, media, tmdb_id)
);
create index if not exists entries_title_idx on public.entries (media, tmdb_id);
create index if not exists entries_user_updated_idx on public.entries (user_id, updated_at desc);

-- ───────────── Дневник ─────────────
create table if not exists public.logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  media text not null check (media in ('movie','tv')),
  tmdb_id integer not null,
  title text not null,
  year integer,
  poster_path text,
  watched_on date not null default current_date,
  rating numeric(2,1) check (rating is null or (rating between 0.5 and 5 and rating * 2 = floor(rating * 2))),
  liked boolean not null default false,
  rewatch boolean not null default false,
  note text check (char_length(note) <= 20000),
  season integer,
  created_at timestamptz not null default now()
);
create index if not exists logs_user_date_idx on public.logs (user_id, watched_on desc, id desc);
create index if not exists logs_created_idx on public.logs (created_at desc);

-- ───────────── Списки ─────────────
create table if not exists public.lists (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 2000),
  is_ranked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lists_user_idx on public.lists (user_id, updated_at desc);

create table if not exists public.list_items (
  id bigint generated always as identity primary key,
  list_id bigint not null references public.lists(id) on delete cascade,
  media text not null check (media in ('movie','tv')),
  tmdb_id integer not null,
  title text not null,
  year integer,
  poster_path text,
  position integer not null default 0,
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  unique (list_id, media, tmdb_id)
);
create index if not exists list_items_list_idx on public.list_items (list_id, position);

-- ───────────── Подписки ─────────────
create table if not exists public.follows (
  follower uuid not null references public.profiles(id) on delete cascade,
  following uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, following),
  check (follower <> following)
);
create index if not exists follows_following_idx on public.follows (following);

-- ───────────── Функции ─────────────
-- Видны ли данные пользователя текущему зрителю
create or replace function public.can_view(owner uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select owner = auth.uid()
      or exists (select 1 from public.profiles p where p.id = owner and not p.is_private);
$$;

-- updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before update on public.entries
  for each row execute function public.touch_updated_at();
drop trigger if exists lists_touch on public.lists;
create trigger lists_touch before update on public.lists
  for each row execute function public.touch_updated_at();

-- Профиль при регистрации
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1), 'user'), '[^a-zA-Z0-9_]', '', 'g'));
  if char_length(base) < 3 then base := base || 'kino'; end if;
  base := left(base, 20);
  candidate := base;
  while exists (select 1 from public.profiles where username = candidate) loop
    n := n + 1;
    candidate := left(base, 20) || n::text;
  end loop;
  insert into public.profiles (id, username, display_name)
  values (new.id, candidate, nullif(left(coalesce(new.raw_user_meta_data->>'display_name', ''), 60), ''))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Статистика тайтла по сайту (только открытые профили и свой)
create or replace function public.title_stats(m text, tid integer)
returns json language sql stable security invoker set search_path = public as $$
  with e as (
    select e.* from public.entries e
    where e.media = m and e.tmdb_id = tid and public.can_view(e.user_id)
  )
  select json_build_object(
    'avg', (select round(avg(rating)::numeric, 2) from e where rating is not null),
    'ratings', (select count(*) from e where rating is not null),
    'watched', (select count(*) from e where watched or rating is not null or episodes <> '{}'::jsonb),
    'likes', (select count(*) from e where liked),
    'watchlist', (select count(*) from e where watchlist),
    'hist', (select json_agg(coalesce(c, 0) order by b)
             from generate_series(1, 10) b
             left join (select (rating * 2)::int k, count(*) c from e where rating is not null group by 1) h on h.k = b)
  );
$$;

-- ───────────── RLS ─────────────
alter table public.profiles   enable row level security;
alter table public.entries    enable row level security;
alter table public.logs       enable row level security;
alter table public.lists      enable row level security;
alter table public.list_items enable row level security;
alter table public.follows    enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists entries_select on public.entries;
create policy entries_select on public.entries for select using (public.can_view(user_id));
drop policy if exists entries_insert on public.entries;
create policy entries_insert on public.entries for insert with check (user_id = (select auth.uid()));
drop policy if exists entries_update on public.entries;
create policy entries_update on public.entries for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists entries_delete on public.entries;
create policy entries_delete on public.entries for delete using (user_id = (select auth.uid()));

drop policy if exists logs_select on public.logs;
create policy logs_select on public.logs for select using (public.can_view(user_id));
drop policy if exists logs_insert on public.logs;
create policy logs_insert on public.logs for insert with check (user_id = (select auth.uid()));
drop policy if exists logs_update on public.logs;
create policy logs_update on public.logs for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists logs_delete on public.logs;
create policy logs_delete on public.logs for delete using (user_id = (select auth.uid()));

drop policy if exists lists_select on public.lists;
create policy lists_select on public.lists for select using (public.can_view(user_id));
drop policy if exists lists_insert on public.lists;
create policy lists_insert on public.lists for insert with check (user_id = (select auth.uid()));
drop policy if exists lists_update on public.lists;
create policy lists_update on public.lists for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists lists_delete on public.lists;
create policy lists_delete on public.lists for delete using (user_id = (select auth.uid()));

drop policy if exists list_items_select on public.list_items;
create policy list_items_select on public.list_items for select
  using (exists (select 1 from public.lists l where l.id = list_id and public.can_view(l.user_id)));
drop policy if exists list_items_write on public.list_items;
create policy list_items_write on public.list_items for all
  using (exists (select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid())))
  with check (exists (select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid())));

drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows for select using (true);
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows for insert with check (follower = (select auth.uid()));
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete using (follower = (select auth.uid()));

-- ───────────── Права ─────────────
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.entries, public.logs, public.lists, public.list_items, public.follows to anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.entries, public.logs, public.lists, public.list_items, public.follows to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.can_view(uuid) to anon, authenticated;
grant execute on function public.title_stats(text, integer) to anon, authenticated;
