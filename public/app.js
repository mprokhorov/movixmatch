// MovixMatch client — vanilla JS, no build step. Firebase: anonymous auth (profile lives in this browser) + Firestore.
// Navigation is in-memory: the URL never changes while using the app.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, connectFirestoreEmulator, doc, collection, query, where, orderBy,
  getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, runTransaction, deleteField, increment, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const SECTION = 'Вдвоём'; // name of the connections tab
const INVITE_TTL = 7 * 24 * 3600 * 1000;
const MIN_GENRES = 3;

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const CONFIGURED = LOCAL || !String(firebaseConfig.apiKey).startsWith('PASTE');

const ICONS = {
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.8 4.4 7.2C19.5 16.4 12 21 12 21z"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>',
  cards: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 3h9A2.5 2.5 0 0119 5.5v13a2.5 2.5 0 01-2.5 2.5h-9A2.5 2.5 0 015 18.5v-13A2.5 2.5 0 017.5 3zm4.5 12.6s3.6-2.2 3.6-4.6c0-1.2-.9-2.1-2-2.1-.7 0-1.3.4-1.6.9-.3-.5-.9-.9-1.6-.9-1.1 0-2 .9-2 2.1 0 2.4 3.6 4.6 3.6 4.6z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c5 0 9 3.6 9 8s-4 8-9 8c-1 0-2-.1-2.9-.4L4 20.5l1.4-4A7.6 7.6 0 013 11c0-4.4 4-8 9-8z"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="8.5" cy="8" r="3.6"/><circle cx="16.5" cy="9" r="3"/><path d="M1.5 20c.4-3.9 3.3-6.4 7-6.4s6.6 2.5 7 6.4h-14zM15.2 13.8c3.5-.5 6.6 1.6 7.3 5.2H17c-.2-2-.8-3.7-1.8-5.2z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4.2"/><path d="M3.8 21c.5-4.6 3.9-7.6 8.2-7.6s7.7 3 8.2 7.6H3.8z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.5-7.5a1 1 0 000-1.8L3.4 3.6a.9.9 0 00-1.3 1L4 11l9 1-9 1-1.9 6.4a.9.9 0 001.3 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg>',
};

// ---------- firebase ----------
let auth, db;
if (CONFIGURED) {
  const cfg = LOCAL ? { apiKey: 'demo-key', projectId: 'demo-movixmatch', authDomain: 'localhost' } : firebaseConfig;
  const app = initializeApp(cfg);
  auth = getAuth(app);
  db = getFirestore(app);
  if (LOCAL) {
    connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, location.hostname, 8080);
  }
}
const userRef = (uid) => doc(db, 'users', uid);
const pairRef = (pid) => doc(db, 'pairs', pid);
const inviteRef = (code) => doc(db, 'invites', code);
const matchRef = (pid, movieId) => doc(db, 'pairs', pid, 'matches', movieId);
const messagesCol = (pid, movieId) => collection(db, 'pairs', pid, 'matches', movieId, 'messages');

// ---------- state ----------
const S = {
  user: null,
  profile: null,
  movies: new Map(),
  order: [],
  genres: [],
  pairs: new Map(), // pairId -> pair doc
  partners: new Map(), // uid -> user doc
  matches: new Map(), // "pairId/movieId" -> { pairId, movieId, ...doc }
  matchesLoaded: new Set(),
  pairsLoaded: false,
  shownMatches: new Set(),
  pendingMatches: new Set(),
  queue: [],
  undoStack: [],
  unsubs: [],
  pairUnsubs: new Map(),
  chatUnsub: null,
  view: 'swipe',
  chat: null, // { pairId, movieId }
  matchFilter: 'all',
  myInvite: null,
  pendingInvite: null,
  busy: false,
  ready: false,
};

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmtRuntime = (m) => (!m ? '' : m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60 ? (m % 60) + ' мин' : ''}` : `${m} мин`).trim();
const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 30);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function randomId(len) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => abc[b % abc.length]).join('');
}
function fmtTime(ts) {
  const d = new Date(ts);
  const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${t}`;
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2800);
}
function vibrate(p) { try { navigator.vibrate?.(p); } catch {} }
function errText(e) {
  if (e?.code === 'permission-denied') return 'Нет доступа';
  if (e?.code === 'unavailable') return 'Нет связи с сервером';
  if (e?.code === 'auth/network-request-failed') return 'Нет интернета';
  return e?.message || 'Что-то пошло не так';
}
const spinner = () => ($app.innerHTML = '<div class="screen"><div class="spinner"></div></div>');

