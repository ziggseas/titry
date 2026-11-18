// Чистые функции без DOM и сети — их можно проверять в Node.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const yearOf = (d) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);

// Нормализованные метаданные тайтла из ответа TMDB
export function metaFromTmdb(t, mediaHint) {
  let media = t.media_type === 'tv' || t.media_type === 'movie' ? t.media_type : mediaHint;
  if (!media) media = ('first_air_date' in t || ('name' in t && !('title' in t))) ? 'tv' : 'movie';
  return {
    media,
    tmdb_id: t.id,
    title: media === 'tv' ? (t.name || t.original_name || '') : (t.title || t.original_title || ''),
    year: yearOf(media === 'tv' ? t.first_air_date : t.release_date),
    poster_path: t.poster_path || null,
  };
}

// Оценка: 0.5..5 шагом 0.5 или null
export function clampRating(r) {
  if (r === null || r === undefined || r === '') return null;
  const n = Math.round(Number(r) * 2) / 2;
  if (!isFinite(n) || n < 0.5) return null;
  return Math.min(5, n);
}

export function starsText(r) {
  r = clampRating(r);
  if (!r) return '';
  return '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '');
}

// ───────────── Серии ─────────────
// episodes: {"1":[1,2,3]} ; seasons: [{n:1, eps:10}]
export function normEpisodes(episodes) {
  const out = {};
  for (const [s, list] of Object.entries(episodes || {})) {
    const uniq = [...new Set((list || []).map(Number).filter((x) => Number.isInteger(x) && x > 0))].sort((a, b) => a - b);
    if (uniq.length) out[String(Number(s))] = uniq;
  }
  return out;
}

export function isEpisodeWatched(episodes, s, e) {
  return (episodes?.[String(s)] || []).includes(Number(e));
}

export function toggleEpisode(episodes, s, e, on) {
  const ep = normEpisodes(episodes);
  const key = String(s);
  const set = new Set(ep[key] || []);
  const want = on === undefined ? !set.has(Number(e)) : on;
  if (want) set.add(Number(e)); else set.delete(Number(e));
  ep[key] = [...set];
  return normEpisodes(ep);
}

export function markSeason(episodes, s, count, on = true) {
  const ep = normEpisodes(episodes);
  if (on) ep[String(s)] = Array.from({ length: count }, (_, i) => i + 1);
  else delete ep[String(s)];
  return normEpisodes(ep);
}

// Отметить все серии до указанной включительно (во всех предыдущих сезонах тоже)
export function markUpTo(episodes, seasons, s, e) {
  let ep = normEpisodes(episodes);
  for (const se of seasons || []) {
    if (se.n < s) ep = markSeason(ep, se.n, se.eps, true);
  }
  const key = String(s);
  const set = new Set(ep[key] || []);
  for (let i = 1; i <= e; i++) set.add(i);
  ep[key] = [...set];
  return normEpisodes(ep);
}

export function countWatched(episodes, seasons) {
  const ep = normEpisodes(episodes);
  if (!seasons?.length) return Object.values(ep).reduce((a, l) => a + l.length, 0);
  return seasons.reduce((a, se) => a + (ep[String(se.n)] || []).filter((x) => x <= se.eps).length, 0);
}

export function totalEpisodes(seasons) {
  return (seasons || []).reduce((a, s) => a + (s.eps || 0), 0);
}

export function progress(episodes, seasons) {
  const total = totalEpisodes(seasons);
  const done = countWatched(episodes, seasons);
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, complete: total > 0 && done >= total };
}

// Первая непросмотренная серия по порядку
export function nextEpisode(episodes, seasons) {
  const ep = normEpisodes(episodes);
  for (const se of [...(seasons || [])].sort((a, b) => a.n - b.n)) {
    const got = new Set(ep[String(se.n)] || []);
    for (let i = 1; i <= se.eps; i++) if (!got.has(i)) return { s: se.n, e: i };
  }
  return null;
}

export function seasonsFromTmdb(tv) {
  return (tv.seasons || [])
    .filter((s) => s.season_number > 0 && s.episode_count > 0)
    .map((s) => ({ n: s.season_number, eps: s.episode_count }))
    .sort((a, b) => a.n - b.n);
}

