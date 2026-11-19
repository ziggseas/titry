// «Титры» — дневник фильмов и сериалов. Всё приложение: маршрутизация, экраны, работа с Supabase и TMDB.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import * as U from './util.js';

const { esc } = U;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const S = { user: null, profile: null, myLists: null };
const app = document.getElementById('app');
const header = document.getElementById('header');

// ═════════════ Вспомогательное ═════════════
const tcache = new Map();
function tmdb(path, params = {}) {
  const qs = new URLSearchParams({ path, ...params });
  const key = qs.toString();
  if (tcache.has(key)) return tcache.get(key);
  const p = fetch('/api/tmdb?' + qs).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) throw new Error('Такого фильма или сериала нет на TMDB');
    if (!r.ok) throw new Error(j.error || `TMDB: ошибка ${r.status}`);
    return j;
  });
  tcache.set(key, p);
  p.catch(() => tcache.delete(key));
  return p;
}
const img = (p, size = 'w342') => (U.safePoster(p) ? `https://image.tmdb.org/t/p/${size}${p}` : '');
const q$ = (sel, root = document) => root.querySelector(sel);
const qa = (sel, root = document) => [...root.querySelectorAll(sel)];
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
const nameOf = (p) => (p?.display_name || p?.username || 'Без имени');
const loader = () => '<div class="loader"><span></span><span></span><span></span></div>';
const mediaWord = (m) => (m === 'tv' ? 'Сериал' : 'Фильм');
const tvOrMovieRows = (arr) => (arr || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv');
const isMine = (uid) => S.user && S.user.id === uid;
const startedTv = (e) => e.watched || U.countWatched(e.episodes, []) > 0;

function check(res) {
  if (res.error) throw res.error;
  return res.data;
}

function toast(msg, kind = '') {
  qa('.toast').forEach((x) => x.remove());
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2800);
}

function errText(e) {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return 'Неверная почта или пароль';
  if (/Email not confirmed/i.test(m)) return 'Почта ещё не подтверждена — проверьте письмо';
  if (/User already registered/i.test(m)) return 'Пользователь с такой почтой уже есть';
  if (/Password should be at least/i.test(m)) return 'Пароль слишком короткий (минимум 6 символов)';
  if (/rate limit/i.test(m)) return 'Слишком много попыток — подождите немного';
  if (/duplicate key.*username/i.test(m)) return 'Это имя пользователя уже занято';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Нет связи с сервером';
  return m;
}

function openModal(html) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="modal-x" aria-label="Закрыть">×</button>${html}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('noscroll');
  const close = () => { wrap.remove(); document.body.classList.remove('noscroll'); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  q$('.modal-x', wrap).onclick = close;
  return { el: q$('.modal', wrap), close };
}

function needLogin() {
  if (S.user) return false;
  toast('Войдите, чтобы сохранять');
  go('/login?next=' + encodeURIComponent(location.pathname + location.search));
  return true;
}

// ═════════════ Компоненты ═════════════
function starsInputHTML(v) {
  return `<div class="stars-input" data-value="${v || ''}" role="slider" aria-label="Оценка" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${v || 0}" tabindex="0"><span class="bg">★★★★★</span><span class="fg" style="width:${(v || 0) * 20}%">★★★★★</span></div>`;
}

function bindStars(el, onChange) {
  const fg = q$('.fg', el);
  const show = (v) => { fg.style.width = (v || 0) * 20 + '%'; };
  const set = (v) => { el.dataset.value = v ?? ''; el.setAttribute('aria-valuenow', v || 0); show(v); onChange(v); };
  const valAt = (e) => {
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
    return Math.max(0.5, Math.ceil((x / r.width) * 10) / 2);
  };
  el.addEventListener('mousemove', (e) => show(valAt(e)));
  el.addEventListener('mouseleave', () => show(Number(el.dataset.value) || 0));
  el.addEventListener('click', (e) => { let v = valAt(e); if (Number(el.dataset.value) === v) v = null; set(v); });
  el.addEventListener('keydown', (e) => {
    let v = Number(el.dataset.value) || 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = Math.min(5, v + 0.5);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = Math.max(0, v - 0.5);
    else if (e.key === 'Delete' || e.key === 'Backspace') v = 0;
    else return;
    e.preventDefault();
    set(v || null);
  });
}

function card(m, extra = '') {
  return `<a class="card ${m.media}" href="/${m.media}/${m.tmdb_id}" title="${esc(m.title)}${m.year ? ' (' + m.year + ')' : ''}">
    <div class="poster">${m.poster_path ? `<img loading="lazy" src="${img(m.poster_path)}" alt="">` : `<span class="noposter">${esc(m.title)}</span>`}<span class="badge">${mediaWord(m.media)}</span></div>
    <div class="cap"><span class="t">${esc(m.title)}</span>${m.year ? `<span class="y">${m.year}</span>` : ''}</div>${extra}</a>`;
}

function entryExtra(e) {
  const bits = [];
  if (e.rating) bits.push(`<span class="st">${U.starsText(e.rating)}</span>`);
  if (e.liked) bits.push('<span class="heart">♥</span>');
  if (e.review) bits.push('<span class="rv" title="Есть рецензия">✎</span>');
  if (e.media === 'tv' && e.seasons?.length && !e.watched) {
    const p = U.progress(e.episodes, e.seasons);
    if (p.done) bits.push(`<span class="pg">${p.done}/${p.total}</span>`);
  }
  return bits.length ? `<div class="meta-line">${bits.join('')}</div>` : '';
}

const grid = (items, fn = (m) => card(m)) => (items.length ? `<div class="grid">${items.map(fn).join('')}</div>` : '');
const empty = (text) => `<p class="empty">${text}</p>`;
const bar = (pct, cls = '') => `<div class="bar ${cls}"><i style="width:${pct}%"></i></div>`;
const avatar = (p, size = '') => `<span class="ava ${size}" aria-hidden="true">${esc(nameOf(p).slice(0, 1).toUpperCase())}</span>`;

function histHTML(h, avg, count) {
  const max = Math.max(1, ...h);
  return `<div class="hist">
    <div class="hist-bars">${h.map((c, i) => `<i title="${(i + 1) / 2} — ${c}" style="height:${Math.max(4, (c / max) * 100)}%"></i>`).join('')}</div>
    <div class="hist-legend"><span>½</span><b>${avg ? Number(avg).toFixed(1).replace('.', ',') : '—'}</b><span>★★★★★</span></div>
    <div class="muted small">${count ? `${count} ${U.plural(count, 'оценка', 'оценки', 'оценок')}` : 'Пока нет оценок'}</div>
  </div>`;
}

// ═════════════ Данные ═════════════
async function getMyEntry(media, id) {
  if (!S.user) return null;
  return check(await sb.from('entries').select('*').eq('user_id', S.user.id).eq('media', media).eq('tmdb_id', id).maybeSingle());
}

async function saveEntry(meta, patch) {
  const row = { user_id: S.user.id, media: meta.media, tmdb_id: meta.tmdb_id, title: meta.title, year: meta.year, poster_path: meta.poster_path, ...patch };
  return check(await sb.from('entries').upsert(row, { onConflict: 'user_id,media,tmdb_id' }).select().single());
}

async function myLists(force = false) {
  if (!S.user) return [];
  if (!S.myLists || force) S.myLists = check(await sb.from('lists').select('id,title,is_ranked,updated_at').eq('user_id', S.user.id).order('updated_at', { ascending: false }));
  return S.myLists;
}

async function setUser(user) {
  S.user = user;
  S.myLists = null;
  S.profile = user ? (await sb.from('profiles').select('*').eq('id', user.id).maybeSingle()).data : null;
}

// ═════════════ Маршрутизация ═════════════
let renderSeq = 0;
const routes = [
  [/^\/$/, viewHome],
  [/^\/search$/, viewSearch],
  [/^\/(movie|tv)\/(\d+)$/, (m, q, ctx) => viewTitle(m[1], Number(m[2]), ctx)],
  [/^\/u\/([A-Za-z0-9_]+)$/, (m, q, ctx) => (m[1] !== m[1].toLowerCase() ? go(`/u/${m[1].toLowerCase()}${location.search}`, true) : viewProfile(m[1], q.get('tab') || 'overview', ctx))],
  [/^\/list\/(\d+)$/, (m, q, ctx) => viewList(Number(m[1]), ctx)],
  [/^\/shows$/, (m, q, ctx) => viewShows(ctx)],
  [/^\/login$/, (m, q, ctx) => viewLogin(q, ctx)],
  [/^\/settings$/, (m, q, ctx) => viewSettings(ctx)],
];

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
function go(url, replace = false) {
  if (replace) history.replaceState({ y: 0 }, '', url);
  else {
    history.replaceState({ ...(history.state || {}), y: window.scrollY }, '');
    history.pushState({ y: 0 }, '', url);
  }
  render();
}

async function render(restoreY = null) {
  const seq = ++renderSeq;
  const ctx = { alive: () => seq === renderSeq };
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const q = new URLSearchParams(location.search);
  renderHeader();
  app.innerHTML = loader();
  window.scrollTo(0, 0);
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (!m) continue;
    try {
      await fn(m, q, ctx);
      if (restoreY && ctx.alive()) requestAnimationFrame(() => window.scrollTo(0, restoreY));
    } catch (e) {
      console.error(e);
      if (ctx.alive()) document.title = 'Ошибка — Титры';
      if (ctx.alive()) app.innerHTML = `<section class="page"><div class="error-box"><h2>Что-то пошло не так</h2><p>${esc(errText(e))}</p><a class="btn" href="/">На главную</a></div></section>`;
    }
    return;
  }
  document.title = 'Не найдено — Титры';
  app.innerHTML = '<section class="page"><div class="error-box"><h2>Такой страницы нет</h2><p>Возможно, ссылка устарела.</p><a class="btn" href="/">На главную</a></div></section>';
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.preventDefault();
  if (u.pathname + u.search === location.pathname + location.search && !u.hash) return;
  go(u.pathname + u.search);
});
window.addEventListener('popstate', (e) => render(e.state?.y ?? null));