const myUid = () => S.user.uid;
const partnerUidOf = (pid) => S.pairs.get(pid)?.members.find((u) => u !== myUid());
const partnerOf = (pid) => S.partners.get(partnerUidOf(pid));
const partnerName = (pid) => partnerOf(pid)?.name || '…';
const isOnline = (uid) => Date.now() - (S.partners.get(uid)?.lastSeen || 0) < 90_000;
const likes = (p) => p?.likes || {};
const matchKey = (pid, movieId) => `${pid}/${movieId}`;
function avatarHtml(person, cls = '', online = null) {
  const inner = person?.photo ? `<img src="${esc(person.photo)}" alt="" referrerpolicy="no-referrer">` : esc((person?.name || '?').charAt(0).toUpperCase());
  return `<div class="avatar ${cls}">${inner}${online === null ? '' : `<span class="dot ${online ? 'on' : ''}"></span>`}</div>`;
}
function unreadOf(key) {
  const m = S.matches.get(key);
  if (!m) return 0;
  const read = S.pairs.get(m.pairId)?.read?.[myUid()]?.[m.movieId] || 0;
  return Math.max(0, (m.counts?.[partnerUidOf(m.pairId)] || 0) - read);
}
async function share(url, text) {
  if (navigator.share) {
    try { await navigator.share({ title: 'MovixMatch', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copy(url);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Ссылка скопирована'); }
  catch { prompt('Скопируйте ссылку:', text); }
}

// ---------- catalog & deck ----------
function seededRng(seed) {
  let x = 2166136261;
  for (const ch of seed) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; }
  x = x || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
function buildCatalog(list) {
  list.forEach((m) => S.movies.set(m.id, m));
  // one global order for everyone, so connected people meet the same films around the same time;
  // well-known films first (popularity tiers), shuffled within each tier
  const byVotes = [...list].sort((a, b) => (b.votes || 0) - (a.votes || 0));
  const rand = seededRng('movixmatch-v2');
  S.order = [];
  for (let i = 0; i < byVotes.length; i += 150) {
    const tier = byVotes.slice(i, i + 150).map((m) => m.id);
    for (let k = tier.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [tier[k], tier[j]] = [tier[j], tier[k]];
    }
    S.order.push(...tier);
  }
  const counts = {};
  list.forEach((m) => m.genres.forEach((g) => (counts[g] = (counts[g] || 0) + 1)));
  S.genres = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([g]) => g);
}
function computeDeck() {
  const mine = likes(S.profile);
  const fav = new Set(S.profile?.genres || []);
  return S.order.filter((id) => !(id in mine) && (!fav.size || S.movies.get(id).genres.some((g) => fav.has(g))));
}
function refreshQueue() {
  const deck = computeDeck();
  const visible = [...document.querySelectorAll('.deck .card')].map((c) => c.dataset.id).reverse();
  const keep = visible.filter((id) => deck.includes(id));
  S.queue = [...keep, ...deck.filter((id) => !keep.includes(id))];
  preload();
}
function preload() {
  S.queue.slice(0, 4).forEach((id) => { const m = S.movies.get(id); if (m) new Image().src = m.poster; });
}

// ---------- navigation (in-memory, URL stays the same) ----------
function show(view) {
  closeChat();
  S.view = view;
  render();
}
function openChat(pairId, movieId) {
  closeChat();
  S.chat = { pairId, movieId };
  render();
}
function closeChat() {
  S.chatUnsub?.();
  S.chatUnsub = null;
  S.chat = null;
}
function render() {
  if (!S.ready) return;
  if (S.chat) return renderChat();
  ({ swipe: renderSwipe, matches: renderMatches, people: renderPeople, profile: renderProfile })[S.view]();
}

// ---------- auth lifecycle ----------
function teardown() {
  S.unsubs.forEach((u) => u());
  S.pairUnsubs.forEach((list) => list.forEach((u) => u()));
  closeChat();
  Object.assign(S, {
    profile: null, pairs: new Map(), partners: new Map(), matches: new Map(), matchesLoaded: new Set(), pairsLoaded: false,
    shownMatches: new Set(), queue: [], undoStack: [], unsubs: [], pairUnsubs: new Map(), view: 'swipe', myInvite: null, ready: false,
  });
}

async function onAuth(user) {
  teardown();
  S.user = user;
  if (!user) {
    spinner();
    return signInAnonymously(auth).catch((e) => {
      $app.innerHTML = `<div class="screen"><div class="empty"><div class="big">📡</div><h3>Не удалось войти</h3><p class="muted">${esc(errText(e))}</p><button class="btn sm" id="retry">Повторить</button></div></div>`;
      $app.querySelector('#retry').onclick = () => onAuth(null);
    });
  }
  spinner();
  try {
    const snap = await getDoc(userRef(user.uid));
    if (!snap.exists()) return renderWelcome();
    S.profile = snap.data();
    startApp();
  } catch (e) {
    $app.innerHTML = `<div class="screen"><div class="empty"><div class="big">📡</div><h3>Нет связи</h3><p class="muted">${esc(errText(e))}</p><button class="btn sm" id="retry">Повторить</button></div></div>`;
    $app.querySelector('#retry').onclick = () => onAuth(user);
  }
}

function startApp() {
  subscribe();
  S.queue = computeDeck();
  preload();
  S.ready = true;
  heartbeat();
  if (S.pendingInvite) return renderInvite(S.pendingInvite);
  render();
}

function subscribe() {
  S.unsubs.push(onSnapshot(userRef(myUid()), (snap) => {
    const prevGenres = (S.profile?.genres || []).join('|');
    S.profile = snap.data() || S.profile;
    if ((S.profile.genres || []).join('|') !== prevGenres && S.view === 'swipe' && !S.chat) {
      refreshQueue();
      buildDeck();
    }
    for (const pid of S.pairs.keys()) checkMatches(pid);
  }));

  // includeMetadataChanges: a pair we just created shows up locally before the server has it;
  // the partner's profile is only readable once the pair is committed, so attach after that
  S.unsubs.push(onSnapshot(query(collection(db, 'pairs'), where('members', 'array-contains', myUid())), { includeMetadataChanges: true }, (snap) => {
    const initial = !S.pairsLoaded;
    S.pairsLoaded = true;
    for (const ch of snap.docChanges({ includeMetadataChanges: true })) {
      const pid = ch.doc.id;
      if (ch.type === 'removed') { detachPair(pid); continue; }
      S.pairs.set(pid, ch.doc.data());
      if (!S.pairUnsubs.has(pid) && !ch.doc.metadata.hasPendingWrites) attachPair(pid, !initial);
    }
    updateBadges();
    if (S.ready && !S.chat && (S.view === 'matches' || S.view === 'people')) render();
  }));
}

function attachPair(pid, announce) {
  const uid = partnerUidOf(pid);
  const list = [];
  let firstPartner = true;
  const listenPartner = (attempt = 0) => {
    const off = onSnapshot(userRef(uid), (snap) => {
      S.partners.set(uid, snap.data() || {});
      if (firstPartner && announce) toast(`${snap.data()?.name || 'Партнёр'} теперь в разделе «${SECTION}» 💞`);
      firstPartner = false;
      checkMatches(pid);
      updatePresence();
      if (S.ready && !S.chat && S.view === 'people') render();
    }, () => {
      // access can lag a moment behind a fresh connection — retry while the pair still exists
      if (attempt < 5 && S.pairs.has(pid)) setTimeout(() => S.pairs.has(pid) && listenPartner(attempt + 1), 800 * (attempt + 1));
    });
    list.push(off);
  };
  listenPartner();

  list.push(onSnapshot(collection(db, 'pairs', pid, 'matches'), (snap) => {
    const first = !S.matchesLoaded.has(pid);
    S.matchesLoaded.add(pid);
    for (const ch of snap.docChanges()) {
      const key = matchKey(pid, ch.doc.id);
      if (ch.type === 'removed') { S.matches.delete(key); S.shownMatches.delete(key); continue; }
      const prev = S.matches.get(key);
      const data = { pairId: pid, movieId: ch.doc.id, ...ch.doc.data() };
      S.matches.set(key, data);
      if (ch.type === 'added') {
        if (first) S.shownMatches.add(key);
        else if (!S.shownMatches.has(key)) showMatch(pid, ch.doc.id);
      }
      if (ch.type === 'modified') {
        const lm = data.lastMessage;
        const open = S.chat?.pairId === pid && S.chat?.movieId === ch.doc.id;
        if (lm && lm.at !== prev?.lastMessage?.at && lm.uid !== myUid() && !open) {
          vibrate(20);
          toast(`${partnerName(pid)} · ${S.movies.get(ch.doc.id)?.title || ''}: ${lm.text}`);
        }
        if (open) {
          const t = document.querySelector('[data-watched]');
          if (t) setWatchedToggle(t, !!data.watched);
          if (document.visibilityState === 'visible') markRead(pid, ch.doc.id);
        }
      }
    }
    checkMatches(pid);
    updateBadges();
    if (S.ready && !S.chat && S.view === 'matches') render();
  }, () => {}));
  S.pairUnsubs.set(pid, list);
}

function detachPair(pid) {
  S.pairUnsubs.get(pid)?.forEach((u) => u());
  S.pairUnsubs.delete(pid);
  const uid = partnerUidOf(pid);
  S.pairs.delete(pid);
  S.partners.delete(uid);
  S.matchesLoaded.delete(pid);
  for (const key of [...S.matches.keys()]) if (key.startsWith(pid + '/')) S.matches.delete(key);
  if (S.chat?.pairId === pid) { closeChat(); render(); }
}

// a match exists once both people liked the same film; whichever client notices first writes it
function checkMatches(pid) {
  if (!S.matchesLoaded.has(pid) || !S.profile) return;
  const mine = likes(S.profile);
  const theirs = likes(partnerOf(pid));
  for (const id of Object.keys(mine)) {
    const key = matchKey(pid, id);
    if (mine[id] !== true || theirs[id] !== true || S.matches.has(key) || S.pendingMatches.has(key) || !S.movies.has(id)) continue;
    S.pendingMatches.add(key);
    runTransaction(db, async (tx) => {
      const ref = matchRef(pid, id);
      if (!(await tx.get(ref)).exists()) tx.set(ref, { at: Date.now(), watched: false, counts: {} });
    }).catch(() => {}).finally(() => S.pendingMatches.delete(key));
  }
}

let beatTimer;
function heartbeat() {
  clearInterval(beatTimer);
  const beat = () => {
    if (document.visibilityState === 'visible' && S.ready) updateDoc(userRef(myUid()), { lastSeen: Date.now() }).catch(() => {});
  };
  beat();
  beatTimer = setInterval(() => { beat(); updatePresence(); }, 45_000);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.ready) heartbeat();
});

// ---------- chrome ----------
function badgeCount() {
  let unread = 0;
  for (const key of S.matches.keys()) unread += unreadOf(key);
  return unread;
}
function tabbar() {
  const n = badgeCount();
  const tabs = [['swipe', ICONS.cards, 'Фильмы'], ['matches', ICONS.chat, 'Мэтчи'], ['people', ICONS.people, SECTION], ['profile', ICONS.user, 'Профиль']];
  const el = h(`<nav class="tabbar">${tabs.map(([id, icon, label]) => `
    <button data-tab="${id}" class="${S.view === id ? 'active' : ''}" aria-label="${label}">${icon}
      ${id === 'matches' ? `<span class="badge" data-badge style="${n ? '' : 'display:none'}">${n}</span>` : ''}</button>`).join('')}</nav>`);
  el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab)));
  return el;
}
function updateBadges() {
  const n = badgeCount();
  document.querySelectorAll('[data-badge]').forEach((b) => { b.textContent = n; b.style.display = n ? '' : 'none'; });
}
function updatePresence() {
  document.querySelectorAll('[data-presence]').forEach((el) => {
    const pid = el.dataset.presence;
    const uid = partnerUidOf(pid);
    el.innerHTML = uid ? `<span class="dot ${isOnline(uid) ? 'on' : ''}"></span>${esc(partnerName(pid))}` : '';
  });
}

