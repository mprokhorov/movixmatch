// MovixMatch server: static PWA + JSON API + Server-Sent Events.
// Zero dependencies — runs on plain Node 20+.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const MOVIES = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'movies.json'), 'utf8'));
const MOVIE_IDS = new Set(MOVIES.map((m) => m.id));

// ---------- storage ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { rooms: {} };
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch {
  /* fresh start */
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  }, 150);
}
function flushSync() {
  clearTimeout(saveTimer);
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
}
process.on('SIGINT', () => (flushSync(), process.exit(0)));
process.on('SIGTERM', () => (flushSync(), process.exit(0)));

// ---------- helpers ----------
const rid = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
const now = () => Date.now();
const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 30);

function seededOrder(seed) {
  // deterministic shuffle so both partners see films in the same order
  let h = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
  const rand = () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
  const ids = MOVIES.map((m) => m.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

function authUser(room, req, url) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
  if (!token) return null;
  return room.users.find((u) => u.token === token) || null;
}

const partnerOf = (room, user) => room.users.find((u) => u.id !== user.id) || null;
const publicUser = (room, u) => ({
  id: u.id,
  name: u.name,
  role: u.role,
  swiped: Object.keys(room.swipes[u.id] || {}).length,
  online: (clients.get(room.id) || new Set()).size > 0 && [...clients.get(room.id)].some((c) => c.userId === u.id),
});

function deckFor(room, user) {
  const mine = room.swipes[user.id] || {};
  const partner = partnerOf(room, user);
  const theirs = partner ? room.swipes[partner.id] || {} : {};
  const order = room.order.filter((id) => !(id in mine));
  const boosted = order.filter((id) => theirs[id] === true);
  const rest = order.filter((id) => theirs[id] !== true);
  // every 3rd card is one the partner already liked → first matches come quickly
  const deck = [];
  while (boosted.length || rest.length) {
    for (let k = 0; k < 2 && rest.length; k++) deck.push(rest.shift());
    if (boosted.length) deck.push(boosted.shift());
  }
  return deck;
}

function matchesFor(room, user) {
  return Object.values(room.matches)
    .map((m) => {
      const msgs = room.messages[m.movieId] || [];
      const lastRead = (room.lastRead[user.id] || {})[m.movieId] || 0;
      return {
        movieId: m.movieId,
        at: m.at,
        watched: !!m.watched,
        lastMessage: msgs[msgs.length - 1] || null,
        unread: msgs.filter((x) => x.at > lastRead && x.userId !== user.id).length,
      };
    })
    .sort((a, b) => (b.lastMessage?.at || b.at) - (a.lastMessage?.at || a.at));
}

function stateFor(room, user) {
  return {
    room: {
      id: room.id,
      createdAt: room.createdAt,
      users: room.users.map((u) => publicUser(room, u)),
      inviteCode: user.role === 'owner' ? room.inviteCode : undefined,
    },
    me: { id: user.id, name: user.name, role: user.role, token: user.token },
    deck: deckFor(room, user),
    matches: matchesFor(room, user),
    total: MOVIES.length,
  };
}

// ---------- realtime (SSE) ----------
const clients = new Map(); // roomId -> Set<{res, userId}>
function broadcast(room, event, data, { except } = {}) {
  for (const c of clients.get(room.id) || []) {
    if (except && c.userId === except) continue;
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
function broadcastPresence(room) {
  broadcast(room, 'users', room.users.map((u) => publicUser(room, u)));
}
setInterval(() => {
  for (const set of clients.values()) for (const c of set) c.res.write(': ping\n\n');
}, 25000);

// ---------- http plumbing ----------
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32 * 1024) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw Object.assign(new Error('bad json'), { status: 400 });
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback
      return fs.createReadStream(path.join(PUBLIC_DIR, 'index.html'))
        .on('open', () => res.writeHead(200, { 'Content-Type': MIME['.html'] }))
        .pipe(res);
    }
    const ext = path.extname(file);
    const longCache = rel.startsWith('/posters/') || rel.startsWith('/icons/');
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': longCache ? 'public, max-age=2592000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- routes ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop 'api'
  const method = req.method;

  // POST /api/rooms  — owner creates a room
  if (method === 'POST' && parts.length === 1 && parts[0] === 'rooms') {
    const { name } = await readJson(req);
    const n = cleanName(name);
    if (!n) return send(res, 400, { error: 'Введите имя' });
    const id = rid(6);
    const owner = { id: rid(6), name: n, role: 'owner', token: rid(24), joinedAt: now() };
    const room = {
      id, createdAt: now(), inviteCode: rid(6), order: seededOrder(id),
      users: [owner], swipes: { [owner.id]: {} }, history: { [owner.id]: [] },
      matches: {}, messages: {}, lastRead: {},
    };
    db.rooms[id] = room;
    save();
    return send(res, 201, stateFor(room, owner));
  }

  if (parts[0] !== 'rooms' || !parts[1]) return send(res, 404, { error: 'not found' });
  const room = db.rooms[parts[1]];
  if (!room) return send(res, 404, { error: 'Комната не найдена' });
  const sub = parts.slice(2);

  // GET /api/rooms/:id/invite/:code — public info for the join screen
  if (method === 'GET' && sub[0] === 'invite' && sub[1]) {
    if (sub[1] !== room.inviteCode) return send(res, 404, { error: 'Ссылка-приглашение недействительна' });
    const owner = room.users.find((u) => u.role === 'owner');
    const partner = room.users.find((u) => u.role === 'partner');
    return send(res, 200, { ownerName: owner.name, partnerName: partner?.name || null });
  }

  // POST /api/rooms/:id/join  { code, name }
  if (method === 'POST' && sub[0] === 'join') {
    const { code, name } = await readJson(req);
    if (code !== room.inviteCode) return send(res, 403, { error: 'Ссылка-приглашение недействительна' });
    const n = cleanName(name);
    let partner = room.users.find((u) => u.role === 'partner');
    if (partner) {
      // re-login on a new device: rotate token, optionally rename
      partner.token = rid(24);
      if (n) partner.name = n;
    } else {
      if (!n) return send(res, 400, { error: 'Введите имя' });
      partner = { id: rid(6), name: n, role: 'partner', token: rid(24), joinedAt: now() };
      room.users.push(partner);
      room.swipes[partner.id] = {};
      room.history[partner.id] = [];
    }
    save();
    broadcastPresence(room);
    return send(res, 200, stateFor(room, partner));
  }

  const user = authUser(room, req, url);
  if (!user) return send(res, 401, { error: 'Нет доступа' });
  const partner = partnerOf(room, user);

  // GET /api/rooms/:id/state
  if (method === 'GET' && sub[0] === 'state') return send(res, 200, stateFor(room, user));

  // GET /api/rooms/:id/events — SSE stream
  if (method === 'GET' && sub[0] === 'events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const client = { res, userId: user.id };
    if (!clients.has(room.id)) clients.set(room.id, new Set());
    clients.get(room.id).add(client);
    broadcastPresence(room);
    req.on('close', () => {
      clients.get(room.id)?.delete(client);
      broadcastPresence(room);
    });
    return;
  }

  // POST /api/rooms/:id/swipe  { movieId, like }
  if (method === 'POST' && sub[0] === 'swipe') {
    const { movieId, like } = await readJson(req);
    if (!MOVIE_IDS.has(movieId)) return send(res, 400, { error: 'Неизвестный фильм' });
    const mine = room.swipes[user.id];
    const liked = like === true;
    mine[movieId] = liked;
    room.history[user.id].push(movieId);
    let match = null;
    if (liked && partner && room.swipes[partner.id]?.[movieId] === true && !room.matches[movieId]) {
      match = { movieId, at: now(), watched: false };
      room.matches[movieId] = match;
    }
    save();
    broadcast(room, 'progress', { userId: user.id, swiped: Object.keys(mine).length });
    if (match) broadcast(room, 'match', match);
    return send(res, 200, { match });
  }

  // POST /api/rooms/:id/undo — revert my last swipe
  if (method === 'POST' && sub[0] === 'undo') {
    const movieId = room.history[user.id].pop();
    if (!movieId) return send(res, 400, { error: 'Нечего отменять' });
    delete room.swipes[user.id][movieId];
    const m = room.matches[movieId];
    let unmatched = false;
    if (m && !(room.messages[movieId] || []).length) {
      delete room.matches[movieId];
      unmatched = true;
      broadcast(room, 'unmatch', { movieId });
    }
    save();
    broadcast(room, 'progress', { userId: user.id, swiped: Object.keys(room.swipes[user.id]).length });
    return send(res, 200, { movieId, unmatched });
  }

  // match-scoped routes: /api/rooms/:id/matches/:movieId/...
  if (sub[0] === 'matches' && sub[1]) {
    const movieId = sub[1];
    const m = room.matches[movieId];
    if (!m) return send(res, 404, { error: 'Мэтч не найден' });

    if (method === 'GET' && sub[2] === 'messages') {
      room.lastRead[user.id] = { ...(room.lastRead[user.id] || {}), [movieId]: now() };
      save();
      return send(res, 200, { messages: room.messages[movieId] || [], watched: !!m.watched });
    }
    if (method === 'POST' && sub[2] === 'messages') {
      const { text } = await readJson(req);
      const t = String(text || '').trim().slice(0, 1000);
      if (!t) return send(res, 400, { error: 'Пустое сообщение' });
      const msg = { id: rid(6), userId: user.id, text: t, at: now() };
      (room.messages[movieId] ||= []).push(msg);
      room.lastRead[user.id] = { ...(room.lastRead[user.id] || {}), [movieId]: msg.at };
      save();
      broadcast(room, 'message', { movieId, message: msg });
      return send(res, 201, { message: msg });
    }
    if (method === 'POST' && sub[2] === 'read') {
      room.lastRead[user.id] = { ...(room.lastRead[user.id] || {}), [movieId]: now() };
      save();
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && sub[2] === 'watched') {
      const { watched } = await readJson(req);
      m.watched = !!watched;
      save();
      broadcast(room, 'watched', { movieId, watched: m.watched });
      return send(res, 200, { watched: m.watched });
    }
  }

  // POST /api/rooms/:id/invite/reset — owner revokes the old invite link
  if (method === 'POST' && sub[0] === 'invite' && sub[1] === 'reset') {
    if (user.role !== 'owner') return send(res, 403, { error: 'Только для владельца' });
    room.inviteCode = rid(6);
    save();
    return send(res, 200, { inviteCode: room.inviteCode });
  }

  return send(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
    serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Ошибка сервера' });
    if (!e.status) console.error(e);
  }
});
server.listen(PORT, () => console.log(`MovixMatch → http://localhost:${PORT}  (${MOVIES.length} films)`));
