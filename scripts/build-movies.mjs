// Builds public/movies.json + public/posters/* from TMDB (https://www.themoviedb.org).
//
//   TMDB_KEY=<v3 api key or v4 read token> node scripts/build-movies.mjs
//
// Options (env): MIN_VOTES (default 1500) — popularity floor for world cinema,
//                RU_MIN_VOTES (default 150) — floor for Russian/Soviet films,
//                LIMIT (default 1200) — max films in total.
// Requires Python 3 + Pillow for poster recompression (falls back to raw TMDB jpgs).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_JSON = path.join(ROOT, 'public', 'movies.json');
const POSTERS = path.join(ROOT, 'public', 'posters');
const KEY = process.env.TMDB_KEY;
const MIN_VOTES = Number(process.env.MIN_VOTES || 1500);
const RU_MIN_VOTES = Number(process.env.RU_MIN_VOTES || 150);
const LIMIT = Number(process.env.LIMIT || 1200);
if (!KEY) {
  console.error('Set TMDB_KEY');
  process.exit(1);
}
const isBearer = KEY.length > 40;

async function tmdb(p, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${p}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!isBearer) url.searchParams.set('api_key', KEY);
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: isBearer ? { Authorization: `Bearer ${KEY}` } : {} });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url.pathname}`);
    return res.json();
  }
  throw new Error(`rate limited: ${p}`);
}

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function discover(params, max) {
  const ids = [];
  for (let page = 1; page <= 500 && ids.length < max; page++) {
    const r = await tmdb('/discover/movie', { language: 'ru-RU', include_adult: 'false', without_genres: '99,10770', page, ...params });
    ids.push(...r.results.map((m) => m.id));
    if (page >= r.total_pages) break;
  }
  return ids.slice(0, max);
}

function shortDesc(text, max = 320) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

const world = await discover({ sort_by: 'vote_count.desc', 'vote_count.gte': MIN_VOTES }, LIMIT);
const russian = await discover({ sort_by: 'vote_count.desc', 'vote_count.gte': RU_MIN_VOTES, with_original_language: 'ru' }, 200);
const ids = [...new Set([...world, ...russian])];
console.log(`candidates: ${world.length} world + ${russian.length} russian → ${ids.length}`);

fs.mkdirSync(POSTERS, { recursive: true });
let skipped = 0;
const films = (await pool(ids, 8, async (id) => {
  const d = await tmdb(`/movie/${id}`, { language: 'ru-RU' });
  if (!d.overview || !d.poster_path || !d.release_date || !d.genres?.length) { skipped++; return null; }
  const fid = d.imdb_id || `tmdb${d.id}`;
  return {
    id: fid,
    tmdb: d.id,
    title: d.title,
    original: d.original_title,
    year: Number(d.release_date.slice(0, 4)),
    genres: d.genres.map((g) => g.name.toLowerCase()),
    runtime: d.runtime || 0,
    rating: Math.round(d.vote_average * 10) / 10,
    votes: d.vote_count,
    poster: `posters/${fid}.jpg`,
    posterPath: d.poster_path,
    desc: shortDesc(d.overview),
  };
})).filter(Boolean).slice(0, LIMIT + 200);
console.log(`films: ${films.length} (skipped ${skipped} without ru overview/poster)`);

// posters: download w500, recompress to ~480px JPEG q72 so the whole set stays small
const missing = films.filter((f) => !fs.existsSync(path.join(POSTERS, `${f.id}.jpg`)));
console.log(`downloading ${missing.length} posters…`);
await pool(missing, 12, async (f) => {
  const res = await fetch(`https://image.tmdb.org/t/p/w500${f.posterPath}`);
  if (!res.ok) throw new Error(`poster ${f.id}: ${res.status}`);
  fs.writeFileSync(path.join(POSTERS, `${f.id}.jpg`), Buffer.from(await res.arrayBuffer()));
});
try {
  execFileSync('python3', ['-I', '-c', `
import sys, os
from PIL import Image
d = sys.argv[1]
for name in sys.argv[2:]:
    p = os.path.join(d, name)
    im = Image.open(p).convert('RGB')
    if im.width > 480:
        im = im.resize((480, round(im.height * 480 / im.width)), Image.LANCZOS)
    im.save(p, 'JPEG', quality=72, optimize=True, progressive=True)
`, POSTERS, ...missing.map((f) => `${f.id}.jpg`)], { stdio: 'inherit' });
} catch (e) {
  console.warn('poster recompression skipped:', e.message);
}

// drop posters of films no longer in the set
const keep = new Set(films.map((f) => `${f.id}.jpg`));
for (const f of fs.readdirSync(POSTERS)) if (!keep.has(f)) fs.unlinkSync(path.join(POSTERS, f));

films.sort((a, b) => b.votes - a.votes);
fs.writeFileSync(OUT_JSON, JSON.stringify(films.map(({ posterPath, ...f }) => f)));
console.log(`wrote ${films.length} films → public/movies.json`);
