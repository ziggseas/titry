// Прокси к TMDB API. Ключ хранится только в переменной окружения Vercel TMDB_TOKEN.
// Запрос: /api/tmdb?path=/search/multi&query=...  → https://api.themoviedb.org/3/search/multi?query=...&language=ru-RU

const ALLOWED = /^\/(search\/(multi|movie|tv)|movie\/\d{1,9}|tv\/\d{1,9}|tv\/\d{1,9}\/season\/\d{1,3}|trending\/(all|movie|tv)\/(day|week))$/;

// Разрешённые параметры и их допустимые значения
const PARAMS = {
  query: (v) => v.length > 0 && v.length <= 200,
  page: (v) => /^([1-9]|[1-4]\d|500)$/.test(v),
  year: (v) => /^(18|19|20|21)\d\d$/.test(v),
  include_adult: (v) => v === 'false',
  language: (v) => /^[a-z]{2}-[A-Z]{2}$/.test(v),
  append_to_response: (v) => v.split(',').every((x) => ['credits', 'aggregate_credits', 'recommendations', 'release_dates', 'content_ratings'].includes(x)),
};

// Свои адреса: основной домен, адреса сборок проекта и локальная разработка
const OWN_HOST = /^(titry\.vercel\.app|titry-[a-z0-9-]+-ziggseas\.vercel\.app|titry-git-[a-z0-9-]+-ziggseas\.vercel\.app|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/;

function fromOwnSite(req) {
  const h = req.headers || {};
  // Браузер сам ставит Sec-Fetch-Site; страница чужого сайта не может его подменить
  const site = h['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  for (const k of ['origin', 'referer']) {
    if (!h[k]) continue;
    try { if (!OWN_HOST.test(new URL(h[k]).host)) return false; } catch { return false; }
  }
  return true;
}

module.exports = async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  if (req.method && req.method !== 'GET') { res.status(405).json({ error: 'Только GET' }); return; }
  if (!fromOwnSite(req)) { res.status(403).json({ error: 'Доступ только с сайта «Титры»' }); return; }
  const token = process.env.TMDB_TOKEN;
  if (!token) { res.status(500).json({ error: 'На сервере не задана переменная TMDB_TOKEN' }); return; }

  const incoming = new URLSearchParams((req.url || '').split('?')[1] || '');
  const path = incoming.get('path') || '';
  if (!ALLOWED.test(path)) { res.status(400).json({ error: 'Недопустимый путь' }); return; }
  const params = new URLSearchParams();
  for (const [k, v] of incoming) {
    if (k === 'path') continue;
    if (!PARAMS[k] || !PARAMS[k](v) || params.has(k)) { res.status(400).json({ error: `Недопустимый параметр: ${k}` }); return; }
    params.set(k, v);
  }
  if (!params.has('language')) params.set('language', 'ru-RU');

  const headers = { accept: 'application/json' };
  // Поддерживаются оба вида ключа: токен v4 (длинный JWT) и ключ v3 (32 символа)
  if (token.length > 40) headers.authorization = `Bearer ${token}`;
  else params.set('api_key', token);

  try {
    const r = await fetch(`https://api.themoviedb.org/3${path}?${params}`, { headers });
    const body = await r.text();
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (r.ok) res.setHeader('cache-control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    res.status(r.status).send(body);
  } catch (e) {
    res.status(502).json({ error: 'TMDB недоступен' });
  }
};