// ---------- login ----------
function renderSetup() {
  $app.replaceChildren(h(`
    <div class="screen"><div class="empty">
      <div class="big">🛠️</div><h3>Firebase ещё не подключён</h3>
      <p class="muted">Вставь конфиг в public/firebase-config.js — см. DEPLOY.md.</p>
    </div></div>`));
}

function renderWelcome() {
  const invited = !!S.pendingInvite;
  $app.replaceChildren(h(`
    <div class="screen">
      <div class="hero">
        <div class="poster-fan">${['tt3783958', 'tt1375666', 'tt0245429'].map((id) => S.movies.get(id)).filter(Boolean).map((m) => `<img src="${m.poster}" alt="">`).join('')}</div>
        <div class="wordmark big">movixmatch</div>
        <h1>${invited ? 'Тебя зовут выбирать фильмы вместе' : 'Выбирайте фильм вдвоём — без споров'}</h1>
        <p class="muted">${invited
          ? 'Заполни короткую анкету — и сможешь принять приглашение.'
          : 'Свайпайте карточки. Когда фильм понравится вам обоим — это мэтч.'}</p>
        <div class="grow"></div>
        <button class="btn" id="start">Создать анкету</button>
        <p class="legal">Анкета хранится в этом браузере — без регистрации и паролей.</p>
      </div>
    </div>`));
  $app.querySelector('#start').onclick = () => renderOnboarding();
}