export const epCode = (s, e) => `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;

// ───────────── Даты ─────────────
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  if (!y || !m || !day) return '';
  return `${day} ${MONTHS_GEN[m - 1]} ${y}`;
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
}

export function groupByMonth(logs) {
  const groups = [];
  const idx = new Map();
  for (const l of logs) {
    const key = String(l.watched_on).slice(0, 7);
    if (!idx.has(key)) { idx.set(key, groups.length); groups.push({ key, label: monthLabel(key), items: [] }); }
    groups[idx.get(key)].items.push(l);
  }
  return groups;
}

export function todayISO(now = new Date()) {
  const z = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function ago(iso, now = Date.now()) {
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return 'только что';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  return fmtDate(new Date(iso).toISOString());
}

// ───────────── CSV (Letterboxd) ─────────────
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// Определить тип файла Letterboxd по заголовкам и имени
export function letterboxdKind(name, rows) {
  const n = (name || '').toLowerCase();
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  if (n.includes('watchlist')) return 'watchlist';
  if (cols.includes('Review')) return 'reviews';
  if (cols.includes('Watched Date')) return 'diary';
  if (n.includes('likes') || n.includes('films')) return n.includes('likes') ? 'likes' : 'watched';
  if (cols.includes('Rating')) return 'ratings';
  return 'watched';
}

// Свести файлы Letterboxd к записям и дневнику (ещё без tmdb_id)
export function mergeLetterboxd(files) {
  const titles = new Map();
  const logs = [];
  const keyOf = (r) => `${r.Name}|${r.Year}`;
  const get = (r) => {
    const k = keyOf(r);
    if (!titles.has(k)) titles.set(k, { name: r.Name, year: r.Year ? Number(r.Year) : null, rating: null, watched: false, watchlist: false, liked: false, review: null, review_at: null });
    return titles.get(k);
  };
  for (const f of files) {
    for (const r of f.rows) {
      if (!r.Name) continue;
      const t = get(r);
      const rating = clampRating(r.Rating);
      if (f.kind === 'watchlist') { t.watchlist = true; continue; }
      if (f.kind === 'likes') { t.liked = true; t.watched = true; continue; }
      t.watched = true; t.watchlist = false;
      if (rating && (f.kind === 'ratings' || t.rating === null)) t.rating = rating;
      if (f.kind === 'reviews' && r.Review) { t.review = r.Review; t.review_at = (r['Watched Date'] || r.Date) || null; }
      if (f.kind === 'diary' || (f.kind === 'reviews' && r['Watched Date'])) {
        logs.push({ key: keyOf(r), watched_on: r['Watched Date'] || r.Date, rating, rewatch: /^yes$/i.test(r.Rewatch || ''), note: f.kind === 'reviews' ? r.Review || null : null });
      }
    }
  }
  // отзыв из reviews.csv дублирует запись из diary.csv — убираем дубли по ключу+дате
  const seen = new Map();
  for (const l of logs) {
    const k = `${l.key}|${l.watched_on}`;
    const prev = seen.get(k);
    if (!prev) seen.set(k, l);
    else seen.set(k, { ...prev, note: prev.note || l.note, rating: prev.rating ?? l.rating, rewatch: prev.rewatch || l.rewatch });
  }
  return { titles: [...titles.entries()].map(([key, v]) => ({ key, ...v })), logs: [...seen.values()] };
}

// ───────────── Импорт JSON (первая версия и собственный экспорт) ─────────────
export function normalizeImport(data) {
  const pick = (o, ...ks) => { for (const k of ks) if (o?.[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
  let arr = Array.isArray(data) ? data : pick(data, 'entries', 'items', 'titles', 'library', 'films', 'data') || [];
  if (!Array.isArray(arr) && typeof arr === 'object') arr = Object.values(arr);
  const entries = [];
  const logs = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    let media = String(pick(raw, 'media', 'media_type', 'type', 'kind') || 'movie').toLowerCase();
    media = /tv|series|show|сериал/.test(media) ? 'tv' : 'movie';
    const tmdb_id = Number(pick(raw, 'tmdb_id', 'tmdbId', 'tmdb', 'id'));
    if (!Number.isInteger(tmdb_id) || tmdb_id <= 0) continue;
    const title = String(pick(raw, 'title', 'name') || '').trim();
    if (!title) continue;
    const yearRaw = pick(raw, 'year', 'release_year');
    const year = yearRaw ? Number(String(yearRaw).slice(0, 4)) || null : yearOf(pick(raw, 'release_date', 'first_air_date'));
    let poster = pick(raw, 'poster_path', 'poster', 'posterPath') || null;
    if (poster && /image\.tmdb\.org/.test(poster)) poster = poster.replace(/^.*\/t\/p\/[^/]+/, '');
    const status = String(pick(raw, 'status', 'state') || '').toLowerCase();
    let seasons = pick(raw, 'seasons') || [];
    if (!Array.isArray(seasons)) seasons = [];
    seasons = seasons.map((s) => ({ n: Number(s.n ?? s.season_number ?? s.number), eps: Number(s.eps ?? s.episode_count ?? s.episodes) })).filter((s) => s.n > 0 && s.eps > 0);
    const e = {
      media, tmdb_id, title, year, poster_path: poster,
      rating: clampRating(pick(raw, 'rating', 'stars', 'score')),
      liked: Boolean(pick(raw, 'liked', 'like', 'favorite', 'fav')),
      watchlist: Boolean(pick(raw, 'watchlist', 'want', 'wishlist')) || /want|watchlist|хочу/.test(status),
      watched: Boolean(pick(raw, 'watched', 'seen')) || /watched|seen|done|смотрел|просмотр/.test(status),
      review: pick(raw, 'review', 'text') || null,
      review_at: pick(raw, 'review_at', 'reviewedAt') || null,
      episodes: normEpisodes(typeof raw.episodes === 'object' && !Array.isArray(raw.episodes) ? raw.episodes : {}),
      seasons,
    };
    if (e.rating) e.watched = true;
    if (e.watched) e.watchlist = false;
    entries.push(e);
    const diary = pick(raw, 'logs', 'diary', 'history', 'views') || [];
    if (Array.isArray(diary)) {
      for (const d of diary) {
        const date = String(pick(d, 'watched_on', 'date', 'watchedAt', 'at') || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        logs.push({ media, tmdb_id, title, year, poster_path: poster, watched_on: date, rating: clampRating(pick(d, 'rating')), liked: Boolean(d.liked), rewatch: Boolean(d.rewatch), note: pick(d, 'note', 'review', 'text') || null, season: Number(d.season) || null });
      }
    }
  }
  // Собственный экспорт: logs на верхнем уровне
  if (!Array.isArray(data) && Array.isArray(data?.logs)) {
    for (const d of data.logs) {
      if (!d?.tmdb_id || !d?.watched_on) continue;
      logs.push({ media: d.media === 'tv' ? 'tv' : 'movie', tmdb_id: Number(d.tmdb_id), title: d.title, year: d.year ?? null, poster_path: d.poster_path ?? null, watched_on: String(d.watched_on).slice(0, 10), rating: clampRating(d.rating), liked: Boolean(d.liked), rewatch: Boolean(d.rewatch), note: d.note || null, season: d.season ?? null });
    }
  }
  const lists = !Array.isArray(data) && Array.isArray(data?.lists) ? data.lists.filter((l) => l?.title).map((l) => ({ title: String(l.title).slice(0, 120), description: l.description || null, is_ranked: Boolean(l.is_ranked), items: (l.items || []).filter((i) => i?.tmdb_id && i?.title).map((i, k) => ({ media: i.media === 'tv' ? 'tv' : 'movie', tmdb_id: Number(i.tmdb_id), title: i.title, year: i.year ?? null, poster_path: i.poster_path ?? null, position: i.position ?? k, note: i.note || null })) })) : [];
  return { entries, logs, lists };
}

export function histogram(ratings) {
  const h = Array(10).fill(0);
  for (const r of ratings) { const c = clampRating(r); if (c) h[c * 2 - 1]++; }
  return h;
}

export const validUsername = (u) => /^[a-z0-9_]{3,24}$/.test(u);
