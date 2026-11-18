# Титры

Дневник фильмов и сериалов в духе Letterboxd: оценки от ½ до 5, рецензии, «Хочу посмотреть», учёт серий по сезонам, списки, публичные профили, подписки и лента друзей.

Всё работает на бесплатных сервисах: **GitHub** (код) → **Vercel** (хостинг и прокси TMDB) → **Supabase** (аккаунты и база) → **TMDB** (постеры и данные).

## Файлы

| Файл | Что внутри |
|---|---|
| `index.html` | Каркас страницы, шрифты, подвал с подписью TMDB |
| `assets/app.js` | Всё приложение: маршруты, экраны, работа с базой |
| `assets/util.js` | Чистые функции: серии, даты, CSV, импорт |
| `assets/styles.css` | Стиль «кинозал» |
| `assets/config.js` | Supabase URL и anon key (публичные) |
| `api/tmdb.js` | Серверная функция Vercel: прокси к TMDB с ключом из `TMDB_TOKEN` |
| `supabase/schema.sql` | Таблицы, RLS, триггер профиля, `title_stats` (можно выполнять повторно) |
| `vercel.json` | Все адреса отдают `index.html` |
| `.github/workflows/keepalive.yml` | Будит Supabase раз в три дня, чтобы проект не уснул |

## Запуск с нуля

1. **TMDB.** Зарегистрируйтесь на themoviedb.org → Settings → API → скопируйте *API Read Access Token* (длинный) или *API Key*.
2. **Supabase.** Создайте проект, в SQL Editor выполните `supabase/schema.sql`. В Project Settings → API возьмите URL и anon key и впишите в `assets/config.js` и `keepalive.yml`.
   В Authentication → URL Configuration укажите адрес сайта в *Site URL* и добавьте `https://ваш-сайт/**` в *Redirect URLs* — иначе ссылки из писем будут вести на localhost.
3. **Vercel.** Импортируйте репозиторий (Framework: Other, без сборки). В Settings → Environment Variables добавьте `TMDB_TOKEN`. Сделайте Redeploy.

## Маршруты

`/` · `/search?q=` · `/movie/:id` · `/tv/:id` · `/u/:username?tab=overview|diary|reviews|films|series|watchlist|lists` · `/list/:id` · `/shows` · `/login` · `/settings`

## Импорт

* **Letterboxd:** Settings → Data → Export, распакуйте архив и загрузите в настройках сайта `diary.csv`, `ratings.csv`, `watched.csv`, `watchlist.csv`, `reviews.csv`, `likes/films.csv`.
* **JSON:** экспорт первой версии или этого сайта.

## Бесплатные лимиты

Supabase Free — 500 МБ базы, засыпает после недели без запросов (спасает keepalive). Vercel Hobby — только некоммерческое использование. Встроенная почта Supabase — несколько писем в час.