function renderHeader() {
  const p = S.profile;
  const here = location.pathname;
  const qv = here === '/search' ? new URLSearchParams(location.search).get('q') || '' : '';
  header.innerHTML = `<div class="hdr">
    <a class="logo" href="/"><span class="logo-mark"></span>Титры</a>
    <form class="hsearch" role="search"><input type="search" name="q" placeholder="Фильмы, сериалы, люди…" value="${esc(qv)}" aria-label="Поиск"></form>
    <nav class="nav">
      <a href="/shows" class="${here === '/shows' ? 'on' : ''}">Мои сериалы</a>
      ${p ? `<a href="/u/${p.username}" class="me ${here === '/u/' + p.username ? 'on' : ''}">${avatar(p, 'sm')}<span>${esc(nameOf(p))}</span></a><a href="/settings" class="icon ${here === '/settings' ? 'on' : ''}" title="Настройки" aria-label="Настройки">⚙</a>`
        : S.user ? '<a href="/settings">Профиль</a>' : `<a class="btn sm" href="/login">Войти</a>`}
    </nav></div>`;
  q$('.hsearch', header).onsubmit = (e) => {
    e.preventDefault();
    const v = e.target.q.value.trim();
    if (v) go('/search?q=' + encodeURIComponent(v));
  };
}