// ---------- onboarding: name + favourite genres ----------
function renderOnboarding(step = 1, draft = null) {
  draft ||= { name: '', genres: new Set() };
  if (step === 1) {
    $app.replaceChildren(h(`
      <div class="screen">
        <form class="hero" id="f">
          <div class="steps-dots"><i class="on"></i><i></i></div>
          <h1>Как тебя зовут?</h1>
          <p class="muted">Это имя увидит тот, с кем ты будешь выбирать фильмы.</p>
          <input class="field" name="name" value="${esc(draft.name)}" placeholder="Имя" maxlength="30" autocomplete="given-name" required>
          <div class="grow"></div>
          <button class="btn" type="submit">Дальше</button>
        </form>
      </div>`));
    const f = $app.querySelector('#f');
    f.onsubmit = (e) => {
      e.preventDefault();
      draft.name = cleanName(f.name.value);
      if (draft.name) renderOnboarding(2, draft);
    };
    return;
  }
  const screen = h(`
    <div class="screen">
      <div class="hero">
        <div class="steps-dots"><i class="on"></i><i class="on"></i></div>
        <button class="back-link" data-back>← Назад</button>
        <h1>Что любишь смотреть?</h1>
        <p class="muted">Выбери хотя бы ${MIN_GENRES} жанра — колода будет только из них. Поменять можно в профиле.</p>
        <div class="chips">${S.genres.map((g) => `<button class="chip ${draft.genres.has(g) ? 'on' : ''}" data-g="${esc(g)}">${esc(cap(g))}</button>`).join('')}</div>
        <div class="grow"></div>
        <button class="btn" data-done>Начать</button>
      </div>
    </div>`);
  const done = screen.querySelector('[data-done]');
  const sync = () => {
    done.disabled = draft.genres.size < MIN_GENRES;
    done.textContent = draft.genres.size < MIN_GENRES ? `Ещё ${MIN_GENRES - draft.genres.size}` : 'Начать';
  };
  screen.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => {
    const g = b.dataset.g;
    draft.genres.has(g) ? draft.genres.delete(g) : draft.genres.add(g);
    b.classList.toggle('on');
    sync();
  }));
  screen.querySelector('[data-back]').onclick = () => renderOnboarding(1, draft);
  done.onclick = async () => {
    done.disabled = true;
    const profile = { name: draft.name, genres: [...draft.genres], likes: {}, createdAt: Date.now(), lastSeen: Date.now() };
    try {
      await setDoc(userRef(myUid()), profile);
      S.profile = profile;
      startApp();
    } catch (e) {
      toast(errText(e));
      sync();
    }
  };
  sync();
  $app.replaceChildren(screen);
}

// ---------- accepting an invite ----------
async function renderInvite(code) {
  S.pendingInvite = null;
  spinner();
  const fail = (title, text) => {
    $app.replaceChildren(h(`<div class="screen"><div class="empty"><div class="big">💌</div><h3>${title}</h3><p class="muted">${text}</p><button class="btn sm" data-ok>Понятно</button></div></div>`));
    $app.querySelector('[data-ok]').onclick = () => show('swipe');
  };
  let inv;
  try {
    const snap = await getDoc(inviteRef(code));
    if (!snap.exists()) return fail('Ссылка не работает', 'Её уже использовали или отозвали. Попроси прислать новую.');
    inv = snap.data();
  } catch (e) {
    return fail('Ссылка не работает', esc(errText(e)));
  }
  for (let i = 0; i < 30 && !S.pairsLoaded; i++) await new Promise((r) => setTimeout(r, 100));
  if (inv.fromUid === myUid()) return fail('Это твоя ссылка', 'Отправь её человеку, с которым хочешь выбирать фильмы.');
  if (inv.expiresAt < Date.now()) return fail('Ссылка устарела', 'Приглашения действуют 7 дней. Попроси прислать новую.');
  const members = [myUid(), inv.fromUid].sort();
  const pid = members.join('_');
  if (S.pairs.has(pid)) return fail('Вы уже вместе', `${esc(inv.fromName)} уже в разделе «${SECTION}».`);

  $app.replaceChildren(h(`
    <div class="screen">
      <div class="hero">
        <div class="grow"></div>
        <div class="center">${avatarHtml({ name: inv.fromName }, 'xl').replace('class="avatar xl"', 'class="avatar xl" style="margin:0 auto"')}</div>
        <h1 class="center">${esc(inv.fromName)} зовёт выбирать фильмы вместе</h1>
        <p class="muted center">Вы будете видеть мэтчи друг с другом и сможете обсуждать фильмы. Лайки у тебя общие для всех.</p>
        <div class="grow"></div>
        <button class="btn" data-accept>Принять</button>
        <button class="btn ghost" data-decline>Не сейчас</button>
      </div>
    </div>`));
  $app.querySelector('[data-decline]').onclick = () => show('swipe');
  $app.querySelector('[data-accept]').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const batch = writeBatch(db);
      batch.set(pairRef(pid), { members, invite: code, createdAt: Date.now(), read: {} });
      batch.delete(inviteRef(code));
      await batch.commit();
      toast(`Готово! ${inv.fromName} теперь в «${SECTION}» 💞`);
      show('swipe');
    } catch (err) {
      e.target.disabled = false;
      toast(err.code === 'permission-denied' ? 'Ссылку уже использовали или отозвали' : errText(err));
    }
  };
}

// ---------- swipe ----------
function renderSwipe() {
  const lonely = S.pairsLoaded && !S.pairs.size;
  const screen = h(`
    <div class="screen">
      <header class="topbar">
        <div class="wordmark">movixmatch</div>
        ${lonely ? `<button class="btn sm outline" data-invite>Позвать пару</button>` : ''}
      </header>
      <div class="deck-wrap">
        <div class="deck"></div>
        <div class="controls">
          <button class="round nope" data-act="nope" aria-label="Не хочу">${ICONS.x}</button>
          <button class="round small" data-act="undo" aria-label="Вернуть">${ICONS.undo}</button>
          <button class="round like" data-act="like" aria-label="Хочу">${ICONS.heart}</button>
        </div>
      </div>
    </div>`);
  screen.querySelector('[data-invite]')?.addEventListener('click', () => show('people'));
  screen.querySelector('[data-act="nope"]').onclick = () => flyTop(false);
  screen.querySelector('[data-act="like"]').onclick = () => flyTop(true);
  screen.querySelector('[data-act="undo"]').onclick = undo;
  $app.replaceChildren(screen, tabbar());
  buildDeck();
}

