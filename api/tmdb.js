// Прокси к TMDB API. Ключ хранится только в переменной окружения Vercel TMDB_TOKEN.
// Запрос: /api/tmdb?path=/search/multi&query=...  → https://api.themoviedb.org/3/search/multi?query=...&language=ru-RU

const ALLOWED = /^\/(search\/(multi|movie|tv|person)|movie\/\d+(\/(credits|recommendations|similar|watch\/providers|videos|images))?|tv\/\d+(\/(aggregate_credits|credits|recommendations|similar|watch\/providers|videos|images))?|tv\/\d+\/season\/\d+|trending\/(all|movie|tv)\/(day|week)|movie\/(popular|top_rated|now_playing|upcoming)|tv\/(popular|top_rated|on_the_air|airing_today)|discover\/(movie|tv)|genre\/(movie|tv)\/list|person\/\d+(\/combined_credits)?)$/;

module.exports = async (req, res) => {
  const token = process.env.TMDB_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'На сервере не задана переменная TMDB_TOKEN' });
    return;
  }
  const params = new URLSearchParams(req.url.split('?')[1] || '');
  const path = params.get('path') || '';
  params.delete('path');
  if (!ALLOWED.test(path)) {
    res.status(400).json({ error: 'Недопустимый путь' });
    return;
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