// ═════════════ Главная ═════════════
async function viewHome(m, q, ctx) {
  document.title = 'Титры — дневник фильмов и сериалов';
  const trendingP = tmdb('/trending/all/week').then((r) => tvOrMovieRows(r.results).slice(0, 18).map((t) => U.metaFromTmdb(t))).catch(() => []);
  const reviewsP = sb.from('entries').select('media,tmdb_id,title,year,poster_path,rating,liked,review,review_at,profiles(username,display_name)').not('review', 'is', null).order('review_at', { ascending: false, nullsFirst: false }).limit(6).then((r) => r.data || []);
  let feed = [], watching = [];
  if (S.user) {
    const fol = (await sb.from('follows').select('following').eq('follower', S.user.id)).data || [];
    const ids = fol.map((f) => f.following);
    const [feedR, tvR] = await Promise.all([
      ids.length ? sb.from('logs').select('*, profiles(username,display_name)').in('user_id', ids).order('created_at', { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
      sb.from('entries').select('*').eq('user_id', S.user.id).eq('media', 'tv').eq('watched', false).order('updated_at', { ascending: false }).limit(30),
    ]);
    feed = feedR.data || [];
    watching = (tvR.data || []).filter((e) => U.countWatched(e.episodes, e.seasons) > 0).slice(0, 6);
    if (!ctx.alive()) return;
    S.followingCount = ids.length;
  }
  const [trending, reviews] = await Promise.all([trendingP, reviewsP]);
  if (!ctx.alive()) return;

  app.innerHTML = `<section class="page">
    ${S.user ? '' : `<div class="hero">
      <h1>Дневник того, <br>что вы <em class="amber">смотрите</em> — <em class="teal">и досматриваете</em></h1>
      <p>Оценивайте фильмы от ½ до 5 звёзд, отмечайте каждую серию, ведите дневник, пишите рецензии и следите, что смотрят друзья.</p>
      <div class="row gap"><a class="btn" href="/login?mode=signup">Создать аккаунт</a><a class="btn ghost" href="/login">Войти</a></div>
    </div>`}
    ${watching.length ? `<h2 class="sec teal">Смотрю сейчас <a class="more" href="/shows">все сериалы →</a></h2><div class="watching">${watching.map(watchRow).join('')}</div>` : ''}
    ${S.user ? `<h2 class="sec">Лента друзей</h2>${feed.length ? `<div class="feed">${feed.map(feedItem).join('')}</div>` : empty(S.followingCount ? 'Друзья пока ничего не записали в дневник.' : 'Вы ещё ни на кого не подписаны. Найдите друзей через поиск — он ищет и людей.')}` : ''}
    <h2 class="sec">Популярное на неделе</h2>${grid(trending) || empty('TMDB сейчас недоступен.')}
    ${reviews.length ? `<h2 class="sec rose">Свежие рецензии</h2><div class="reviews">${reviews.map((r) => reviewItem(r, true)).join('')}</div>` : ''}
  </section>`;
  bindWatchRows(app, ctx);
}

function feedItem(l) {
  const p = l.profiles || {};
  const verb = l.media === 'tv' ? (l.season ? `посмотрел(а) ${l.season}-й сезон` : 'посмотрел(а) сериал') : (l.rewatch ? 'пересмотрел(а)' : 'посмотрел(а)');
  return `<div class="feed-item">
    <a href="/${l.media}/${l.tmdb_id}" class="thumb">${l.poster_path ? `<img loading="lazy" src="${img(l.poster_path, 'w154')}" alt="">` : ''}</a>
    <div><div><a class="user" href="/u/${esc(p.username)}">${esc(nameOf(p))}</a> ${verb} <a class="ttl ${l.media}" href="/${l.media}/${l.tmdb_id}">${esc(l.title)}</a>${l.year ? ` <span class="muted">${l.year}</span>` : ''}</div>
    <div class="meta-line">${l.rating ? `<span class="st">${U.starsText(l.rating)}</span>` : ''}${l.liked ? '<span class="heart">♥</span>' : ''}<span class="muted small">${U.fmtDate(l.watched_on)} · ${U.ago(l.created_at)}</span></div>
    ${l.note ? `<p class="note">${nl2br(l.note.length > 280 ? l.note.slice(0, 280) + '…' : l.note)}</p>` : ''}</div></div>`;
}

function reviewItem(r, withTitle) {
  const p = r.profiles || {};
  const long = r.review.length > 600;
  return `<article class="review">
    ${withTitle ? `<a href="/${r.media}/${r.tmdb_id}" class="thumb">${r.poster_path ? `<img loading="lazy" src="${img(r.poster_path, 'w154')}" alt="">` : ''}</a>` : ''}
    <div class="review-body">
      ${withTitle ? `<div><a class="ttl ${r.media}" href="/${r.media}/${r.tmdb_id}">${esc(r.title)}</a>${r.year ? ` <span class="muted">${r.year}</span>` : ''}</div>` : ''}
      <div class="meta-line">${avatar(p, 'xs')}<a class="user" href="/u/${esc(p.username)}">${esc(nameOf(p))}</a>${r.rating ? `<span class="st">${U.starsText(r.rating)}</span>` : ''}${r.liked ? '<span class="heart">♥</span>' : ''}${r.review_at ? `<span class="muted small">${U.fmtDate(r.review_at)}</span>` : ''}</div>
      <div class="review-text ${long ? 'clamp' : ''}">${nl2br(r.review)}</div>${long ? '<button class="link more-btn">Читать полностью</button>' : ''}
    </div></article>`;
}

function bindReviewMore(root) {
  qa('.more-btn', root).forEach((b) => (b.onclick = () => { b.previousElementSibling.classList.remove('clamp'); b.remove(); }));
}

// Строка «Смотрю сейчас» с кнопкой +1 серия
function watchRow(e) {
  const p = U.progress(e.episodes, e.seasons);
  const nx = U.nextEpisode(e.episodes, e.seasons);
  return `<div class="watch-row" data-id="${e.tmdb_id}">
    <a href="/tv/${e.tmdb_id}" class="thumb">${e.poster_path ? `<img loading="lazy" src="${img(e.poster_path, 'w154')}" alt="">` : ''}</a>
    <div class="grow"><a class="ttl tv" href="/tv/${e.tmdb_id}">${esc(e.title)}</a>
      <div class="muted small">${p.total ? `${p.done} из ${p.total} ${U.plural(p.total, 'серии', 'серий', 'серий')}` : `${p.done} ${U.plural(p.done, 'серия', 'серии', 'серий')}`}${nx ? ` · дальше ${U.epCode(nx.s, nx.e)}` : ''}</div>
      ${bar(p.pct, 'teal')}</div>
    ${nx ? `<button class="btn sm teal plus1" title="Отметить ${U.epCode(nx.s, nx.e)}">+1 серия</button>` : '<span class="pill teal">досмотрено</span>'}
  </div>`;
}

function bindWatchRows(root, ctx, onChange) {
  qa('.watch-row .plus1', root).forEach((btn) => {
    btn.onclick = async () => {
      const row = btn.closest('.watch-row');
      const id = Number(row.dataset.id);
      btn.disabled = true;
      try {
        const e = await plusOne(id);
        if (!ctx.alive()) return;
        row.outerHTML = watchRow(e);
        bindWatchRows(root, ctx, onChange);
        onChange?.(e);
      } catch (err) { toast(errText(err), 'bad'); btn.disabled = false; }
    };
  });
}

async function plusOne(id) {
  let e = await getMyEntry('tv', id);
  let seasons = U.normSeasons(e?.seasons);
  const tv = await tmdb(`/tv/${id}`);
  const fresh = U.seasonsFromTmdb(tv);
  if (fresh.length) seasons = fresh;
  const nx = U.nextEpisode(e?.episodes, seasons);
  if (!nx) return e;
  const episodes = U.toggleEpisode(e?.episodes, nx.s, nx.e, true);
  const pr = U.progress(episodes, seasons);
  const meta = U.metaFromTmdb(tv, 'tv');
  e = await saveEntry(meta, { episodes, seasons, watched: pr.complete, ...(pr.complete ? {} : { watchlist: false }) });
  toast(`Отмечено: ${U.epCode(nx.s, nx.e)}`);
  return e;
}

// ═════════════ Поиск ═════════════
async function viewSearch(m, q, ctx) {
  const query = (q.get('q') || '').trim();
  document.title = `${query || 'Поиск'} — Титры`;
  if (!query) { app.innerHTML = `<section class="page"><h1 class="h1">Поиск</h1>${empty('Введите название в строке поиска вверху.')}</section>`; return; }
  const safe = query.replace(/[,()%*\\:]/g, ' ').trim();
  const [res, res2, people] = await Promise.all([
    tmdb('/search/multi', { query, include_adult: 'false' }),
    tmdb('/search/multi', { query, include_adult: 'false', page: '2' }).catch(() => ({ results: [] })),
    safe ? sb.from('profiles').select('username,display_name,bio').or(`username.ilike.%${safe}%,display_name.ilike.%${safe}%`).limit(8).then((r) => r.data || []) : Promise.resolve([]),
  ]);
  if (!ctx.alive()) return;
  const seenIds = new Set();
  const items = tvOrMovieRows([...(res.results || []), ...(res2.results || [])]).map((t) => U.metaFromTmdb(t)).filter((t) => { const k = t.media + t.tmdb_id; if (seenIds.has(k)) return false; seenIds.add(k); return true; });
  const movies = items.filter((i) => i.media === 'movie');
  const shows = items.filter((i) => i.media === 'tv');
  app.innerHTML = `<section class="page">
    <h1 class="h1">«${esc(query)}»</h1>
    ${people.length ? `<h2 class="sec">Люди на Титрах</h2><div class="people">${people.map((p) => `<a class="person" href="/u/${esc(p.username)}">${avatar(p)}<span><b>${esc(nameOf(p))}</b><span class="muted small">@${esc(p.username)}</span></span></a>`).join('')}</div>` : ''}
    <div class="tabs" role="tablist">
      <button class="tab on" data-f="all">Всё <span class="muted">${items.length}</span></button>
      <button class="tab amber" data-f="movie">Фильмы <span class="muted">${movies.length}</span></button>
      <button class="tab teal" data-f="tv">Сериалы <span class="muted">${shows.length}</span></button>
    </div>
    <div id="results">${grid(items) || empty('Ничего не найдено. Попробуйте оригинальное название.')}</div>
  </section>`;
  qa('.tab', app).forEach((t) => (t.onclick = () => {
    qa('.tab', app).forEach((x) => x.classList.toggle('on', x === t));
    const f = t.dataset.f;
    const list = f === 'all' ? items : items.filter((i) => i.media === f);
    q$('#results', app).innerHTML = grid(list) || empty('Здесь пусто.');
  }));
}

// ═════════════ Страница тайтла ═════════════
async function viewTitle(media, id, ctx) {
  const append = media === 'tv' ? 'aggregate_credits,recommendations,content_ratings' : 'credits,recommendations,release_dates';
  const [d, entry, stats, reviewsR, myLogsR] = await Promise.all([
    tmdb(`/${media}/${id}`, { append_to_response: append }),
    getMyEntry(media, id),
    sb.rpc('title_stats', { m: media, tid: id }).then((r) => r.data).catch(() => null),
    sb.from('entries').select('user_id,media,tmdb_id,title,rating,liked,review,review_at,profiles(username,display_name)').eq('media', media).eq('tmdb_id', id).not('review', 'is', null).order('review_at', { ascending: false, nullsFirst: false }).limit(30),
    S.user ? sb.from('logs').select('*').eq('user_id', S.user.id).eq('media', media).eq('tmdb_id', id).order('watched_on', { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  if (!ctx.alive()) return;
  const meta = U.metaFromTmdb(d, media);
  const seasons = media === 'tv' ? U.seasonsFromTmdb(d) : [];
  let e = entry;
  let myLogs = myLogsR.data || [];
  const reviews = (reviewsR.data || []);
  document.title = `${meta.title}${meta.year ? ' (' + meta.year + ')' : ''} — Титры`;

  const credits = media === 'tv' ? d.aggregate_credits : d.credits;
  const cast = (credits?.cast || []).slice(0, 14);
  const crewNames = media === 'tv'
    ? (d.created_by || []).map((c) => c.name)
    : (d.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);
  const recs = tvOrMovieRows((d.recommendations?.results || []).map((r) => ({ ...r, media_type: r.media_type || media }))).slice(0, 12).map((t) => U.metaFromTmdb(t));
  const facts = [];
  if (meta.year) facts.push(meta.year);
  if (media === 'movie' && d.runtime) facts.push(`${Math.floor(d.runtime / 60) ? Math.floor(d.runtime / 60) + ' ч ' : ''}${d.runtime % 60} мин`);
  if (media === 'tv') {
    if (d.number_of_seasons) facts.push(`${d.number_of_seasons} ${U.plural(d.number_of_seasons, 'сезон', 'сезона', 'сезонов')}`);
    if (d.number_of_episodes) facts.push(`${d.number_of_episodes} ${U.plural(d.number_of_episodes, 'серия', 'серии', 'серий')}`);
    const st = { 'Returning Series': 'выходит', Ended: 'завершён', Canceled: 'закрыт', 'In Production': 'в производстве', Planned: 'анонсирован' }[d.status];
    if (st) facts.push(st);
  }
  if (d.production_countries?.length) facts.push(d.production_countries.slice(0, 2).map((c) => c.iso_3166_1).join(', '));
  const origTitle = media === 'tv' ? d.original_name : d.original_title;

  app.innerHTML = `<div class="title-page ${media}">
    <div class="backdrop" style="${d.backdrop_path ? `background-image:url('${img(d.backdrop_path, 'w1280')}')` : ''}"></div>
    <section class="page title-grid">
      <aside class="t-side">
        <div class="t-poster">${meta.poster_path ? `<img src="${img(meta.poster_path, 'w500')}" alt="">` : `<span class="noposter">${esc(meta.title)}</span>`}</div>
        <div id="actions"></div>
        <div class="panel">${stats ? histHTML(stats.hist || Array(10).fill(0), stats.avg, stats.ratings) : histHTML(Array(10).fill(0), null, 0)}
          ${stats ? `<div class="mini-stats"><span title="Посмотрели">👁 ${stats.watched}</span><span class="rose" title="Нравится">♥ ${stats.likes}</span><span title="Хотят посмотреть">⏱ ${stats.watchlist}</span></div>` : ''}
          ${d.vote_count ? `<div class="muted small">TMDB: ${(d.vote_average / 2).toFixed(1).replace('.', ',')} из 5 · ${d.vote_count} голосов</div>` : ''}
        </div>
      </aside>
      <div class="t-main">
        <span class="kind ${media}">${mediaWord(media)}</span>
        <h1 class="t-title">${esc(meta.title)}</h1>
        ${origTitle && origTitle !== meta.title ? `<div class="muted">${esc(origTitle)}</div>` : ''}
        <div class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
        ${(d.genres || []).length ? `<div class="chips">${d.genres.map((g) => `<span class="chip">${esc(g.name)}</span>`).join('')}</div>` : ''}
        ${crewNames.length ? `<div class="crew"><span class="muted">${media === 'tv' ? 'Создатели' : 'Режиссёр'}:</span> ${esc(crewNames.join(', '))}</div>` : ''}
        ${d.tagline ? `<p class="tagline">«${esc(d.tagline.trim().replace(/^[«"“„']+|[»"”']+$/g, ''))}»</p>` : ''}
        <p class="overview">${esc(d.overview || 'Описания на русском пока нет.')}</p>
        ${media === 'tv' && seasons.length ? '<div id="tracker"></div>' : ''}
        ${cast.length ? `<h2 class="sec">В ролях</h2><div class="cast">${cast.map((c) => `<div class="actor">${c.profile_path ? `<img loading="lazy" src="${img(c.profile_path, 'w185')}" alt="">` : '<span class="noface"></span>'}<b>${esc(c.name)}</b><span class="muted small">${esc(c.character || c.roles?.[0]?.character || '')}</span></div>`).join('')}</div>` : ''}
        <div id="mylogs"></div>
        <h2 class="sec rose">Рецензии</h2>
        <div id="reviews">${reviews.length ? `<div class="reviews">${reviews.map((r) => reviewItem(r, false)).join('')}</div>` : empty('Рецензий пока нет — напишите первую.')}</div>
        ${recs.length ? `<h2 class="sec">Похожее</h2>${grid(recs)}` : ''}
      </div>
    </section></div>`;
  bindReviewMore(app);

  // ── Панель действий ──
  const actions = q$('#actions', app);
  const renderActions = () => {
    if (!S.user) {
      actions.innerHTML = `<div class="panel center"><p class="muted">Войдите, чтобы оценивать, вести дневник и писать рецензии.</p><a class="btn" href="/login?next=${encodeURIComponent(location.pathname)}">Войти</a></div>`;
      return;
    }
    const w = e?.watched, l = e?.liked, wl = e?.watchlist;
    actions.innerHTML = `<div class="panel actions">
      <div class="act-row">
        <button class="act ${w ? 'on' : ''}" data-a="watched" aria-pressed="${!!w}"><span class="ico">👁</span>${w ? 'Посмотрено' : 'Смотрел'}</button>
        <button class="act like ${l ? 'on' : ''}" data-a="liked" aria-pressed="${!!l}"><span class="ico">♥</span>Нравится</button>
        <button class="act wl ${wl ? 'on' : ''}" data-a="watchlist" aria-pressed="${!!wl}"><span class="ico">⏱</span>Хочу</button>
      </div>
      <div class="rate"><span class="muted small">${e?.rating ? 'Ваша оценка' : 'Оценить'}</span>${starsInputHTML(e?.rating)}</div>
      <button class="btn block" data-a="log">Записать в дневник</button>
      <div class="act-row two"><button class="btn ghost sm" data-a="review">${e?.review ? 'Изменить рецензию' : 'Написать рецензию'}</button><button class="btn ghost sm" data-a="list">В список</button></div>
    </div>`;
    bindStars(q$('.stars-input', actions), async (v) => {
      try {
        const patch = { rating: v };
        if (v && media === 'movie') Object.assign(patch, { watched: true, watchlist: false });
        e = await saveEntry(meta, patch);
        toast(v ? `Оценка: ${U.starsText(v)}` : 'Оценка снята');
        renderActions();
      } catch (err) { toast(errText(err), 'bad'); }
    });
    qa('[data-a]', actions).forEach((b) => (b.onclick = () => act(b.dataset.a, b)));
  };

  const act = async (a, btn) => {
    if (needLogin()) return;
    try {
      if (a === 'watched') {
        const on = !e?.watched;
        const patch = { watched: on };
        if (on) patch.watchlist = false;
        if (on && media === 'tv' && seasons.length) { patch.episodes = seasons.reduce((ep, s) => U.markSeason(ep, s.n, s.eps, true), e?.episodes || {}); patch.seasons = seasons; }
        e = await saveEntry(meta, patch);
        toast(on ? 'Отмечено как просмотренное' : 'Отметка снята');
        renderTracker();
      } else if (a === 'liked') {
        e = await saveEntry(meta, { liked: !e?.liked });
      } else if (a === 'watchlist') {
        e = await saveEntry(meta, { watchlist: !e?.watchlist });
        toast(e.watchlist ? 'Добавлено в «Хочу посмотреть»' : 'Убрано из «Хочу посмотреть»');
      } else if (a === 'log') {
        return openLogModal(meta, seasons, e, myLogs.length > 0, async (log, entryNew) => {
          e = entryNew; myLogs = [log, ...myLogs].sort((x, y) => (x.watched_on < y.watched_on ? 1 : -1));
          renderActions(); renderMyLogs(); renderTracker();
        });
      } else if (a === 'review') {
        return openReviewModal(meta, e, (entryNew) => { e = entryNew; renderActions(); reloadReviews(); });
      } else if (a === 'list') {
        return openAddToList(meta);
      }
      renderActions();
    } catch (err) { toast(errText(err), 'bad'); }
  };

  const reloadReviews = async () => {
    const r = await sb.from('entries').select('user_id,media,tmdb_id,title,rating,liked,review,review_at,profiles(username,display_name)').eq('media', media).eq('tmdb_id', id).not('review', 'is', null).order('review_at', { ascending: false, nullsFirst: false }).limit(30);
    const box = q$('#reviews', app);
    if (!box || !ctx.alive()) return;
    box.innerHTML = r.data?.length ? `<div class="reviews">${r.data.map((x) => reviewItem(x, false)).join('')}</div>` : empty('Рецензий пока нет — напишите первую.');
    bindReviewMore(box);
  };

  const renderMyLogs = () => {
    const box = q$('#mylogs', app);
    if (!box) return;
    if (!myLogs.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<h2 class="sec">Мой дневник</h2><div class="diary compact">${myLogs.map((l) => diaryRow(l, true, false)).join('')}</div>`;
    bindDiaryDelete(box, (lid) => { myLogs = myLogs.filter((x) => x.id !== lid); renderMyLogs(); });
  };

  // ── Трекер серий ──
  const openSeasons = new Set();
  const renderTracker = () => {
    const box = q$('#tracker', app);
    if (!box) return;
    const ep = e?.episodes || {};
    const pr = U.progress(ep, seasons);
    const nx = U.nextEpisode(ep, seasons);
    box.innerHTML = `<div class="tracker panel">
      <div class="tracker-head"><h2 class="sec teal">Серии</h2>
        <div class="grow">${bar(pr.pct, 'teal')}<div class="muted small">${pr.done} из ${pr.total} · ${pr.pct}%${nx ? ` · дальше ${U.epCode(nx.s, nx.e)}` : pr.complete ? ' · досмотрено' : ''}</div></div>
        ${nx ? '<button class="btn sm teal" data-t="plus">+1 серия</button>' : ''}</div>
      ${seasons.map((s) => {
        const got = (ep[String(s.n)] || []).filter((x) => x <= s.eps).length;
        return `<details class="season" data-n="${s.n}" ${openSeasons.has(s.n) ? 'open' : ''}>
          <summary><span class="s-name">Сезон ${s.n}</span><span class="muted small">${got}/${s.eps}</span>${bar(Math.round((got / s.eps) * 100), 'teal thin')}
            <button class="link small" data-t="season" data-n="${s.n}">${got >= s.eps ? 'снять все' : 'отметить сезон'}</button></summary>
          <div class="eps" data-n="${s.n}">${loader()}</div></details>`;
      }).join('')}
    </div>`;
    qa('details.season', box).forEach((det) => {
      const n = Number(det.dataset.n);
      det.addEventListener('toggle', () => {
        if (det.open) { openSeasons.add(n); loadEpisodes(n, q$('.eps', det)); } else openSeasons.delete(n);
      });
      if (det.open) loadEpisodes(n, q$('.eps', det));
    });
    qa('[data-t]', box).forEach((b) => (b.onclick = async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (needLogin()) return;
      try {
        let episodes = e?.episodes || {};
        if (b.dataset.t === 'plus') {
          if (!nx) return;
          episodes = U.toggleEpisode(episodes, nx.s, nx.e, true);
          toast(`Отмечено: ${U.epCode(nx.s, nx.e)}`);
        } else {
          const s = seasons.find((x) => x.n === Number(b.dataset.n));
          const got = (episodes[String(s.n)] || []).filter((x) => x <= s.eps).length;
          episodes = U.markSeason(episodes, s.n, s.eps, got < s.eps);
        }
        await saveEpisodes(episodes);
      } catch (err) { toast(errText(err), 'bad'); }
    }));
  };

  const saveEpisodes = async (episodes) => {
    const pr = U.progress(episodes, seasons);
    const patch = { episodes, seasons, watched: pr.complete };
    if (pr.done) patch.watchlist = false;
    e = await saveEntry(meta, patch);
    renderTracker();
    renderActions();
  };

  const loadEpisodes = async (n, box) => {
    try {
      const season = await tmdb(`/tv/${id}/season/${n}`);
      if (!box.isConnected) return;
      const eps = (season.episodes || []).filter((x) => x.episode_number > 0);
      const today = U.todayISO();
      box.innerHTML = eps.map((x) => {
        const on = U.isEpisodeWatched(e?.episodes, n, x.episode_number);
        const future = x.air_date && x.air_date > today;
        return `<label class="ep ${on ? 'on' : ''} ${future ? 'future' : ''}">
          <input type="checkbox" data-e="${x.episode_number}" ${on ? 'checked' : ''}>
          <span class="code">${U.epCode(n, x.episode_number)}</span>
          <span class="ep-name">${esc(x.name || `Серия ${x.episode_number}`)}</span>
          <span class="muted small">${x.air_date ? U.fmtDate(x.air_date) : ''}${x.runtime ? ` · ${x.runtime} мин` : ''}</span>
          <button class="link small upto" data-e="${x.episode_number}" title="Отметить всё до этой серии">до этой</button></label>`;
      }).join('') || empty('TMDB не знает серий этого сезона.');
      qa('input[type=checkbox]', box).forEach((cb) => (cb.onchange = async () => {
        if (needLogin()) { cb.checked = !cb.checked; return; }
        try { await saveEpisodes(U.toggleEpisode(e?.episodes, n, Number(cb.dataset.e), cb.checked)); } catch (err) { toast(errText(err), 'bad'); cb.checked = !cb.checked; }
      }));
      qa('.upto', box).forEach((b) => (b.onclick = async (ev) => {
        ev.preventDefault();
        if (needLogin()) return;
        try { await saveEpisodes(U.markUpTo(e?.episodes, seasons, n, Number(b.dataset.e))); toast(`Отмечено до ${U.epCode(n, Number(b.dataset.e))}`); } catch (err) { toast(errText(err), 'bad'); }
      }));
    } catch (err) { box.innerHTML = `<p class="muted">${esc(errText(err))}</p>`; }
  };

  renderActions();
  renderMyLogs();
  renderTracker();
}

// ── Модальные окна ──
function openLogModal(meta, seasons, entry, hadLogs, onSaved) {
  const { el, close } = openModal(`<h2>Записать в дневник</h2>
    <p class="muted">${esc(meta.title)}${meta.year ? ' · ' + meta.year : ''}</p>
    <form class="form" id="logf">
      <label>Дата просмотра<input type="date" name="date" value="${U.todayISO()}" max="${U.todayISO()}" required></label>
      ${meta.media === 'tv' && seasons.length ? `<label>Что посмотрели<select name="season"><option value="">Весь сериал</option>${seasons.map((s) => `<option value="${s.n}">Сезон ${s.n}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="markeps" checked> Отметить все серии выбранного</label>` : ''}
      <div class="rate"><span class="muted small">Оценка</span>${starsInputHTML(entry?.rating)}</div>
      <div class="row gap"><label class="check"><input type="checkbox" name="liked" ${entry?.liked ? 'checked' : ''}> <span class="rose">♥</span> Нравится</label>
      <label class="check"><input type="checkbox" name="rewatch" ${hadLogs || entry?.watched ? 'checked' : ''}> Пересмотр</label></div>
      <label>Заметка<textarea name="note" rows="4" maxlength="20000" placeholder="Пара слов о просмотре (необязательно)"></textarea></label>
      <button class="btn block" type="submit">Сохранить</button>
    </form>`);
  let rating = entry?.rating ?? null;
  bindStars(q$('.stars-input', el), (v) => (rating = v));
  q$('#logf', el).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const btn = q$('button[type=submit]', f);
    btn.disabled = true;
    try {
      const season = f.season?.value ? Number(f.season.value) : null;
      const log = check(await sb.from('logs').insert({
        user_id: S.user.id, media: meta.media, tmdb_id: meta.tmdb_id, title: meta.title, year: meta.year, poster_path: meta.poster_path,
        watched_on: f.date.value, rating, liked: f.liked.checked, rewatch: f.rewatch.checked, note: f.note.value.trim() || null, season,
      }).select().single());
      const patch = { rating, watchlist: false };
      if (f.liked.checked) patch.liked = true;
      if (meta.media === 'movie') patch.watched = true;
      if (meta.media === 'tv' && seasons.length && f.markeps?.checked) {
        let ep = entry?.episodes || {};
        for (const s of seasons) if (!season || s.n === season) ep = U.markSeason(ep, s.n, s.eps, true);
        patch.episodes = ep; patch.seasons = seasons;
        patch.watched = U.progress(ep, seasons).complete;
      }
      const e = await saveEntry(meta, patch);
      close();
      toast('Записано в дневник');
      onSaved(log, e);
    } catch (err) { toast(errText(err), 'bad'); btn.disabled = false; }
  };
}

function openReviewModal(meta, entry, onSaved) {
  const { el, close } = openModal(`<h2>Рецензия</h2><p class="muted">${esc(meta.title)}${meta.year ? ' · ' + meta.year : ''}</p>
    <form class="form" id="revf">
      <div class="rate"><span class="muted small">Оценка</span>${starsInputHTML(entry?.rating)}</div>
      <textarea name="review" rows="10" maxlength="20000" placeholder="Что вы думаете?">${esc(entry?.review || '')}</textarea>
      <div class="row gap"><button class="btn" type="submit">Опубликовать</button>${entry?.review ? '<button class="btn ghost danger" type="button" id="delrev">Удалить рецензию</button>' : ''}</div>
    </form>`);
  let rating = entry?.rating ?? null;
  bindStars(q$('.stars-input', el), (v) => (rating = v));
  const save = async (text) => {
    const patch = { review: text || null, review_at: text ? new Date().toISOString() : null, rating };
    if (text && meta.media === 'movie') Object.assign(patch, { watched: true, watchlist: false });
    const e = await saveEntry(meta, patch);
    close();
    toast(text ? 'Рецензия опубликована' : 'Рецензия удалена');
    onSaved(e);
  };
  q$('#revf', el).onsubmit = async (ev) => {
    ev.preventDefault();
    const text = ev.target.review.value.trim();
    if (!text) { toast('Рецензия пустая'); return; }
    try { await save(text); } catch (err) { toast(errText(err), 'bad'); }
  };
  const del = q$('#delrev', el);
  if (del) del.onclick = async () => { if (confirm('Удалить рецензию?')) try { await save(''); } catch (err) { toast(errText(err), 'bad'); } };
}

async function openAddToList(meta) {
  const { el, close } = openModal(`<h2>Добавить в список</h2><p class="muted">${esc(meta.title)}</p><div id="lists-box">${loader()}</div>
    <form class="form row gap" id="newlist"><input name="ltitle" placeholder="Новый список" maxlength="120" required><button class="btn sm" type="submit">Создать</button></form>`);
  const box = q$('#lists-box', el);
  const draw = async (force) => {
    const lists = await myLists(force);
    const ids = lists.map((l) => l.id);
    const have = ids.length ? (await sb.from('list_items').select('list_id').in('list_id', ids).eq('media', meta.media).eq('tmdb_id', meta.tmdb_id)).data || [] : [];
    const inSet = new Set(have.map((h) => h.list_id));
    box.innerHTML = lists.length ? `<div class="pick-lists">${lists.map((l) => `<button class="pick ${inSet.has(l.id) ? 'on' : ''}" data-id="${l.id}">${inSet.has(l.id) ? '✓ ' : '+ '}${esc(l.title)}</button>`).join('')}</div>` : empty('У вас пока нет списков.');
    qa('.pick', box).forEach((b) => (b.onclick = async () => {
      const lid = Number(b.dataset.id);
      b.disabled = true;
      try {
        if (inSet.has(lid)) { check(await sb.from('list_items').delete().eq('list_id', lid).eq('media', meta.media).eq('tmdb_id', meta.tmdb_id)); toast('Убрано из списка'); }
        else { await addToList(lid, meta); toast('Добавлено в список'); }
        await draw(false);
      } catch (err) { toast(errText(err), 'bad'); b.disabled = false; }
    }));
  };
  q$('#newlist', el).onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const l = check(await sb.from('lists').insert({ user_id: S.user.id, title: ev.target.ltitle.value.trim() }).select().single());
      await addToList(l.id, meta);
      ev.target.reset();
      toast('Список создан');
      await draw(true);
    } catch (err) { toast(errText(err), 'bad'); }
  };
  try { await draw(false); } catch (err) { box.innerHTML = `<p class="muted">${esc(errText(err))}</p>`; }
  return close;
}

async function addToList(lid, meta) {
  const last = (await sb.from('list_items').select('position').eq('list_id', lid).order('position', { ascending: false }).limit(1)).data?.[0];
  check(await sb.from('list_items').upsert({ list_id: lid, media: meta.media, tmdb_id: meta.tmdb_id, title: meta.title, year: meta.year, poster_path: meta.poster_path, position: (last?.position ?? -1) + 1 }, { onConflict: 'list_id,media,tmdb_id' }));
  await sb.from('lists').update({ updated_at: new Date().toISOString() }).eq('id', lid);
}

// ═════════════ Дневник (строки) ═════════════
function diaryRow(l, own, withTitle = true) {
  const day = String(l.watched_on).slice(8, 10);
  return `<div class="d-row" data-id="${l.id}">
    <span class="d-day">${Number(day)}</span>
    ${withTitle ? `<a class="thumb xs" href="/${l.media}/${l.tmdb_id}">${l.poster_path ? `<img loading="lazy" src="${img(l.poster_path, 'w92')}" alt="">` : ''}</a>
    <div class="d-title"><a class="ttl ${l.media}" href="/${l.media}/${l.tmdb_id}">${esc(l.title)}</a>${l.year ? ` <span class="muted">${l.year}</span>` : ''}${l.season ? ` <span class="pill teal">сезон ${l.season}</span>` : ''}</div>`
      : `<div class="d-title">${U.fmtDate(l.watched_on)}${l.season ? ` <span class="pill teal">сезон ${l.season}</span>` : ''}</div>`}
    <span class="st">${U.starsText(l.rating)}</span>
    <span class="heart">${l.liked ? '♥' : ''}</span>
    <span class="rw" title="${l.rewatch ? 'Пересмотр' : ''}">${l.rewatch ? '↻' : ''}</span>
    ${own ? '<button class="link small del" title="Удалить запись">✕</button>' : '<span></span>'}
    ${l.note ? `<p class="d-note">${nl2br(l.note)}</p>` : ''}
  </div>`;
}

function bindDiaryDelete(root, onDone) {
  qa('.d-row .del', root).forEach((b) => (b.onclick = async () => {
    if (!confirm('Удалить запись из дневника?')) return;
    const id = Number(b.closest('.d-row').dataset.id);
    try { check(await sb.from('logs').delete().eq('id', id)); toast('Запись удалена'); onDone(id); } catch (err) { toast(errText(err), 'bad'); }
  }));
}

// ═════════════ Профиль ═════════════
const TABS = [['overview', 'Обзор'], ['diary', 'Дневник'], ['reviews', 'Рецензии'], ['films', 'Фильмы'], ['series', 'Сериалы'], ['watchlist', 'Хочу посмотреть'], ['lists', 'Списки']];

async function viewProfile(username, tab, ctx) {
  if (!TABS.some(([k]) => k === tab)) tab = 'overview';
  const prof = check(await sb.from('profiles').select('*').eq('username', username).maybeSingle());
  if (!ctx.alive()) return;
  if (!prof) { document.title = 'Не найдено — Титры'; app.innerHTML = `<section class="page"><div class="error-box"><h2>Пользователь @${esc(username)} не найден</h2><a class="btn" href="/">На главную</a></div></section>`; return; }
  document.title = `${nameOf(prof)} — Титры`;
  const me = isMine(prof.id);
  const uid = prof.id;
  const cnt = (q) => q.then((r) => r.count || 0);
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const [films, series, thisYear, followers, following, iFollow] = await Promise.all([
    cnt(sb.from('entries').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('media', 'movie').eq('watched', true)),
    sb.from('entries').select('watched,episodes').eq('user_id', uid).eq('media', 'tv').limit(5000).then((r) => (r.data || []).filter(startedTv).length),
    cnt(sb.from('logs').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('watched_on', yearStart)),
    cnt(sb.from('follows').select('follower', { count: 'exact', head: true }).eq('following', uid)),
    cnt(sb.from('follows').select('following', { count: 'exact', head: true }).eq('follower', uid)),
    S.user && !me ? sb.from('follows').select('following').eq('follower', S.user.id).eq('following', uid).maybeSingle().then((r) => !!r.data) : Promise.resolve(false),
  ]);
  if (!ctx.alive()) return;
  const locked = prof.is_private && !me;
  app.innerHTML = `<section class="page">
    <div class="profile-head">
      ${avatar(prof, 'lg')}
      <div class="grow"><h1 class="h1">${esc(nameOf(prof))} ${prof.is_private ? '<span class="pill" title="Закрытый профиль">🔒 закрытый</span>' : ''}</h1>
        <div class="muted">@${esc(prof.username)}</div>
        ${prof.bio ? `<p class="bio">${nl2br(prof.bio)}</p>` : ''}</div>
      <div class="p-stats">
        <div><b class="amber">${films}</b><span>фильмов</span></div><div><b class="teal">${series}</b><span>сериалов</span></div>
        <div><b>${thisYear}</b><span>в ${new Date().getFullYear()}</span></div>
        <a href="#" data-f="followers"><b>${followers}</b><span>подписчиков</span></a><a href="#" data-f="following"><b>${following}</b><span>подписок</span></a>
      </div>
      ${me ? '<a class="btn ghost sm" href="/settings">Редактировать</a>' : S.user ? `<button class="btn sm ${iFollow ? 'ghost' : ''}" id="follow">${iFollow ? 'Вы подписаны' : 'Подписаться'}</button>` : ''}
    </div>
    <nav class="tabs">${TABS.map(([k, t]) => `<a class="tab ${k === tab ? 'on' : ''}" href="/u/${prof.username}${k === 'overview' ? '' : '?tab=' + k}">${t}</a>`).join('')}</nav>
    <div id="tab">${locked ? '<div class="error-box"><h2>🔒 Профиль закрыт</h2><p>Владелец скрыл свой дневник и оценки.</p></div>' : loader()}</div>
  </section>`;
  const fb = q$('#follow', app);
  if (fb) {
    let on = iFollow;
    fb.onclick = async () => {
      fb.disabled = true;
      try {
        if (on) check(await sb.from('follows').delete().eq('follower', S.user.id).eq('following', uid));
        else check(await sb.from('follows').insert({ follower: S.user.id, following: uid }));
        on = !on;
        fb.textContent = on ? 'Вы подписаны' : 'Подписаться';
        fb.classList.toggle('ghost', on);
      } catch (err) { toast(errText(err), 'bad'); }
      fb.disabled = false;
    };
  }
  qa('[data-f]', app).forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); openFollows(uid, a.dataset.f); }));
  if (locked) return;
  const box = q$('#tab', app);
  const renderers = { overview: tabOverview, diary: tabDiary, reviews: tabReviews, films: tabFilms, series: tabSeries, watchlist: tabWatchlist, lists: tabLists };
  await renderers[tab](box, prof, me, ctx);
}

async function openFollows(uid, kind) {
  const { el } = openModal(`<h2>${kind === 'followers' ? 'Подписчики' : 'Подписки'}</h2><div id="fl">${loader()}</div>`);
  const col = kind === 'followers' ? 'follower' : 'following';
  const other = kind === 'followers' ? 'following' : 'follower';
  try {
    const rows = check(await sb.from('follows').select(col).eq(other, uid).limit(200));
    const ids = rows.map((r) => r[col]);
    const people = ids.length ? check(await sb.from('profiles').select('username,display_name').in('id', ids)) : [];
    q$('#fl', el).innerHTML = people.length ? `<div class="people col">${people.map((p) => `<a class="person" href="/u/${esc(p.username)}">${avatar(p)}<span><b>${esc(nameOf(p))}</b><span class="muted small">@${esc(p.username)}</span></span></a>`).join('')}</div>` : empty('Пока никого.');
    qa('a', el).forEach((a) => a.addEventListener('click', () => q$('.modal-x', el).click()));
  } catch (err) { q$('#fl', el).innerHTML = esc(errText(err)); }
}

async function tabOverview(box, prof, me, ctx) {
  const uid = prof.id;
  const [liked, recent, ratings, tv] = await Promise.all([
    sb.from('entries').select('*').eq('user_id', uid).eq('liked', true).order('updated_at', { ascending: false }).limit(12).then((r) => r.data || []),
    sb.from('logs').select('*').eq('user_id', uid).order('watched_on', { ascending: false }).order('id', { ascending: false }).limit(12).then((r) => r.data || []),
    sb.from('entries').select('rating').eq('user_id', uid).not('rating', 'is', null).limit(5000).then((r) => r.data || []),
    sb.from('entries').select('*').eq('user_id', uid).eq('media', 'tv').eq('watched', false).order('updated_at', { ascending: false }).limit(30).then((r) => r.data || []),
  ]);
  if (!ctx.alive()) return;
  const watching = tv.filter((e) => U.countWatched(e.episodes, e.seasons) > 0).slice(0, 6);
  const rs = ratings.map((r) => Number(r.rating));
  const avg = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  box.innerHTML = `<div class="ov-grid">
    <div class="ov-main">
      ${watching.length ? `<h2 class="sec teal">Смотрит сейчас</h2><div class="watching">${watching.map((e) => me ? watchRow(e) : watchRow(e).replace(/<button[^>]*plus1[^>]*>[^<]*<\/button>/, '')).join('')}</div>` : ''}
      <h2 class="sec">Недавно в дневнике</h2>${recent.length ? grid(recent, (l) => card(l, entryExtra(l))) : empty(me ? 'Дневник пуст. Откройте любой фильм и нажмите «Записать в дневник».' : 'Дневник пуст.')}
      <h2 class="sec rose">Любимое</h2>${liked.length ? grid(liked, (e) => card(e, entryExtra(e))) : empty('Пока ничего не отмечено сердечком.')}
    </div>
    <aside class="ov-side"><div class="panel"><h3 class="small-h">Оценки</h3>${histHTML(U.histogram(rs), avg, rs.length)}</div></aside>
  </div>`;
  if (me) bindWatchRows(box, ctx);
}

async function tabDiary(box, prof, me, ctx) {
  const logs = check(await sb.from('logs').select('*').eq('user_id', prof.id).order('watched_on', { ascending: false }).order('id', { ascending: false }).limit(1000));
  if (!ctx.alive()) return;
  const draw = (list) => {
    box.innerHTML = list.length ? U.groupByMonth(list).map((g) => `<h3 class="month">${g.label}</h3><div class="diary">${g.items.map((l) => diaryRow(l, me)).join('')}</div>`).join('') : empty(me ? 'Дневник пуст. Откройте фильм или сериал и нажмите «Записать в дневник».' : 'Дневник пуст.');
    if (me) bindDiaryDelete(box, (id) => draw((list = list.filter((x) => x.id !== id))));
  };
  draw(logs);
}

async function tabReviews(box, prof, me, ctx) {
  const rows = check(await sb.from('entries').select('*, profiles(username,display_name)').eq('user_id', prof.id).not('review', 'is', null).order('review_at', { ascending: false, nullsFirst: false }).limit(200));
  if (!ctx.alive()) return;
  box.innerHTML = rows.length ? `<div class="reviews">${rows.map((r) => reviewItem(r, true)).join('')}</div>` : empty('Рецензий пока нет.');
  bindReviewMore(box);
}

function sortBar(current) {
  const opts = [['recent', 'Недавние'], ['rating', 'По оценке'], ['title', 'По названию'], ['year', 'По году']];
  return `<div class="sortbar"><span class="muted small">Сортировка:</span>${opts.map(([k, t]) => `<button class="chip ${k === current ? 'on' : ''}" data-s="${k}">${t}</button>`).join('')}</div>`;
}
function sortEntries(list, by) {
  const a = [...list];
  if (by === 'rating') a.sort((x, y) => (Number(y.rating) || 0) - (Number(x.rating) || 0));
  else if (by === 'title') a.sort((x, y) => x.title.localeCompare(y.title, 'ru'));
  else if (by === 'year') a.sort((x, y) => (y.year || 0) - (x.year || 0));
  return a;
}
function sortedGrid(box, list, emptyText, extra = entryExtra) {
  let by = 'recent';
  const draw = () => {
    box.innerHTML = list.length ? `${sortBar(by)}<p class="muted small">${list.length} ${U.plural(list.length, 'тайтл', 'тайтла', 'тайтлов')}</p>${grid(sortEntries(list, by), (e) => card(e, extra(e)))}` : empty(emptyText);
    qa('[data-s]', box).forEach((b) => (b.onclick = () => { by = b.dataset.s; draw(); }));
  };
  draw();
}

async function tabFilms(box, prof, me, ctx) {
  const rows = check(await sb.from('entries').select('*').eq('user_id', prof.id).eq('media', 'movie').eq('watched', true).order('updated_at', { ascending: false }).limit(5000));
  if (ctx.alive()) sortedGrid(box, rows, 'Просмотренных фильмов пока нет.');
}

async function tabSeries(box, prof, me, ctx) {
  const rows = check(await sb.from('entries').select('*').eq('user_id', prof.id).eq('media', 'tv').order('updated_at', { ascending: false }).limit(5000));
  if (ctx.alive()) sortedGrid(box, rows.filter(startedTv), 'Сериалов пока нет.');
}

async function tabWatchlist(box, prof, me, ctx) {
  const rows = check(await sb.from('entries').select('*').eq('user_id', prof.id).eq('watchlist', true).order('updated_at', { ascending: false }).limit(5000));
  if (ctx.alive()) sortedGrid(box, rows, me ? 'Список пуст. Нажмите «Хочу» на странице фильма.' : 'Список пуст.', () => '');
}

async function tabLists(box, prof, me, ctx) {
  const lists = check(await sb.from('lists').select('*, list_items(poster_path, position)').eq('user_id', prof.id).order('updated_at', { ascending: false }));
  if (!ctx.alive()) return;
  box.innerHTML = `${me ? `<form class="form row gap newlist" id="nl"><input name="ltitle" placeholder="Название нового списка" maxlength="120" required><button class="btn sm" type="submit">Создать список</button></form>` : ''}
    ${lists.length ? `<div class="lists">${lists.map(listCard).join('')}</div>` : empty('Списков пока нет.')}`;
  const f = q$('#nl', box);
  if (f) f.onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const l = check(await sb.from('lists').insert({ user_id: S.user.id, title: f.ltitle.value.trim() }).select().single());
      S.myLists = null;
      go('/list/' + l.id);
    } catch (err) { toast(errText(err), 'bad'); }
  };
}

function listCard(l) {
  const items = [...(l.list_items || [])].sort((a, b) => a.position - b.position);
  const posters = items.slice(0, 5);
  return `<a class="list-card" href="/list/${l.id}">
    <div class="stack">${posters.map((p) => (p.poster_path ? `<img loading="lazy" src="${img(p.poster_path, 'w154')}" alt="">` : '<span class="ph"></span>')).join('') || '<span class="ph"></span>'}</div>
    <b>${esc(l.title)}</b><span class="muted small">${items.length} ${U.plural(items.length, 'тайтл', 'тайтла', 'тайтлов')}${l.is_ranked ? ' · рейтинг' : ''}</span>
    ${l.description ? `<span class="muted small clamp2">${esc(l.description)}</span>` : ''}</a>`;
}

// ═════════════ Список ═════════════
async function viewList(id, ctx) {
  const list = check(await sb.from('lists').select('*, profiles(username,display_name)').eq('id', id).maybeSingle());
  if (!ctx.alive()) return;
  if (!list) { document.title = 'Не найдено — Титры'; app.innerHTML = '<section class="page"><div class="error-box"><h2>Список не найден или скрыт</h2><a class="btn" href="/">На главную</a></div></section>'; return; }
  let items = check(await sb.from('list_items').select('*').eq('list_id', id).order('position').order('id'));
  if (!ctx.alive()) return;
  document.title = `${list.title} — Титры`;
  const own = isMine(list.user_id);
  const p = list.profiles || {};
  app.innerHTML = `<section class="page">
    <div class="list-head"><div class="muted small">Список · <a class="user" href="/u/${esc(p.username)}">${esc(nameOf(p))}</a></div>
      <h1 class="h1" id="lt">${esc(list.title)}</h1>${list.description ? `<p class="bio">${nl2br(list.description)}</p>` : ''}
      ${own ? '<div class="row gap"><button class="btn ghost sm" id="edit">Редактировать</button><button class="btn ghost sm danger" id="dellist">Удалить список</button></div>' : ''}</div>
    ${own ? `<div class="panel add-to-list"><input id="addq" type="search" placeholder="Добавить фильм или сериал…" autocomplete="off"><div id="addres"></div></div>` : ''}
    <div id="items"></div></section>`;
  const drawItems = () => {
    const ib = q$('#items', app);
    if (!items.length) { ib.innerHTML = empty(own ? 'Список пуст — найдите тайтлы через поле выше.' : 'Список пуст.'); return; }
    ib.innerHTML = list.is_ranked || own ? `<div class="ranked">${items.map((it, i) => `<div class="r-row" data-id="${it.id}">
        ${list.is_ranked ? `<span class="r-num">${i + 1}</span>` : ''}
        <a class="thumb xs" href="/${it.media}/${it.tmdb_id}">${it.poster_path ? `<img loading="lazy" src="${img(it.poster_path, 'w92')}" alt="">` : ''}</a>
        <div class="grow"><a class="ttl ${it.media}" href="/${it.media}/${it.tmdb_id}">${esc(it.title)}</a>${it.year ? ` <span class="muted">${it.year}</span>` : ''} <span class="pill ${it.media === 'tv' ? 'teal' : 'amber'}">${mediaWord(it.media)}</span></div>
        ${own ? `<button class="link up" title="Выше" ${i === 0 ? 'disabled' : ''}>↑</button><button class="link down" title="Ниже" ${i === items.length - 1 ? 'disabled' : ''}>↓</button><button class="link rm" title="Убрать">✕</button>` : ''}
      </div>`).join('')}</div>` : grid(items);
    if (!own) return;
    qa('.r-row', ib).forEach((row) => {
      const iid = Number(row.dataset.id);
      const idx = items.findIndex((x) => x.id === iid);
      const move = async (dir) => {
        const j = idx + dir;
        if (j < 0 || j >= items.length) return;
        [items[idx], items[j]] = [items[j], items[idx]];
        drawItems();
        try {
          await Promise.all(items.map((it, k) => (it.position !== k ? sb.from('list_items').update({ position: k }).eq('id', it.id).then(check) : null)));
          items.forEach((it, k) => (it.position = k));
        } catch (err) { toast(errText(err), 'bad'); }
      };
      q$('.up', row).onclick = () => move(-1);
      q$('.down', row).onclick = () => move(1);
      q$('.rm', row).onclick = async () => {
        try { check(await sb.from('list_items').delete().eq('id', iid)); items = items.filter((x) => x.id !== iid); drawItems(); } catch (err) { toast(errText(err), 'bad'); }
      };
    });
  };
  drawItems();
  if (!own) return;

  const addq = q$('#addq', app), addres = q$('#addres', app);
  let t = null;
  addq.oninput = () => {
    clearTimeout(t);
    const v = addq.value.trim();
    if (v.length < 2) { addres.innerHTML = ''; return; }
    t = setTimeout(async () => {
      try {
        const r = await tmdb('/search/multi', { query: v, include_adult: 'false' });
        if (addq.value.trim() !== v) return;
        const found = tvOrMovieRows(r.results).slice(0, 8).map((x) => U.metaFromTmdb(x));
        addres.innerHTML = found.map((f, i) => `<button class="add-row" data-i="${i}">${f.poster_path ? `<img src="${img(f.poster_path, 'w92')}" alt="">` : '<span class="ph"></span>'}<span><b>${esc(f.title)}</b> <span class="muted">${f.year || ''} · ${mediaWord(f.media)}</span></span></button>`).join('') || '<p class="muted small">Ничего не найдено</p>';
        qa('.add-row', addres).forEach((b) => (b.onclick = async () => {
          const f = found[Number(b.dataset.i)];
          try {
            await addToList(id, f);
            items = check(await sb.from('list_items').select('*').eq('list_id', id).order('position').order('id'));
            addq.value = ''; addres.innerHTML = '';
            drawItems();
            toast('Добавлено');
          } catch (err) { toast(errText(err), 'bad'); }
        }));
      } catch (err) { addres.innerHTML = `<p class="muted small">${esc(errText(err))}</p>`; }
    }, 300);
  };

  q$('#edit', app).onclick = () => {
    const { el, close } = openModal(`<h2>Список</h2><form class="form" id="lf">
      <label>Название<input name="ltitle" maxlength="120" required value="${esc(list.title)}"></label>
      <label>Описание<textarea name="description" rows="4" maxlength="2000">${esc(list.description || '')}</textarea></label>
      <label class="check"><input type="checkbox" name="is_ranked" ${list.is_ranked ? 'checked' : ''}> Нумерованный рейтинг</label>
      <button class="btn" type="submit">Сохранить</button></form>`);
    q$('#lf', el).onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      try {
        check(await sb.from('lists').update({ title: f.ltitle.value.trim(), description: f.description.value.trim() || null, is_ranked: f.is_ranked.checked }).eq('id', id));
        S.myLists = null;
        close();
        go(location.pathname, true);
      } catch (err) { toast(errText(err), 'bad'); }
    };
  };
  q$('#dellist', app).onclick = async () => {
    if (!confirm(`Удалить список «${list.title}»?`)) return;
    try { check(await sb.from('lists').delete().eq('id', id)); S.myLists = null; toast('Список удалён'); go(`/u/${S.profile.username}?tab=lists`); } catch (err) { toast(errText(err), 'bad'); }
  };
}

// ═════════════ Мои сериалы ═════════════
async function viewShows(ctx) {
  document.title = 'Мои сериалы — Титры';
  if (!S.user) {
    app.innerHTML = `<section class="page"><h1 class="h1 teal">Мои сериалы</h1><div class="error-box"><p>Здесь будут сериалы, которые вы смотрите, с прогрессом по сериям и кнопкой «+1 серия».</p><a class="btn" href="/login?next=/shows">Войти</a></div></section>`;
    return;
  }
  const rows = check(await sb.from('entries').select('*').eq('user_id', S.user.id).eq('media', 'tv').order('updated_at', { ascending: false }).limit(1000));
  if (!ctx.alive()) return;
  const draw = () => {
    const watching = [], planned = [], done = [];
    for (const e of rows) {
      const pr = U.progress(e.episodes, e.seasons);
      if (e.watched || pr.complete) done.push(e);
      else if (pr.done > 0) watching.push(e);
      else if (e.watchlist) planned.push(e);
    }
    app.innerHTML = `<section class="page">
      <h1 class="h1"><span class="teal">Мои сериалы</span></h1>
      <h2 class="sec teal">Смотрю <span class="muted">${watching.length}</span></h2>${watching.length ? `<div class="watching">${watching.map(watchRow).join('')}</div>` : empty('Отметьте первую серию на странице сериала — он появится здесь.')}
      <h2 class="sec">В планах <span class="muted">${planned.length}</span></h2>${grid(planned) || empty('Добавляйте сериалы кнопкой «Хочу».')}
      <h2 class="sec">Досмотрено <span class="muted">${done.length}</span></h2>${grid(done, (e) => card(e, entryExtra(e))) || empty('Пока ничего.')}
    </section>`;
    bindWatchRows(app, ctx, (e) => {
      const i = rows.findIndex((x) => x.tmdb_id === e.tmdb_id);
      if (i >= 0) rows[i] = e;
      if (e.watched) draw();
    });
  };
  draw();
}

// ═════════════ Вход ═════════════
async function viewLogin(q, ctx) {
  const next = q.get('next') && q.get('next').startsWith('/') && !q.get('next').startsWith('//') ? q.get('next') : null;
  if (S.user) { go(next || (S.profile ? `/u/${S.profile.username}` : '/'), true); return; }
  let mode = q.get('mode') === 'signup' ? 'signup' : q.get('mode') === 'reset' ? 'reset' : 'login';
  const draw = () => {
    document.title = (mode === 'signup' ? 'Регистрация' : mode === 'reset' ? 'Восстановление пароля' : 'Вход') + ' — Титры';
    app.innerHTML = `<section class="page narrow"><div class="auth panel">
      <div class="tabs"><button class="tab ${mode === 'login' ? 'on' : ''}" data-m="login">Вход</button><button class="tab ${mode === 'signup' ? 'on' : ''}" data-m="signup">Регистрация</button></div>
      <form class="form" id="af">
        ${mode === 'signup' ? `<label>Имя пользователя<input name="username" required pattern="[a-z0-9_]{3,24}" maxlength="24" placeholder="kinoman_42" autocomplete="username"><span class="hint">3–24 символа: латиница в нижнем регистре, цифры, _</span></label>
          <label>Как вас называть<input name="display_name" maxlength="60" placeholder="Аня"></label>` : ''}
        <label>Почта<input type="email" name="email" required autocomplete="email"></label>
        ${mode !== 'reset' ? `<label>Пароль<input type="password" name="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>` : ''}
        <button class="btn block" type="submit">${mode === 'signup' ? 'Создать аккаунт' : mode === 'reset' ? 'Прислать ссылку' : 'Войти'}</button>
        ${mode === 'login' ? '<button class="link small" type="button" id="forgot">Забыли пароль?</button>' : ''}
        ${mode === 'reset' ? '<button class="link small" type="button" data-m="login">← Назад ко входу</button>' : ''}
        <div id="amsg"></div>
      </form></div></section>`;
    qa('[data-m]', app).forEach((b) => (b.onclick = () => { mode = b.dataset.m; draw(); }));
    const fg = q$('#forgot', app);
    if (fg) fg.onclick = () => { mode = 'reset'; draw(); };
    q$('#af', app).onsubmit = submit;
  };
  const msg = (t, kind = '') => { q$('#amsg', app).innerHTML = `<p class="amsg ${kind}">${t}</p>`; };
  const submit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const btn = q$('button[type=submit]', f);
    btn.disabled = true;
    try {
      const email = f.email.value.trim();
      if (mode === 'login') {
        check(await sb.auth.signInWithPassword({ email, password: f.password.value }));
        await setUser((await sb.auth.getUser()).data.user);
        go(next || (S.profile ? `/u/${S.profile.username}` : '/'), true);
        return;
      }
      if (mode === 'reset') {
        check(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/settings?reset=1' }));
        msg('Если такая почта зарегистрирована, на неё пришла ссылка для смены пароля.', 'ok');
        return;
      }
      const username = f.username.value.trim().toLowerCase();
      if (!U.validUsername(username)) throw new Error('Имя пользователя: 3–24 символа, латиница, цифры и _');
      const taken = (await sb.from('profiles').select('id').eq('username', username).maybeSingle()).data;
      if (taken) throw new Error('Это имя пользователя уже занято');
      const r = check(await sb.auth.signUp({ email, password: f.password.value, options: { data: { username, display_name: f.display_name.value.trim() }, emailRedirectTo: location.origin + '/' } }));
      if (r.session) {
        await setUser(r.user);
        toast('Добро пожаловать!');
        go(next || '/', true);
      } else {
        msg(`Почти готово! Мы отправили письмо на <b>${esc(email)}</b> — перейдите по ссылке, чтобы подтвердить почту.`, 'ok');
        f.reset();
      }
    } catch (err) { msg(esc(errText(err)), 'bad'); }
    finally { if (btn.isConnected) btn.disabled = false; }
  };
  draw();
}

// ═════════════ Настройки ═════════════
async function viewSettings(ctx) {
  document.title = 'Настройки — Титры';
  if (!S.user) { go('/login?next=/settings', true); return; }
  if (!S.profile) await setUser(S.user);
  const p = S.profile || {};
  const resetMode = new URLSearchParams(location.search).has('reset');
  app.innerHTML = `<section class="page narrow">
    <h1 class="h1">Настройки</h1>
    ${resetMode ? '<div class="panel notice">Задайте новый пароль ниже.</div>' : ''}
    <div class="panel"><h2 class="small-h">Профиль</h2>
      <form class="form" id="pf">
        <label>Имя пользователя<input name="username" required pattern="[a-z0-9_]{3,24}" maxlength="24" value="${esc(p.username || '')}"><span class="hint">Адрес профиля: ${esc(location.origin)}/u/<b>${esc(p.username || '')}</b></span></label>
        <label>Как вас называть<input name="display_name" maxlength="60" value="${esc(p.display_name || '')}"></label>
        <label>О себе<textarea name="bio" rows="3" maxlength="500">${esc(p.bio || '')}</textarea></label>
        <label class="check"><input type="checkbox" name="is_private" ${p.is_private ? 'checked' : ''}> 🔒 Закрытый профиль — дневник, оценки и списки видны только мне</label>
        <button class="btn" type="submit">Сохранить</button>
      </form></div>
    <div class="panel"><h2 class="small-h">Пароль</h2>
      <form class="form row gap" id="pwf"><input type="password" name="pw" minlength="6" required placeholder="Новый пароль" autocomplete="new-password"><button class="btn sm" type="submit">Сменить</button></form>
      <p class="muted small">Почта: ${esc(S.user.email || '')}</p></div>
    <div class="panel"><h2 class="small-h">Импорт</h2>
      <p class="muted small">Letterboxd: в настройках Letterboxd → Data → Export, распакуйте архив и выберите файлы <b>diary.csv</b>, <b>ratings.csv</b>, <b>watched.csv</b>, <b>watchlist.csv</b>, <b>reviews.csv</b>, <b>likes/films.csv</b> (можно сразу несколько). Каждый фильм ищется на TMDB по названию и году.</p>
      <label class="file btn ghost sm">Файлы Letterboxd (.csv)<input type="file" id="lbx" accept=".csv,text/csv" multiple hidden></label>
      <p class="muted small">JSON: экспорт первой версии «Титров» или этого сайта.</p>
      <label class="file btn ghost sm">Файл JSON<input type="file" id="jsn" accept=".json,application/json" hidden></label>
      <div id="imp"></div></div>
    <div class="panel"><h2 class="small-h">Экспорт</h2><p class="muted small">Все записи, дневник и списки одним JSON-файлом.</p><button class="btn ghost sm" id="exp">Скачать JSON</button></div>
    <div class="panel"><button class="btn ghost danger" id="out">Выйти из аккаунта</button></div>
  </section>`;

  q$('#pf', app).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const username = f.username.value.trim().toLowerCase();
    try {
      if (!U.validUsername(username)) throw new Error('Имя пользователя: 3–24 символа, латиница, цифры и _');
      S.profile = check(await sb.from('profiles').update({ username, display_name: f.display_name.value.trim() || null, bio: f.bio.value.trim() || null, is_private: f.is_private.checked }).eq('id', S.user.id).select().single());
      renderHeader();
      toast('Сохранено');
    } catch (err) { toast(errText(err), 'bad'); }
  };
  q$('#pwf', app).onsubmit = async (ev) => {
    ev.preventDefault();
    try { check(await sb.auth.updateUser({ password: ev.target.pw.value })); ev.target.reset(); toast('Пароль изменён'); } catch (err) { toast(errText(err), 'bad'); }
  };
  q$('#out', app).onclick = async () => { await sb.auth.signOut(); await setUser(null); go('/', true); };
  q$('#exp', app).onclick = exportJSON;
  const imp = q$('#imp', app);
  q$('#lbx', app).onchange = (ev) => importLetterboxd([...ev.target.files], imp).finally(() => (ev.target.value = ''));
  q$('#jsn', app).onchange = (ev) => importJSON(ev.target.files[0], imp).finally(() => (ev.target.value = ''));
}

async function fetchAll(table, build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(await build(sb.from(table)).range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function exportJSON() {
  try {
    const uid = S.user.id;
    const [entries, logs, lists] = await Promise.all([
      fetchAll('entries', (t) => t.select('media,tmdb_id,title,year,poster_path,rating,liked,watchlist,watched,review,review_at,episodes,seasons,created_at,updated_at').eq('user_id', uid).order('id')),
      fetchAll('logs', (t) => t.select('media,tmdb_id,title,year,poster_path,watched_on,rating,liked,rewatch,note,season,created_at').eq('user_id', uid).order('id')),
      fetchAll('lists', (t) => t.select('title,description,is_ranked,created_at,list_items(media,tmdb_id,title,year,poster_path,position,note)').eq('user_id', uid).order('id')),
    ]);
    const data = { app: 'titry', version: 2, exported_at: new Date().toISOString(), profile: { username: S.profile?.username, display_name: S.profile?.display_name, bio: S.profile?.bio }, entries, logs, lists: lists.map(({ list_items, ...l }) => ({ ...l, items: list_items || [] })) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `titry-${S.profile?.username || 'export'}-${U.todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`Выгружено: ${entries.length} записей, ${logs.length} в дневнике`);
  } catch (err) { toast(errText(err), 'bad'); }
}

const fullEntry = (uid, e) => ({
  user_id: uid, media: e.media === 'tv' ? 'tv' : 'movie', tmdb_id: Number(e.tmdb_id), title: String(e.title).slice(0, 300), year: Number(e.year) || null, poster_path: U.safePoster(e.poster_path),
  rating: U.clampRating(e.rating), liked: !!e.liked, watchlist: !!e.watchlist, watched: !!e.watched, review: e.review || null, review_at: e.review ? (e.review_at || new Date().toISOString()) : null,
  episodes: U.normEpisodes(e.episodes), seasons: U.normSeasons(e.seasons),
});

async function mergeWithExisting(uid, rows) {
  // Не затирать уже сохранённое на сайте: объединяем флаги, серии и рецензии
  const existing = await fetchAll('entries', (t) => t.select('*').eq('user_id', uid));
  const map = new Map(existing.map((e) => [`${e.media}:${e.tmdb_id}`, e]));
  return rows.map((r) => {
    const o = map.get(`${r.media}:${r.tmdb_id}`);
    if (!o) return r;
    const episodes = { ...o.episodes };
    for (const [s, l] of Object.entries(r.episodes || {})) episodes[s] = [...(episodes[s] || []), ...l];
    return { ...r, rating: r.rating ?? o.rating, liked: r.liked || o.liked, watched: r.watched || o.watched, watchlist: (r.watchlist || o.watchlist) && !(r.watched || o.watched), review: r.review || o.review, review_at: r.review ? r.review_at : o.review_at, episodes: U.normEpisodes(episodes), seasons: r.seasons?.length ? r.seasons : o.seasons, poster_path: r.poster_path || o.poster_path };
  });
}

async function upsertEntries(rows, onProgress) {
  for (let i = 0; i < rows.length; i += 200) {
    check(await sb.from('entries').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,media,tmdb_id' }));
    onProgress?.(Math.min(rows.length, i + 200));
  }
}
async function insertChunks(table, rows) {
  for (let i = 0; i < rows.length; i += 300) check(await sb.from(table).insert(rows.slice(i, i + 300)));
}

async function importLetterboxd(files, box) {
  if (!files.length) return;
  const say = (t) => (box.innerHTML = `<p class="amsg">${t}</p>`);
  try {
    const parsed = await Promise.all(files.map(async (f) => { const rows = U.parseCSV(await f.text()); return { name: f.name, rows, kind: U.letterboxdKind(f.name, rows) }; }));
    const { titles, logs } = U.mergeLetterboxd(parsed);
    if (!titles.length) { say('В файлах не нашлось фильмов.'); return; }
    const found = new Map();
    const missed = [];
    let done = 0;
    const queue = [...titles];
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift();
        try {
          let r = await tmdb('/search/movie', { query: t.name, ...(t.year ? { year: String(t.year) } : {}) });
          let hit = r.results?.[0];
          if (!hit && t.year) { r = await tmdb('/search/movie', { query: t.name }); hit = r.results?.find((x) => Math.abs((U.yearOf(x.release_date) || 0) - t.year) <= 1) || null; }
          if (hit) found.set(t.key, U.metaFromTmdb(hit, 'movie')); else missed.push(`${t.name}${t.year ? ' (' + t.year + ')' : ''}`);
        } catch { missed.push(t.name); }
        done++;
        if (done % 5 === 0 || done === titles.length) say(`Ищу фильмы на TMDB: ${done} из ${titles.length}…`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const uid = S.user.id;
    let rows = titles.filter((t) => found.has(t.key)).map((t) => fullEntry(uid, { ...found.get(t.key), rating: t.rating, liked: t.liked, watched: t.watched, watchlist: t.watchlist && !t.watched, review: t.review, review_at: t.review_at ? new Date(t.review_at).toISOString() : null }));
    // один TMDB-фильм может совпасть с двумя строками — склеиваем
    const uniq = new Map();
    for (const r of rows) { const k = `${r.media}:${r.tmdb_id}`; const o = uniq.get(k); uniq.set(k, o ? { ...o, rating: r.rating ?? o.rating, liked: o.liked || r.liked, watched: o.watched || r.watched, review: o.review || r.review } : r); }
    rows = await mergeWithExisting(uid, [...uniq.values()]);
    say(`Сохраняю ${rows.length} фильмов…`);
    await upsertEntries(rows);
    const logRows = logs.filter((l) => found.has(l.key) && /^\d{4}-\d{2}-\d{2}$/.test(l.watched_on)).map((l) => { const m = found.get(l.key); return { user_id: uid, media: 'movie', tmdb_id: m.tmdb_id, title: m.title, year: m.year, poster_path: m.poster_path, watched_on: l.watched_on, rating: l.rating, liked: false, rewatch: l.rewatch, note: l.note, season: null }; });
    await insertChunks('logs', logRows);
    box.innerHTML = `<p class="amsg ok">Готово: ${rows.length} фильмов, ${logRows.length} записей в дневнике.</p>${missed.length ? `<details class="small"><summary>Не нашлись на TMDB: ${missed.length}</summary><p class="muted">${missed.map(esc).join(', ')}</p></details>` : ''}`;
  } catch (err) { box.innerHTML = `<p class="amsg bad">${esc(errText(err))}</p>`; }
}

async function importJSON(file, box) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const { entries, logs, lists } = U.normalizeImport(data);
    if (!entries.length && !logs.length && !lists.length) { box.innerHTML = '<p class="amsg bad">В файле не нашлось записей. Нужен экспорт «Титров» (JSON).</p>'; return; }
    const uid = S.user.id;
    // записи для тайтлов, которые есть только в дневнике или списках
    const all = new Map(entries.map((e) => [`${e.media}:${e.tmdb_id}`, e]));
    for (const l of logs) { const k = `${l.media}:${l.tmdb_id}`; if (!all.has(k)) all.set(k, { ...l, watched: l.media === 'movie', rating: l.rating, liked: l.liked, review: null, episodes: {}, seasons: [] }); }
    box.innerHTML = `<p class="amsg">Сохраняю ${all.size} записей…</p>`;
    const rows = await mergeWithExisting(uid, [...all.values()].map((e) => fullEntry(uid, e)));
    await upsertEntries(rows);
    const existingLogs = await fetchAll('logs', (t) => t.select('media,tmdb_id,watched_on').eq('user_id', uid));
    const seen = new Set(existingLogs.map((l) => `${l.media}:${l.tmdb_id}:${l.watched_on}`));
    const newLogs = logs.filter((l) => !seen.has(`${l.media}:${l.tmdb_id}:${l.watched_on}`)).map((l) => ({ user_id: uid, media: l.media, tmdb_id: l.tmdb_id, title: String(l.title).slice(0, 300), year: Number(l.year) || null, poster_path: U.safePoster(l.poster_path), watched_on: l.watched_on, rating: U.clampRating(l.rating), liked: !!l.liked, rewatch: !!l.rewatch, note: l.note || null, season: l.season ?? null }));
    await insertChunks('logs', newLogs);
    for (const l of lists) {
      const nl = check(await sb.from('lists').insert({ user_id: uid, title: l.title, description: l.description, is_ranked: l.is_ranked }).select().single());
      if (l.items.length) check(await sb.from('list_items').upsert(l.items.map((i) => ({ ...i, list_id: nl.id })), { onConflict: 'list_id,media,tmdb_id' }));
    }
    S.myLists = null;
    box.innerHTML = `<p class="amsg ok">Готово: ${rows.length} записей, ${newLogs.length} в дневнике${lists.length ? `, ${lists.length} ${U.plural(lists.length, 'список', 'списка', 'списков')}` : ''}.</p>`;
  } catch (err) { box.innerHTML = `<p class="amsg bad">${esc(err instanceof SyntaxError ? 'Это не JSON-файл' : errText(err))}</p>`; }
}

// ═════════════ Запуск ═════════════
sb.auth.onAuthStateChange((event, session) => {
  // Вызовы Supabase внутри обработчика откладываем, иначе возможна взаимоблокировка
  setTimeout(async () => {
    if (event === 'PASSWORD_RECOVERY') { await setUser(session?.user || null); go('/settings?reset=1', true); return; }
    const uid = session?.user?.id || null;
    if (uid === (S.user?.id || null)) return;
    await setUser(session?.user || null);
    if (event !== 'INITIAL_SESSION') render(); else renderHeader();
  }, 0);
});

(async () => {
  const { data } = await sb.auth.getSession();
  await setUser(data.session?.user || null);
  render();
})();