function cardEl(movieId, behind) {
  const m = S.movies.get(movieId);
  const sub = [m.rating ? `<span class="star">★ ${m.rating.toFixed(1)}</span>` : '', fmtRuntime(m.runtime), m.genres.slice(0, 3).join(', ')].filter(Boolean);
  return h(`
    <div class="card ${behind ? 'behind' : ''}" data-id="${m.id}">
      <img class="poster" src="${m.poster}" alt="" draggable="false">
      <div class="shade"></div>
      <div class="stamp like">Хочу</div>
      <div class="stamp nope">Нет</div>
      <div class="info">
        <h3>${esc(m.title)}<span class="year">${m.year}</span></h3>
        <div class="sub">${sub.map((s) => `<span>${s}</span>`).join('')}</div>
        <p class="desc">${esc(m.desc)}</p>
      </div>
    </div>`);
}

function buildDeck() {
  const deck = document.querySelector('.deck');
  if (!deck) return;
  deck.innerHTML = '';
  updateControls();
  if (!S.queue.length) {
    deck.replaceWith(h(`
      <div class="empty deck">
        <div class="big">🎬</div>
        <h3>Ты посмотрел(а) всё</h3>
        <p class="muted">В выбранных жанрах фильмы закончились. Добавь жанров в профиле — колода пополнится.</p>
        <button class="btn sm outline" data-genres>Изменить жанры</button>
      </div>`));
    document.querySelector('[data-genres]').onclick = () => show('profile');
    return;
  }
  if (S.queue[1]) deck.appendChild(cardEl(S.queue[1], true));
  const top = cardEl(S.queue[0], false);
  deck.appendChild(top);
  attachDrag(top);
}

function updateControls() {
  const undoBtn = document.querySelector('[data-act="undo"]');
  if (undoBtn) undoBtn.disabled = !S.undoStack.length;
  document.querySelectorAll('[data-act="like"],[data-act="nope"]').forEach((b) => (b.disabled = !S.queue.length));
}

