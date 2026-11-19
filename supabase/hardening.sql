-- «Титры» — укрепление базы (19.11.2026). Идемпотентно: можно выполнять повторно.

-- 1. Права: отзываем всё, что Supabase выдаёт по умолчанию, и выдаём ровно нужное
revoke all on public.profiles, public.entries, public.logs, public.lists, public.list_items, public.follows from anon, authenticated;
grant select on public.profiles, public.entries, public.logs, public.lists, public.list_items, public.follows to anon;
grant select, update (username, display_name, bio, is_private) on public.profiles to authenticated;
grant select, insert, update, delete on public.entries, public.logs, public.lists, public.list_items, public.follows to authenticated;

-- 2. Формат и размер полей (постер — только путь TMDB вида /abc.jpg)
do $$
declare t text;
begin
  foreach t in array array['entries', 'logs', 'list_items'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_poster_path_chk');
    execute format($f$alter table public.%I add constraint %I check (poster_path is null or poster_path ~ '^/[A-Za-z0-9_-]+\.(jpe?g|png|webp|svg)$')$f$, t, t || '_poster_path_chk');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_title_len_chk');
    execute format('alter table public.%I add constraint %I check (char_length(title) between 1 and 300)', t, t || '_title_len_chk');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_year_chk');
    execute format('alter table public.%I add constraint %I check (year is null or year between 1870 and 2200)', t, t || '_year_chk');
  end loop;
end $$;

alter table public.entries drop constraint if exists entries_episodes_chk;
alter table public.entries add constraint entries_episodes_chk check (jsonb_typeof(episodes) = 'object' and pg_column_size(episodes) <= 32768);
alter table public.entries drop constraint if exists entries_seasons_chk;
alter table public.entries add constraint entries_seasons_chk check (jsonb_typeof(seasons) = 'array' and pg_column_size(seasons) <= 16384);
alter table public.entries drop constraint if exists entries_tmdb_id_chk;
alter table public.entries add constraint entries_tmdb_id_chk check (tmdb_id > 0);
alter table public.logs drop constraint if exists logs_season_chk;
alter table public.logs add constraint logs_season_chk check (season is null or season between 1 and 999);
alter table public.logs drop constraint if exists logs_date_chk;
alter table public.logs add constraint logs_date_chk check (watched_on between date '1900-01-01' and date '2200-01-01');

-- 3. Лимиты на количество записей у одного пользователя (проверка раз на запрос, не на строку)
create or replace function public.enforce_row_caps()
returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; over_user uuid;
begin
  if tg_table_name = 'entries' then cap := 20000;
    select n.user_id into over_user from (select distinct user_id from new_rows) n
      where (select count(*) from public.entries e where e.user_id = n.user_id) > cap limit 1;
  elsif tg_table_name = 'logs' then cap := 50000;
    select n.user_id into over_user from (select distinct user_id from new_rows) n
      where (select count(*) from public.logs e where e.user_id = n.user_id) > cap limit 1;
  elsif tg_table_name = 'lists' then cap := 300;
    select n.user_id into over_user from (select distinct user_id from new_rows) n
      where (select count(*) from public.lists e where e.user_id = n.user_id) > cap limit 1;
  elsif tg_table_name = 'follows' then cap := 5000;
    select n.follower into over_user from (select distinct follower from new_rows) n
      where (select count(*) from public.follows e where e.follower = n.follower) > cap limit 1;
  elsif tg_table_name = 'list_items' then cap := 2000;
    select null into over_user from (select distinct list_id from new_rows) n
      where (select count(*) from public.list_items e where e.list_id = n.list_id) > cap limit 1;
    if found then raise exception 'Превышен лимит: % тайтлов в одном списке', cap; end if;
    return null;
  end if;
  if over_user is not null then raise exception 'Превышен лимит записей (%) в таблице %', cap, tg_table_name; end if;
  return null;
end; $$;
revoke all on function public.enforce_row_caps() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['entries', 'logs', 'lists', 'list_items', 'follows'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_row_caps', t);
    execute format('create trigger %I after insert on public.%I referencing new table as new_rows for each statement execute function public.enforce_row_caps()', t || '_row_caps', t);
  end loop;
end $$;

-- 4. Одна политика чтения на list_items (вместо двух пересекающихся)
drop policy if exists list_items_write on public.list_items;
drop policy if exists list_items_insert on public.list_items;
create policy list_items_insert on public.list_items for insert
  with check (exists (select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid())));
drop policy if exists list_items_update on public.list_items;
create policy list_items_update on public.list_items for update
  using (exists (select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid())))
  with check (exists (select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid())));
drop policy if exists list_items_delete on public.list_items;
create policy list_items_delete on public.list_items for delete
  using (exists (select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid())));

-- 5. Удаление своего аккаунта: удаляет пользователя из auth.users,
--    профиль, записи, дневник, списки и подписки удаляются каскадом
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Нужно войти в аккаунт'; end if;
  delete from auth.users where id = uid;
end; $$;
revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