function attachDrag(card) {
  let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, active = false;
  const like = card.querySelector('.stamp.like');
  const nope = card.querySelector('.stamp.nope');
  const behind = () => card.previousElementSibling;
  const update = () => {
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 16}deg)`;
    like.style.opacity = Math.max(0, Math.min(1, dx / 90));
    nope.style.opacity = Math.max(0, Math.min(1, -dx / 90));
    const b = behind();
    if (b) { b.style.transition = 'none'; b.style.transform = `scale(${0.95 + 0.05 * Math.min(1, Math.abs(dx) / 140)})`; }
  };
  card.addEventListener('pointerdown', (e) => {
    if (S.busy || e.button > 0) return;
    active = true;
    sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = performance.now();
    card.setPointerCapture(e.pointerId);
    card.style.transition = 'none';
  });
  card.addEventListener('pointermove', (e) => {
    if (!active) return;
    dx = e.clientX - sx;
    dy = (e.clientY - sy) * 0.4;
    update();
  });
  const end = () => {
    if (!active) return;
    active = false;
    const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
    if (Math.abs(dx) > 110 || (Math.abs(dx) > 45 && v > 0.55)) return fly(card, dx > 0, dy);
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) card.classList.toggle('expanded');
    card.style.transition = 'transform .35s cubic-bezier(.2,1.4,.4,1)';
    dx = dy = 0;
    update();
    const b = behind();
    if (b) { b.style.transition = ''; b.style.transform = ''; }
    like.style.opacity = nope.style.opacity = 0;
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

function flyTop(likeIt) {
  const card = document.querySelector('.deck .card:not(.behind)');
  if (!card || S.busy) return;
  card.querySelector(likeIt ? '.stamp.like' : '.stamp.nope').style.opacity = 1;
  fly(card, likeIt, 0);
}

function fly(card, likeIt, dy) {
  S.busy = true;
  vibrate(likeIt ? 12 : 6);
  card.style.transition = 'transform .32s ease-in';
  card.style.transform = `translate(${(likeIt ? 1 : -1) * card.offsetWidth * 1.5}px, ${dy + 40}px) rotate(${likeIt ? 28 : -28}deg)`;
  const b = card.previousElementSibling;
  if (b) { b.style.transition = 'transform .3s ease'; b.style.transform = 'scale(1)'; }
  setTimeout(() => {
    card.remove();
    commitSwipe(card.dataset.id, likeIt);
    S.busy = false;
  }, 300);
}

function promoteNext() {
  const deck = document.querySelector('.deck');
  if (!deck || !S.queue.length) return buildDeck();
  const next = deck.querySelector('.card');
  if (next && next.dataset.id === S.queue[0]) {
    next.classList.remove('behind');
    next.removeAttribute('style');
    attachDrag(next);
  } else {
    deck.innerHTML = '';
    const top = cardEl(S.queue[0], false);
    deck.appendChild(top);
    attachDrag(top);
  }
  if (S.queue[1]) deck.insertBefore(cardEl(S.queue[1], true), deck.firstChild);
  updateControls();
}

function commitSwipe(movieId, likeIt) {
  S.queue = S.queue.filter((id) => id !== movieId);
  S.undoStack.push(movieId);
  if (S.undoStack.length > 20) S.undoStack.shift();
  promoteNext();
  preload();
  updateDoc(userRef(myUid()), { [`likes.${movieId}`]: likeIt }).catch((e) => {
    toast(errText(e));
    S.undoStack.pop();
    S.queue.unshift(movieId);
    buildDeck();
  });
}

async function undo() {
  if (S.busy || !S.undoStack.length) return;
  S.busy = true;
  const movieId = S.undoStack.pop();
  try {
    await updateDoc(userRef(myUid()), { [`likes.${movieId}`]: deleteField() });
    for (const pid of S.pairs.keys()) {
      const m = S.matches.get(matchKey(pid, movieId));
      if (m && !m.lastMessage) await deleteDoc(matchRef(pid, movieId));
    }
    S.queue = [movieId, ...S.queue.filter((id) => id !== movieId)];
    if (document.querySelector('.deck.empty')) return renderSwipe();
    buildDeck();
  } catch (e) {
    S.undoStack.push(movieId);
    toast(errText(e));
  } finally {
    S.busy = false;
  }
}

// ---------- match overlay ----------
function showMatch(pid, movieId) {
  S.shownMatches.add(matchKey(pid, movieId));
  const m = S.movies.get(movieId);
  if (!m) return;
  vibrate([30, 60, 30, 60, 80]);
  const ov = h(`
    <div class="overlay">
      <h2>Это мэтч!</h2>
      <img src="${m.poster}" alt="">
      <p><b>${esc(m.title)}</b><br><span class="muted">Ты и ${esc(partnerName(pid))} оба хотите посмотреть</span></p>
      <div class="actions">
        <button class="btn" data-go>Обсудить</button>
        <button class="btn ghost" data-close>Свайпать дальше</button>
      </div>
    </div>`);
  const confetti = h('<div class="confetti"></div>');
  const colors = ['#fd267a', '#ff6036', '#ffb400', '#14c98b', '#5b8cff'];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + '%';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.8 + 's';
    c.style.animationDelay = Math.random() * 0.5 + 's';
    confetti.appendChild(c);
  }
  const close = () => { ov.remove(); confetti.remove(); };
  ov.querySelector('[data-close]').onclick = close;
  ov.querySelector('[data-go]').onclick = () => { close(); openChat(pid, movieId); };
  document.querySelectorAll('.overlay, .confetti').forEach((el) => el.remove());
  document.body.append(ov, confetti);
  setTimeout(() => confetti.remove(), 4500);
}

// ---------- matches ----------
function renderMatches() {
  if (S.matchFilter !== 'all' && !S.pairs.has(S.matchFilter)) S.matchFilter = 'all';
  const list = [...S.matches.values()]
    .filter((m) => S.matchFilter === 'all' || m.pairId === S.matchFilter)
    .sort((a, b) => (b.lastMessage?.at || b.at) - (a.lastMessage?.at || a.at));
  const many = S.pairs.size > 1;
  const screen = h(`
    <div class="screen">
      <header class="topbar"><h1>Мэтчи</h1><span class="muted small">${list.length}</span></header>
      ${many ? `<div class="filter-row">
        <button class="chip ${S.matchFilter === 'all' ? 'on' : ''}" data-f="all">Все</button>
        ${[...S.pairs.keys()].map((pid) => `<button class="chip ${S.matchFilter === pid ? 'on' : ''}" data-f="${pid}">${esc(partnerName(pid))}</button>`).join('')}
      </div>` : ''}
      <div class="scroll">
        ${list.length ? `<div class="grid">${list.map((x) => {
          const m = S.movies.get(x.movieId);
          if (!m) return '';
          const key = matchKey(x.pairId, x.movieId);
          const unread = unreadOf(key);
          const last = x.lastMessage ? `${x.lastMessage.uid === myUid() ? 'Вы' : esc(partnerName(x.pairId))}: ${esc(x.lastMessage.text)}` : 'Напишите первым';
          return `<button class="match-tile" data-key="${key}">
            <img src="${m.poster}" alt="" loading="lazy">
            <div class="shade"></div>
            ${x.watched ? '<span class="watched">✓ смотрели</span>' : ''}
            ${many ? `<span class="with">${esc(partnerName(x.pairId))}</span>` : ''}
            ${unread ? `<span class="badge">${unread}</span>` : ''}
            <div class="t"><b>${esc(m.title)}</b><span>${last}</span></div>
          </button>`;
        }).join('')}</div>` : `
          <div class="empty">
            <div class="big">💞</div>
            <h3>Пока без мэтчей</h3>
            <p class="muted">${S.pairs.size ? 'Мэтч — это фильм, который понравился вам обоим. Свайпайте дальше.' : `Сначала позови свою пару в разделе «${SECTION}».`}</p>
          </div>`}
      </div>
    </div>`);
  screen.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { S.matchFilter = b.dataset.f; renderMatches(); }));
  screen.querySelectorAll('.match-tile').forEach((b) => (b.onclick = () => {
    const [pid, movieId] = b.dataset.key.split('/');
    openChat(pid, movieId);
  }));
  const keep = document.querySelector('.scroll')?.scrollTop || 0;
  $app.replaceChildren(screen, tabbar());
  screen.querySelector('.scroll').scrollTop = keep;
}

// ---------- chat ----------
const QUICK = ['Смотрим сегодня?', 'Давай в выходные', 'Уже видел(а), но пересмотрю', 'Где посмотреть?', 'Хм, не уверен(а)'];

function setWatchedToggle(el, on) {
  el.classList.toggle('on', on);
  el.textContent = on ? '✓ Посмотрели' : 'Ещё не смотрели';
}
function markRead(pid, movieId) {
  const count = S.matches.get(matchKey(pid, movieId))?.counts?.[partnerUidOf(pid)] || 0;
  if ((S.pairs.get(pid)?.read?.[myUid()]?.[movieId] || 0) >= count) return;
  updateDoc(pairRef(pid), { [`read.${myUid()}.${movieId}`]: count }).catch(() => {});
}

function renderChat() {
  const { pairId: pid, movieId } = S.chat;
  const m = S.movies.get(movieId);
  const match = S.matches.get(matchKey(pid, movieId));
  if (!m || !match) { closeChat(); return render(); }
  const screen = h(`
    <div class="screen">
      <header class="topbar">
        <button class="icon-btn" data-back aria-label="Назад">${ICONS.back}</button>
        <h1></h1>
        <span class="presence" data-presence="${pid}"></span>
      </header>
      <div class="scroll" data-scroll>
        <div class="chat-head">
          <img src="${m.poster}" alt="">
          <div>
            <h2>${esc(m.title)}</h2>
            <div class="muted small">${[m.year, fmtRuntime(m.runtime), m.genres.join(', ')].filter(Boolean).join(' · ')}</div>
            <p>${esc(m.desc)}</p>
            <button class="toggle" data-watched></button>
          </div>
        </div>
        <div class="messages" data-messages><div class="spinner"></div></div>
      </div>
      <div class="quick">${QUICK.map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="composer" data-form>
        <textarea rows="1" name="text" placeholder="Сообщение" maxlength="1000" enterkeyhint="send"></textarea>
        <button type="submit" aria-label="Отправить">${ICONS.send}</button>
      </form>
    </div>`);
  $app.replaceChildren(screen);
  updatePresence();

  screen.querySelector('[data-back]').onclick = () => { closeChat(); render(); };
  const toggle = screen.querySelector('[data-watched]');
  setWatchedToggle(toggle, !!match.watched);
  toggle.onclick = () => {
    const next = !S.matches.get(matchKey(pid, movieId))?.watched;
    setWatchedToggle(toggle, next);
    updateDoc(matchRef(pid, movieId), { watched: next }).catch((e) => toast(errText(e)));
  };

  const form = screen.querySelector('[data-form]');
  const ta = form.text;
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; };
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  const sendText = async (text) => {
    text = text.trim().slice(0, 1000);
    if (!text) return;
    const msg = { uid: myUid(), text, at: Date.now() };
    try {
      await Promise.all([
        addDoc(messagesCol(pid, movieId), msg),
        updateDoc(matchRef(pid, movieId), { lastMessage: msg, [`counts.${myUid()}`]: increment(1) }),
      ]);
    } catch (e) { toast(errText(e)); }
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = ta.value;
    ta.value = '';
    autosize();
    sendText(text);
  };
  screen.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => sendText(b.dataset.q)));

  let first = true;
  S.chatUnsub = onSnapshot(query(messagesCol(pid, movieId), orderBy('at')), (snap) => {
    const box = document.querySelector('[data-messages]');
    if (!box) return;
    if (first) box.innerHTML = snap.empty ? '<p class="muted small center" data-hint>Договоритесь, когда смотрите 🍿</p>' : '';
    for (const ch of snap.docChanges()) {
      if (ch.type !== 'added' || box.querySelector(`[data-mid="${ch.doc.id}"]`)) continue;
      const msg = ch.doc.data();
      box.querySelector('[data-hint]')?.remove();
      box.appendChild(h(`<div class="msg ${msg.uid === myUid() ? 'mine' : ''}" data-mid="${ch.doc.id}">${esc(msg.text)}<time>${fmtTime(msg.at)}</time></div>`));
    }
    first = false;
    const sc = document.querySelector('[data-scroll]');
    if (sc) sc.scrollTop = sc.scrollHeight;
    if (document.visibilityState === 'visible') markRead(pid, movieId);
  }, (e) => toast(errText(e)));
}

// ---------- connections ----------
const inviteUrl = (code) => `${location.origin}/?invite=${code}`;

async function loadMyInvite() {
  try {
    const snap = await getDocs(query(collection(db, 'invites'), where('fromUid', '==', myUid())));
    let best = null;
    for (const d of snap.docs) {
      if (d.data().expiresAt < Date.now()) deleteDoc(d.ref).catch(() => {});
      else if (!best || d.data().expiresAt > best.expiresAt) best = { code: d.id, ...d.data() };
    }
    S.myInvite = best || false;
  } catch {
    S.myInvite = false;
  }
}

function renderPeople() {
  if (S.myInvite === null) {
    S.myInvite = undefined;
    loadMyInvite().then(() => S.view === 'people' && !S.chat && renderPeople());
  }
  const pids = [...S.pairs.keys()];
  const myGenres = new Set(S.profile.genres || []);
  const matchCount = (pid) => [...S.matches.values()].filter((m) => m.pairId === pid).length;
  const inv = S.myInvite;
  const screen = h(`
    <div class="screen">
      <header class="topbar"><h1>${SECTION}</h1></header>
      <div class="scroll">
        ${pids.length ? `<div class="section">
          ${pids.map((pid) => {
            const p = partnerOf(pid) || {};
            const uid = partnerUidOf(pid);
            const common = (p.genres || []).filter((g) => myGenres.has(g));
            const n = matchCount(pid);
            return `<div class="person-row">
              ${avatarHtml(p, '', isOnline(uid))}
              <div class="grow">
                <b>${esc(p.name || '…')}</b>
                <div class="muted">${n} ${plural(n, 'мэтч', 'мэтча', 'мэтчей')}${common.length ? ` · общие жанры: ${esc(common.slice(0, 3).join(', '))}` : ''}</div>
              </div>
              <button class="btn sm ghost link-danger" data-remove="${pid}">Убрать</button>
            </div>`;
          }).join('')}
        </div>` : `<div class="empty" style="flex:none;padding-top:40px">
            <div class="big">💞</div>
            <h3>Здесь пока пусто</h3>
            <p class="muted">Позови человека, с которым выбираешь фильмы. Мэтчи появятся, когда вам обоим понравится один фильм.</p>
          </div>`}
        <div class="section">
          <div class="invite-box">
            ${inv === undefined ? '<div class="spinner"></div>' : inv ? `
              <p>Одноразовая ссылка — сработает для одного человека, действует до ${new Date(inv.expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}.</p>
              <div class="linkbox">${esc(inviteUrl(inv.code))}</div>
              <div class="row">
                <button class="btn sm" data-share>${ICONS.share} Отправить</button>
                <button class="btn sm outline" data-copy>Копировать</button>
              </div>
              <button class="btn ghost small" data-revoke>Отозвать ссылку</button>` : `
              <p>Человек откроет ссылку, войдёт со своим профилем и примет приглашение. Ссылка одноразовая.</p>
              <button class="btn" data-create>Пригласить</button>`}
          </div>
        </div>
      </div>
    </div>`);
  screen.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    const pid = b.dataset.remove;
    if (!confirm(`Убрать ${partnerName(pid)} из «${SECTION}»? Мэтчи с этим человеком пропадут из списка.`)) return;
    try { await deleteDoc(pairRef(pid)); } catch (e) { toast(errText(e)); }
  }));
  screen.querySelector('[data-create]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const code = randomId(16);
    const data = { fromUid: myUid(), fromName: S.profile.name, createdAt: Date.now(), expiresAt: Date.now() + INVITE_TTL };
    try {
      await setDoc(inviteRef(code), data);
      S.myInvite = { code, ...data };
      renderPeople();
      share(inviteUrl(code), `${S.profile.name} зовёт выбирать фильмы вместе в MovixMatch`);
    } catch (err) {
      e.target.disabled = false;
      toast(errText(err));
    }
  });
  screen.querySelector('[data-share]')?.addEventListener('click', () => share(inviteUrl(inv.code), `${S.profile.name} зовёт выбирать фильмы вместе в MovixMatch`));
  screen.querySelector('[data-copy]')?.addEventListener('click', () => copy(inviteUrl(inv.code)));
  screen.querySelector('[data-revoke]')?.addEventListener('click', async () => {
    try { await deleteDoc(inviteRef(inv.code)); S.myInvite = false; renderPeople(); toast('Ссылка отозвана'); }
    catch (e) { toast(errText(e)); }
  });
  $app.replaceChildren(screen, tabbar());
}

// ---------- profile ----------
function renderProfile() {
  const p = S.profile;
  const my = likes(p);
  const swiped = Object.keys(my).length;
  const liked = Object.values(my).filter(Boolean).length;
  const genres = new Set(p.genres || []);
  const deckLeft = computeDeck().length;
  const screen = h(`
    <div class="screen">
      <header class="topbar"><h1>Профиль</h1></header>
      <div class="scroll">
        <div class="profile-head">${avatarHtml(p, 'xl')}<b>${esc(p.name)}</b></div>
        <div class="section">
          <h3>Имя</h3>
          <form class="name-edit" data-name><input name="name" value="${esc(p.name)}" maxlength="30"><button class="btn sm outline" type="submit">Сохранить</button></form>
        </div>
        <div class="section">
          <h3>Любимые жанры</h3>
          <div class="chips">${S.genres.map((g) => `<button class="chip ${genres.has(g) ? 'on' : ''}" data-g="${esc(g)}">${esc(cap(g))}</button>`).join('')}</div>
          <p class="muted small" style="margin:10px 0 0">В колоде осталось ${deckLeft} ${plural(deckLeft, 'фильм', 'фильма', 'фильмов')} из выбранных жанров.</p>
        </div>
        <div class="section">
          <h3>Статистика</h3>
          <div class="stat-row"><span>Просмотрено карточек</span><b>${swiped}</b></div>
          <div class="stat-row"><span>Лайков</span><b>${liked}</b></div>
          <div class="stat-row"><span>Мэтчей</span><b>${S.matches.size}</b></div>
        </div>
        <div class="section">
          <h3>На телефон</h3>
          <p class="muted small" style="margin:0 0 10px">iPhone: Safari → «Поделиться» → «На экран „Домой“». Android: меню Chrome → «Установить приложение».</p>
          <button class="btn sm outline" data-install style="display:none">Установить</button>
        </div>
        <p class="tmdb">Данные о фильмах и постеры — TMDB. Этот продукт использует TMDB API, но не одобрен и не сертифицирован TMDB.</p>
      </div>
    </div>`);
  screen.querySelector('[data-name]').onsubmit = async (e) => {
    e.preventDefault();
    const name = cleanName(e.target.name.value);
    if (!name || name === p.name) return;
    try { await updateDoc(userRef(myUid()), { name }); toast('Имя сохранено'); renderProfile(); }
    catch (err) { toast(errText(err)); }
  };
  screen.querySelectorAll('[data-g]').forEach((b) => (b.onclick = async () => {
    const g = b.dataset.g;
    const next = new Set(S.profile.genres || []);
    next.has(g) ? next.delete(g) : next.add(g);
    if (!next.size) return toast('Оставь хотя бы один жанр');
    S.profile = { ...S.profile, genres: [...next] };
    S.queue = computeDeck();
    renderProfile();
    updateDoc(userRef(myUid()), { genres: [...next] }).catch((e) => toast(errText(e)));
  }));
  const installBtn = screen.querySelector('[data-install]');
  if (deferredInstall) {
    installBtn.style.display = '';
    installBtn.onclick = () => { deferredInstall.prompt(); deferredInstall = null; installBtn.style.display = 'none'; };
  }
  const keep = document.querySelector('.scroll')?.scrollTop || 0;
  $app.replaceChildren(screen, tabbar());
  screen.querySelector('.scroll').scrollTop = keep;
}

// ---------- keyboard (desktop) ----------
document.addEventListener('keydown', (e) => {
  if (!S.ready || S.chat || S.view !== 'swipe' || e.target.matches('input, textarea')) return;
  if (document.querySelector('.overlay')) {
    if (e.key === 'Escape') document.querySelector('.overlay [data-close]')?.click();
    return;
  }
  if (e.key === 'ArrowRight') flyTop(true);
  if (e.key === 'ArrowLeft') flyTop(false);
  if (e.key === 'Backspace' || (e.key === 'z' && (e.metaKey || e.ctrlKey))) undo();
});

// ---------- PWA ----------
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
if ('serviceWorker' in navigator && !LOCAL) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ---------- start ----------
(async function start() {
  // invite links are the only URLs with parameters; read once, then clean the address bar
  const params = new URLSearchParams(location.search);
  S.pendingInvite = params.get('invite') || null;
  if (location.search || location.hash) history.replaceState(null, '', '/');

  spinner();
  try {
    buildCatalog(await fetch('/movies.json').then((r) => r.json()));
  } catch {
    $app.innerHTML = '<div class="screen"><div class="empty"><div class="big">📡</div><h3>Не удалось загрузиться</h3><p class="muted">Проверьте интернет и обновите страницу.</p></div></div>';
    return;
  }
  if (!CONFIGURED) return renderSetup();
  onAuthStateChanged(auth, onAuth);
})();
