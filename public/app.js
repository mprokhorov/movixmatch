// MovixMatch client — vanilla JS, no build step. Sync and storage: Firebase (Firestore + anonymous auth).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, connectFirestoreEmulator, doc, collection, query, orderBy,
  getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, runTransaction, deleteField, increment, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const SESSION_KEY = 'movix.session';
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const CONFIGURED = LOCAL || !String(firebaseConfig.apiKey).startsWith('PASTE');

const ICONS = {
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.8 4.4 7.2C19.5 16.4 12 21 12 21z"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>',
  cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="6" y="3" width="12" height="17" rx="2.5"/><path d="M3.5 7.5v10a3 3 0 003 3h8"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 12a8 8 0 01-11.6 7.1L4 20l1-4.2A8 8 0 1120 12z"/><path d="M12 15.2s-3-1.8-3-3.8c0-1 .8-1.7 1.6-1.7.6 0 1.1.3 1.4.8.3-.5.8-.8 1.4-.8.8 0 1.6.7 1.6 1.7 0 2-3 3.8-3 3.8z" fill="currentColor" stroke="none"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M17 14.3c2.3.2 4 1.8 4.5 4.2"/></svg>',
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
const authReady = !CONFIGURED ? Promise.resolve(null) : new Promise((resolve, reject) => {
  const off = onAuthStateChanged(auth, (u) => {
    if (u) { off(); resolve(u); } else signInAnonymously(auth).catch(reject);
  });
});

const roomRef = (rid = S.session.roomId) => doc(db, 'rooms', rid);
const memberRef = (role, rid = S.session.roomId) => doc(db, 'rooms', rid, 'members', role);
const matchRef = (movieId) => doc(db, 'rooms', S.session.roomId, 'matches', movieId);
const messagesCol = (movieId) => collection(db, 'rooms', S.session.roomId, 'matches', movieId, 'messages');

// ---------- state ----------
const S = {
  uid: null,
  session: loadSession(), // { roomId, role: 'owner' | 'partner' }
  movies: new Map(),
  room: null,
  members: { owner: null, partner: null },
  matches: new Map(),
  matchesLoaded: false,
  inviteCode: null,
  ownerKey: null,
  queue: [],
  undoStack: [],
  shownMatches: new Set(),
  pendingMatches: new Set(),
  unsubs: [],
  chatUnsub: null,
  busy: false,
  ready: false,
};

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
function saveSession(s) {
  S.session = s;
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch {}
}

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmtRuntime = (m) => (m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60 ? (m % 60) + ' мин' : ''}` : `${m} мин`).trim();
const initial = (name) => esc((name || '?').trim().charAt(0).toUpperCase());
const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 30);
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
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2600);
}
function vibrate(p) { try { navigator.vibrate?.(p); } catch {} }
function errText(e) {
  if (e?.code === 'permission-denied') return 'Нет доступа';
  if (e?.code === 'unavailable') return 'Нет связи с сервером';
  return e?.message || 'Что-то пошло не так';
}

const myRole = () => S.session.role;
const otherRole = () => (S.session.role === 'owner' ? 'partner' : 'owner');
const nameOf = (role) => (role === 'owner' ? S.room?.ownerName : S.room?.partnerName) || '';
const likesOf = (role) => S.members[role]?.likes || {};
const swipedOf = (role) => Object.keys(likesOf(role)).length;
const isOnline = (role) => role === myRole() || Date.now() - (S.members[role]?.lastSeen || 0) < 90_000;
const me = () => ({ role: myRole(), name: nameOf(myRole()) });
const partner = () => (S.room?.partnerUid ? { role: 'partner', name: nameOf(otherRole()), online: isOnline(otherRole()) } : null);
const hasPartner = () => !!S.room?.partnerUid;
const unreadOf = (movieId) => {
  const m = S.matches.get(movieId);
  const read = S.members[myRole()]?.lastRead?.[movieId] || 0;
  return Math.max(0, (m?.counts?.[otherRole()] || 0) - read);
};
const base = () => location.origin + location.pathname.replace(/index\.html$/, '');
const inviteUrl = () => (S.inviteCode ? `${base()}#/join/${S.session.roomId}/${S.inviteCode}` : '');
const recoveryUrl = () => (myRole() === 'owner' ? (S.ownerKey ? `${base()}#/login/${S.session.roomId}/${S.ownerKey}` : '') : inviteUrl());

async function share(url, text) {
  if (!url) return;
  if (navigator.share) {
    try { await navigator.share({ title: 'MovixMatch', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copy(url);
}
async function copy(text) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); toast('Ссылка скопирована'); }
  catch { prompt('Скопируйте ссылку:', text); }
}

// ---------- deck order ----------
function seededOrder(seed) {
  // same order for both partners: FNV-1a hash of the room id seeds a xorshift shuffle
  let x = 2166136261;
  for (const ch of seed) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; }
  x = x || 1;
  const rand = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const ids = [...S.movies.keys()];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}
function computeDeck() {
  const mine = likesOf(myRole());
  const theirs = likesOf(otherRole());
  const order = seededOrder(S.session.roomId).filter((id) => !(id in mine));
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
function refreshQueue() {
  // keep the two cards on screen stable, reorder everything behind them
  const deck = computeDeck();
  const visible = [...document.querySelectorAll('.deck .card')].map((c) => c.dataset.id).reverse();
  const keep = visible.filter((id) => deck.includes(id));
  S.queue = [...keep, ...deck.filter((id) => !keep.includes(id))];
  preload();
}

// ---------- routing ----------
async function route() {
  const [name, a, b] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!CONFIGURED) return renderSetup();
  if (name === 'join' && a && b) return renderJoin(a, b);
  if (name === 'login' && a && b) return ownerLogin(a, b);
  if (!S.session) return renderWelcome();
  if (!S.ready) return boot();
  if (name === 'chat' && a && S.movies.has(a)) return renderChat(a);
  if (name === 'matches') return renderMatches();
  if (name === 'couple') return renderCouple();
  return renderSwipe();
}
function go(hash, replace = false) {
  if (location.hash === hash) return route();
  replace ? location.replace(hash) : (location.hash = hash);
}
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/chat/')) closeChatListener();
  route();
});
function currentTab() {
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  return ['matches', 'couple', 'chat'].includes(name) ? name : 'swipe';
}
const spinner = () => ($app.innerHTML = '<div class="screen"><div class="spinner"></div></div>');

// ---------- session lifecycle ----------
function teardown() {
  S.unsubs.forEach((u) => u());
  S.unsubs = [];
  closeChatListener();
  Object.assign(S, {
    room: null, members: { owner: null, partner: null }, matches: new Map(), matchesLoaded: false,
    inviteCode: null, ownerKey: null, queue: [], undoStack: [], shownMatches: new Set(), ready: false,
  });
}
let kicked = false;
function kick(msg) {
  // lost access (e.g. the seat was claimed on another device): drop the session and start clean.
  // Deferred + full reload: tearing listeners down inside their own error callback breaks the SDK.
  if (kicked) return;
  kicked = true;
  saveSession(null);
  try { sessionStorage.setItem('movix.toast', msg); } catch {}
  setTimeout(() => { location.replace(base() + '#/'); location.reload(); }, 0);
}

async function boot() {
  spinner();
  try {
    const snap = await getDoc(roomRef());
    if (!snap.exists()) return kick('Пара не найдена');
    S.room = snap.data();
    const [mo, mp] = await Promise.all([getDoc(memberRef('owner')), getDoc(memberRef('partner'))]);
    S.members.owner = mo.data() || null;
    S.members.partner = mp.data() || null;
    if (myRole() === 'owner') await loadOwnerSecrets();
    else await loadInviteCode();
    subscribe();
    S.queue = computeDeck();
    preload();
    S.ready = true;
    heartbeat();
    route();
  } catch (e) {
    if (e.code === 'permission-denied') return kick('Вход выполнен на другом устройстве — открой ссылку-приглашение ещё раз');
    $app.innerHTML = `<div class="screen"><div class="empty"><div class="big">📡</div><h3>Нет связи</h3><p class="muted">${esc(errText(e))}</p><button class="btn sm" id="retry">Повторить</button></div></div>`;
    $app.querySelector('#retry').onclick = boot;
  }
}

async function loadInviteCode() {
  const inv = await getDocs(collection(db, 'rooms', S.session.roomId, 'invites'));
  S.inviteCode = inv.docs[0]?.id || null;
}
async function loadOwnerSecrets() {
  const [, keys] = await Promise.all([loadInviteCode(), getDocs(collection(db, 'rooms', S.session.roomId, 'keys'))]);
  S.ownerKey = keys.docs[0]?.id || null;
}

function subscribe() {
  const onErr = (e) => {
    if (e.code === 'permission-denied') kick('Вход выполнен на другом устройстве — открой ссылку ещё раз');
  };
  S.unsubs.push(onSnapshot(roomRef(), (snap) => {
    const hadPartner = hasPartner();
    S.room = snap.data();
    if (!hadPartner && hasPartner() && myRole() === 'owner') toast(`${S.room.partnerName} в паре! Свайпайте 🍿`);
    onPresenceChanged();
  }, onErr));

  for (const role of ['owner', 'partner']) {
    S.unsubs.push(onSnapshot(memberRef(role), (snap) => {
      S.members[role] = snap.data() || null;
      checkMatches();
      if (role === otherRole()) {
        onPresenceChanged();
        if (currentTab() === 'swipe') {
          refreshQueue();
          if (!document.querySelector('.deck .card')) renderSwipe();
        }
      }
      updateBadges();
      if (currentTab() === 'couple') renderCouple();
    }, onErr));
  }

  S.unsubs.push(onSnapshot(collection(db, 'rooms', S.session.roomId, 'matches'), (snap) => {
    const first = !S.matchesLoaded;
    S.matchesLoaded = true;
    for (const ch of snap.docChanges()) {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        S.matches.delete(id);
        S.shownMatches.delete(id);
        continue;
      }
      const prev = S.matches.get(id);
      const data = ch.doc.data();
      S.matches.set(id, data);
      if (ch.type === 'added') {
        if (first) S.shownMatches.add(id);
        else if (!S.shownMatches.has(id)) showMatch(id);
      }
      if (ch.type === 'modified') {
        const lm = data.lastMessage;
        if (lm && lm.at !== prev?.lastMessage?.at && lm.role !== myRole() && location.hash !== `#/chat/${id}`) {
          vibrate(20);
          toast(`${nameOf(lm.role)} · ${S.movies.get(id)?.title}: ${lm.text}`);
        }
        const t = document.querySelector(`[data-watched="${id}"]`);
        if (t) setWatchedToggle(t, !!data.watched);
        if (location.hash === `#/chat/${id}` && document.visibilityState === 'visible') markRead(id);
      }
    }
    checkMatches();
    updateBadges();
    if (currentTab() === 'matches') renderMatches();
  }, onErr));
}

// a match exists once both seats liked the same film; whichever client notices first writes it
function checkMatches() {
  if (!S.matchesLoaded || !hasPartner()) return;
  const mine = likesOf(myRole());
  const theirs = likesOf(otherRole());
  for (const id of Object.keys(mine)) {
    if (mine[id] !== true || theirs[id] !== true || S.matches.has(id) || S.pendingMatches.has(id)) continue;
    S.pendingMatches.add(id);
    runTransaction(db, async (tx) => {
      const ref = matchRef(id);
      if (!(await tx.get(ref)).exists()) tx.set(ref, { at: Date.now(), watched: false, counts: { owner: 0, partner: 0 } });
    }).catch(() => {}).finally(() => S.pendingMatches.delete(id));
  }
}

let beatTimer;
function heartbeat() {
  clearInterval(beatTimer);
  const beat = () => {
    if (document.visibilityState === 'visible' && S.ready) {
      updateDoc(memberRef(myRole()), { lastSeen: Date.now() }).catch(() => {});
    }
  };
  beat();
  beatTimer = setInterval(() => { beat(); onPresenceChanged(); }, 45_000);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.ready) heartbeat();
});

// ---------- shared chrome ----------
function badgeCount() {
  const unread = [...S.matches.keys()].reduce((n, id) => n + unreadOf(id), 0);
  return unread || S.matches.size;
}
function tabbar(active) {
  const n = badgeCount();
  const el = h(`
    <nav class="tabbar">
      <button data-tab="swipe" class="${active === 'swipe' ? 'active' : ''}">${ICONS.cards}Фильмы</button>
      <button data-tab="matches" class="${active === 'matches' ? 'active' : ''}">${ICONS.chat}Мэтчи
        <span class="badge" data-badge style="${n ? '' : 'display:none'}">${n}</span></button>
      <button data-tab="couple" class="${active === 'couple' ? 'active' : ''}">${ICONS.users}Пара</button>
    </nav>`);
  el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => go(`#/${b.dataset.tab}`)));
  return el;
}
function updateBadges() {
  const n = badgeCount();
  document.querySelectorAll('[data-badge]').forEach((b) => {
    b.textContent = n;
    b.style.display = n ? '' : 'none';
  });
}
function presenceHtml() {
  const p = partner();
  return p ? `<span class="dot ${p.online ? 'on' : ''}"></span>${esc(p.name)}` : 'ждём партнёра';
}
function onPresenceChanged() {
  document.querySelectorAll('[data-presence]').forEach((el) => (el.innerHTML = presenceHtml()));
  if (hasPartner()) document.querySelector('[data-invite-banner]')?.remove();
}

// ---------- setup (config missing) ----------
function renderSetup() {
  $app.replaceChildren(h(`
    <div class="screen"><div class="empty">
      <div class="big">🛠️</div>
      <h3>Firebase ещё не подключён</h3>
      <p class="muted">Вставь конфиг веб-приложения в <code>public/firebase-config.js</code> и задеплой заново — инструкция в DEPLOY.md.</p>
    </div></div>`));
}

// ---------- welcome / create ----------
function renderWelcome() {
  const sample = ['tt3783958', 'tt1375666', 'tt0245429'].map((id) => `posters/${id}.jpg`);
  $app.replaceChildren(h(`
    <div class="screen">
      <div class="hero">
        <div class="poster-fan">${sample.map((src) => `<img src="${src}" alt="">`).join('')}</div>
        <div class="logo">Movix<span>Match</span></div>
        <h2>Хватит час выбирать фильм. Свайпайте вдвоём — смотрите то, что понравилось обоим.</h2>
        <ul class="steps">
          <li><b>1</b>Создай пару и отправь ссылку своей половинке</li>
          <li><b>2</b>Свайпайте фильмы: вправо — хочу, влево — нет</li>
          <li><b>3</b>Совпало? Это мэтч — обсуждайте и включайте</li>
        </ul>
        <form class="form" id="create">
          <input class="field" name="name" placeholder="Как тебя зовут?" autocomplete="given-name" maxlength="30" required>
          <button class="btn" type="submit">Создать пару</button>
        </form>
      </div>
    </div>`));
  $app.querySelector('#create').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const name = cleanName(e.target.name.value);
    if (!name) return;
    btn.disabled = true;
    try {
      const user = await authReady;
      const rid = randomId(8);
      const code = randomId(10);
      const key = randomId(20);
      await setDoc(roomRef(rid), { ownerUid: user.uid, ownerName: name, partnerUid: null, partnerName: null, createdAt: Date.now() });
      await Promise.all([
        setDoc(doc(db, 'rooms', rid, 'invites', code), { ownerName: name, createdAt: Date.now() }),
        setDoc(doc(db, 'rooms', rid, 'keys', key), { createdAt: Date.now() }),
        setDoc(memberRef('owner', rid), { name, likes: {}, lastRead: {}, lastSeen: Date.now() }),
      ]);
      teardown();
      saveSession({ roomId: rid, role: 'owner' });
      go('#/couple');
      setTimeout(() => toast('Пара создана! Отправь ссылку-приглашение 💌'), 600);
    } catch (err) {
      toast(errText(err));
      btn.disabled = false;
    }
  };
}

// ---------- join (partner) ----------
async function renderJoin(roomId, code) {
  spinner();
  if (S.session?.roomId === roomId) return go('#/swipe', true);
  let info;
  try {
    await authReady;
    const snap = await getDoc(doc(db, 'rooms', roomId, 'invites', code));
    if (!snap.exists()) throw new Error('Ссылка-приглашение недействительна');
    info = snap.data();
  } catch (e) {
    $app.replaceChildren(h(`<div class="screen"><div class="empty"><div class="big">💔</div><h3>Ссылка не работает</h3><p class="muted">${esc(e.code ? errText(e) : e.message)}. Попроси новую ссылку.</p><button class="btn sm" onclick="location.hash='#/'">На главную</button></div></div>`));
    return;
  }
  $app.replaceChildren(h(`
    <div class="screen">
      <div class="hero">
        <div class="poster-fan">${['tt0332280', 'tt5311514', 'tt2194499'].map((id) => `<img src="posters/${id}.jpg" alt="">`).join('')}</div>
        <div class="logo">Movix<span>Match</span></div>
        <h2>${esc(info.ownerName)} зовёт тебя выбирать фильм вместе 💌</h2>
        <p class="muted">Свайпайте карточки: когда фильм понравится вам обоим, будет мэтч. Уже в паре и зашёл(а) с нового устройства? Просто введи имя ещё раз.</p>
        <form class="form" id="join">
          <input class="field" name="name" placeholder="Твоё имя" maxlength="30" required>
          <button class="btn" type="submit">Присоединиться</button>
        </form>
      </div>
    </div>`));
  $app.querySelector('#join').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const name = cleanName(e.target.name.value);
    if (!name) return;
    btn.disabled = true;
    try {
      const user = await authReady;
      const batch = writeBatch(db);
      batch.set(doc(db, 'rooms', roomId, 'joins', user.uid), { code, at: Date.now() });
      batch.update(roomRef(roomId), { partnerUid: user.uid, partnerName: name });
      await batch.commit();
      await setDoc(memberRef('partner', roomId), { name, lastSeen: Date.now() }, { merge: true });
      teardown();
      saveSession({ roomId, role: 'partner' });
      go('#/swipe', true);
      setTimeout(() => toast(`Готово! Твоя пара: ${info.ownerName}. Свайпай 🍿`), 600);
    } catch (err) {
      toast(errText(err));
      btn.disabled = false;
    }
  };
}

// ---------- owner login on a new device ----------
async function ownerLogin(roomId, key) {
  spinner();
  try {
    const user = await authReady;
    const batch = writeBatch(db);
    batch.set(doc(db, 'rooms', roomId, 'ownerClaims', user.uid), { key, at: Date.now() });
    batch.update(roomRef(roomId), { ownerUid: user.uid });
    await batch.commit();
    teardown();
    saveSession({ roomId, role: 'owner' });
    go('#/swipe', true);
    setTimeout(() => toast('С возвращением 👋'), 600);
  } catch (e) {
    $app.replaceChildren(h(`<div class="screen"><div class="empty"><div class="big">🔒</div><h3>Ссылка входа не подошла</h3><p class="muted">${esc(errText(e))}</p><button class="btn sm" onclick="location.hash='#/'">На главную</button></div></div>`));
  }
}

// ---------- swipe ----------
function renderSwipe() {
  const screen = h(`
    <div class="screen">
      <header class="topbar">
        <div class="logo">Movix<span>Match</span></div>
        <span class="pill" data-presence>${presenceHtml()}</span>
      </header>
      ${!hasPartner() && myRole() === 'owner' ? `
        <div class="banner" data-invite-banner>
          <span class="grow">Пригласи свою половинку — мэтчи появятся, когда вы оба свайпнете</span>
          <button class="btn sm" data-invite>${ICONS.share}</button>
        </div>` : ''}
      <div class="deck-wrap">
        <div class="deck"></div>
        <div class="controls">
          <button class="round nope" data-act="nope" aria-label="Не хочу">${ICONS.x}</button>
          <button class="round small" data-act="undo" aria-label="Вернуть">${ICONS.undo}</button>
          <button class="round like" data-act="like" aria-label="Хочу">${ICONS.heart}</button>
        </div>
      </div>
    </div>`);
  screen.querySelector('[data-invite]')?.addEventListener('click', () => share(inviteUrl(), `${me().name} зовёт выбрать фильм вместе в MovixMatch`));
  screen.querySelector('[data-act="nope"]').onclick = () => flyTop(false);
  screen.querySelector('[data-act="like"]').onclick = () => flyTop(true);
  screen.querySelector('[data-act="undo"]').onclick = undo;
  $app.replaceChildren(screen, tabbar('swipe'));
  buildDeck();
}

function cardEl(movieId, behind) {
  const m = S.movies.get(movieId);
  return h(`
    <div class="card ${behind ? 'behind' : ''}" data-id="${m.id}">
      <img class="poster" src="${m.poster}" alt="" draggable="false">
      <div class="shade"></div>
      <div class="stamp like">Хочу</div>
      <div class="stamp nope">Нет</div>
      <div class="info">
        <h3>${esc(m.title)}</h3>
        ${m.original !== m.title ? `<div class="orig">${esc(m.original)}</div>` : ''}
        <div class="meta">
          <span class="tag">${m.year}</span>
          <span class="tag">${fmtRuntime(m.runtime)}</span>
          ${m.genres.map((g) => `<span class="tag">${esc(g)}</span>`).join('')}
        </div>
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
    const n = S.matches.size;
    deck.replaceWith(h(`
      <div class="empty deck">
        <div class="big">🎬</div>
        <h3>Фильмы закончились</h3>
        <p class="muted">${n ? `У вас ${n} ${plural(n, 'мэтч', 'мэтча', 'мэтчей')} — самое время выбрать!` : 'Подождём, пока партнёр досвайпает — мэтчи появятся сами.'}</p>
        ${n ? '<button class="btn sm" onclick="location.hash=\'#/matches\'">К мэтчам</button>' : ''}
      </div>`));
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
  const empty = !S.queue.length;
  document.querySelectorAll('[data-act="like"],[data-act="nope"]').forEach((b) => (b.disabled = empty));
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
    if (b) {
      const k = Math.min(1, Math.abs(dx) / 140);
      b.style.transition = 'none';
      b.style.transform = `scale(${0.94 + 0.06 * k}) translateY(${14 - 14 * k}px)`;
      b.style.filter = `brightness(${0.7 + 0.3 * k})`;
    }
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
    if (b) { b.style.transition = ''; b.style.transform = ''; b.style.filter = ''; }
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
  const w = card.offsetWidth;
  card.style.transition = 'transform .32s ease-in';
  card.style.transform = `translate(${(likeIt ? 1 : -1) * w * 1.5}px, ${dy + 40}px) rotate(${likeIt ? 28 : -28}deg)`;
  const b = card.previousElementSibling;
  if (b) { b.style.transition = 'transform .3s ease, filter .3s ease'; b.style.transform = 'scale(1) translateY(0)'; b.style.filter = 'brightness(1)'; }
  setTimeout(() => {
    const movieId = card.dataset.id;
    card.remove();
    commitSwipe(movieId, likeIt);
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
  // the local snapshot fires immediately, so checkMatches() runs without waiting for the network
  updateDoc(memberRef(myRole()), { [`likes.${movieId}`]: likeIt }).catch((e) => {
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
    await updateDoc(memberRef(myRole()), { [`likes.${movieId}`]: deleteField() });
    const m = S.matches.get(movieId);
    if (m && !m.lastMessage) await deleteDoc(matchRef(movieId));
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

function preload() {
  S.queue.slice(0, 4).forEach((id) => {
    const m = S.movies.get(id);
    if (m) new Image().src = m.poster;
  });
}

// ---------- match overlay ----------
function showMatch(movieId) {
  S.shownMatches.add(movieId);
  const m = S.movies.get(movieId);
  if (!m) return;
  vibrate([30, 60, 30, 60, 80]);
  const ov = h(`
    <div class="overlay">
      <h2>Это мэтч!</h2>
      <img src="${m.poster}" alt="">
      <p><b>${esc(m.title)}</b><br><span class="muted">${esc(nameOf('owner'))} и ${esc(nameOf('partner'))} оба хотят посмотреть</span></p>
      <div class="actions">
        <button class="btn" data-go>Обсудить 💬</button>
        <button class="btn ghost" data-close>Свайпать дальше</button>
      </div>
    </div>`);
  const confetti = h('<div class="confetti"></div>');
  const colors = ['#ff4f7b', '#ff8a5c', '#ffd166', '#3ddc97', '#7aa2ff', '#ffffff'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + '%';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.8 + 's';
    c.style.animationDelay = Math.random() * 0.5 + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    confetti.appendChild(c);
  }
  const close = () => { ov.remove(); confetti.remove(); };
  ov.querySelector('[data-close]').onclick = close;
  ov.querySelector('[data-go]').onclick = () => { close(); go(`#/chat/${movieId}`); };
  document.querySelectorAll('.overlay, .confetti').forEach((el) => el.remove());
  document.body.append(ov, confetti);
  setTimeout(() => confetti.remove(), 4500);
}

// ---------- matches list ----------
function sortedMatches() {
  return [...S.matches.entries()]
    .map(([movieId, d]) => ({ movieId, ...d }))
    .sort((a, b) => (b.lastMessage?.at || b.at) - (a.lastMessage?.at || a.at));
}
function renderMatches() {
  const list = sortedMatches();
  const screen = h(`
    <div class="screen">
      <header class="topbar"><h1>Мэтчи</h1><span class="pill">${list.length} ${plural(list.length, 'фильм', 'фильма', 'фильмов')}</span></header>
      <div class="scroll">
        ${list.length ? `<div class="grid">${list.map((x) => {
          const m = S.movies.get(x.movieId);
          if (!m) return '';
          const unread = unreadOf(x.movieId);
          const last = x.lastMessage ? `${x.lastMessage.role === myRole() ? 'Вы' : esc(nameOf(x.lastMessage.role))}: ${esc(x.lastMessage.text)}` : 'Напишите первым 💬';
          return `<button class="match-tile" data-id="${m.id}">
            <img src="${m.poster}" alt="" loading="lazy">
            <div class="shade"></div>
            ${x.watched ? '<span class="watched">✓ смотрели</span>' : ''}
            ${unread ? `<span class="badge">${unread}</span>` : ''}
            <div class="t"><b>${esc(m.title)}</b><span>${last}</span></div>
          </button>`;
        }).join('')}</div>` : `
          <div class="empty">
            <div class="big">💞</div>
            <h3>Пока без мэтчей</h3>
            <p class="muted">${hasPartner() ? 'Продолжайте свайпать — как только фильм понравится обоим, он появится здесь.' : 'Сначала пригласи партнёра во вкладке «Пара».'}</p>
          </div>`}
      </div>
    </div>`);
  screen.querySelectorAll('.match-tile').forEach((b) => (b.onclick = () => go(`#/chat/${b.dataset.id}`)));
  const keep = document.querySelector('.scroll')?.scrollTop || 0;
  $app.replaceChildren(screen, tabbar('matches'));
  screen.querySelector('.scroll').scrollTop = keep;
}

// ---------- chat ----------
const QUICK = ['Смотрим сегодня? 🍿', 'Давай в выходные', 'Я уже видел(а), но пересмотрю', 'Где посмотреть?', 'Хм, не уверен(а) 🤔'];

function setWatchedToggle(el, on) {
  el.classList.toggle('on', on);
  el.innerHTML = on ? '✓ Посмотрели' : '○ Ещё не смотрели';
}
function closeChatListener() {
  S.chatUnsub?.();
  S.chatUnsub = null;
}
function markRead(movieId) {
  const count = S.matches.get(movieId)?.counts?.[otherRole()] || 0;
  if ((S.members[myRole()]?.lastRead?.[movieId] || 0) >= count) return;
  updateDoc(memberRef(myRole()), { [`lastRead.${movieId}`]: count }).catch(() => {});
}

function renderChat(movieId) {
  const m = S.movies.get(movieId);
  if (!S.matches.has(movieId)) return go('#/matches', true);
  const screen = h(`
    <div class="screen">
      <header class="topbar">
        <button class="icon-btn" data-back aria-label="Назад">${ICONS.back}</button>
        <h1>Обсуждение</h1>
        <span class="pill" data-presence>${presenceHtml()}</span>
      </header>
      <div class="scroll" data-scroll>
        <div class="chat-head">
          <img src="${m.poster}" alt="">
          <div>
            <h2>${esc(m.title)}</h2>
            <div class="muted small">${m.year} · ${fmtRuntime(m.runtime)} · ${m.genres.map(esc).join(', ')}</div>
            <p>${esc(m.desc)}</p>
            <button class="toggle" data-watched="${m.id}"></button>
          </div>
        </div>
        <div class="messages" data-messages><div class="spinner"></div></div>
      </div>
      <div class="quick">${QUICK.map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="composer" data-form>
        <textarea rows="1" name="text" placeholder="Сообщение…" maxlength="1000" enterkeyhint="send"></textarea>
        <button type="submit" aria-label="Отправить">${ICONS.send}</button>
      </form>
    </div>`);
  $app.replaceChildren(screen);

  screen.querySelector('[data-back]').onclick = () => (history.length > 1 ? history.back() : go('#/matches'));
  const toggle = screen.querySelector('[data-watched]');
  setWatchedToggle(toggle, !!S.matches.get(movieId).watched);
  toggle.onclick = () => {
    const next = !S.matches.get(movieId)?.watched;
    setWatchedToggle(toggle, next);
    updateDoc(matchRef(movieId), { watched: next }).catch((e) => toast(errText(e)));
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
    const msg = { role: myRole(), text, at: Date.now() };
    try {
      await Promise.all([
        addDoc(messagesCol(movieId), msg),
        updateDoc(matchRef(movieId), { lastMessage: msg, [`counts.${myRole()}`]: increment(1) }),
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

  closeChatListener();
  let first = true;
  S.chatUnsub = onSnapshot(query(messagesCol(movieId), orderBy('at')), (snap) => {
    const box = document.querySelector('[data-messages]');
    if (!box) return;
    if (first) {
      box.innerHTML = snap.empty ? '<p class="muted small center" data-hint>Это мэтч! Договоритесь, когда смотрите 🍿</p>' : '';
    }
    for (const ch of snap.docChanges()) {
      if (ch.type === 'added') appendMessage(box, ch.doc.id, ch.doc.data());
    }
    first = false;
    scrollChat();
    if (document.visibilityState === 'visible') markRead(movieId);
  }, (e) => toast(errText(e)));
}

function appendMessage(box, id, msg) {
  if (box.querySelector(`[data-mid="${id}"]`)) return;
  box.querySelector('[data-hint]')?.remove();
  const mine = msg.role === myRole();
  box.appendChild(h(`<div class="msg ${mine ? 'mine' : ''}" data-mid="${id}">${esc(msg.text)}<time>${fmtTime(msg.at)}</time></div>`));
}
function scrollChat() {
  const sc = document.querySelector('[data-scroll]');
  if (sc) sc.scrollTop = sc.scrollHeight;
}

// ---------- couple ----------
function renderCouple() {
  const total = S.movies.size;
  const isOwner = myRole() === 'owner';
  const people = [
    { role: 'owner', name: nameOf('owner') },
    hasPartner() ? { role: 'partner', name: nameOf('partner') } : null,
  ];
  const person = (u) => u
    ? `<div class="person"><div class="avatar">${initial(u.name)}<span class="dot ${isOnline(u.role) ? 'on' : ''}"></span></div><b>${esc(u.name)}${u.role === myRole() ? ' (ты)' : ''}</b></div>`
    : `<div class="person"><div class="avatar empty-av">?</div><span class="muted">ждём…</span></div>`;
  const bar = (u) => u ? `
    <div class="stat-row"><span>${esc(u.name)}</span><span class="muted">${swipedOf(u.role)} / ${total}</span></div>
    <div class="progress"><i style="width:${Math.round((swipedOf(u.role) / total) * 100)}%"></i></div>` : '';

  const screen = h(`
    <div class="screen">
      <header class="topbar"><h1>Ваша пара</h1></header>
      <div class="scroll">
        <div class="people">${person(people[0])}<div class="heart">💞</div>${person(people[1])}</div>
        ${isOwner ? `
          <div class="card-block">
            <h3>${hasPartner() ? 'Ссылка-приглашение' : 'Пригласи свою половинку'}</h3>
            <p class="muted small">${hasPartner() ? `${esc(nameOf('partner'))} уже в паре. По этой же ссылке можно войти заново с другого устройства.` : 'Отправь ссылку — откроется MovixMatch, нужно будет только ввести имя.'}</p>
            <div class="linkbox">${esc(inviteUrl())}</div>
            <div class="row">
              <button class="btn sm" data-share>${ICONS.share} Отправить</button>
              <button class="btn sm secondary" data-copy>Копировать</button>
            </div>
            <button class="btn ghost small" data-reset>Сделать новую ссылку (старая перестанет работать)</button>
          </div>` : ''}
        <div class="card-block">
          <h3>Прогресс</h3>
          ${bar(people[0])}${bar(people[1])}
          <div class="stat-row"><span>Мэтчей</span><b>${S.matches.size}</b></div>
        </div>
        <div class="card-block">
          <h3>Открыть на другом устройстве</h3>
          <p class="muted small">${isOwner
            ? 'Личная ссылка входа в аккаунт владельца. Никому не отправляй — она даёт полный доступ.'
            : 'Открой на другом устройстве ссылку-приглашение и введи имя — всё сохранится.'}</p>
          <button class="btn sm secondary" data-recovery>${isOwner ? 'Скопировать мою ссылку входа' : 'Скопировать ссылку-приглашение'}</button>
        </div>
        <div class="card-block">
          <h3>Установить на телефон</h3>
          <p class="muted small">iPhone: Safari → «Поделиться» → «На экран „Домой“». Android: меню Chrome → «Установить приложение».</p>
          <button class="btn sm secondary" data-install style="display:none">Установить</button>
        </div>
        <div class="pad center"><button class="btn ghost small" data-logout>Выйти на этом устройстве</button></div>
      </div>
    </div>`);
  screen.querySelector('[data-share]')?.addEventListener('click', () => share(inviteUrl(), `${me().name} зовёт выбрать фильм вместе в MovixMatch`));
  screen.querySelector('[data-copy]')?.addEventListener('click', () => copy(inviteUrl()));
  screen.querySelector('[data-reset]')?.addEventListener('click', async () => {
    if (!confirm('Старая ссылка-приглашение перестанет работать. Продолжить?')) return;
    try {
      const code = randomId(10);
      await setDoc(doc(db, 'rooms', S.session.roomId, 'invites', code), { ownerName: nameOf('owner'), createdAt: Date.now() });
      const old = await getDocs(collection(db, 'rooms', S.session.roomId, 'invites'));
      await Promise.all(old.docs.filter((d) => d.id !== code).map((d) => deleteDoc(d.ref)));
      S.inviteCode = code;
      renderCouple();
      toast('Новая ссылка готова');
    } catch (e) { toast(errText(e)); }
  });
  screen.querySelector('[data-recovery]').onclick = () => copy(recoveryUrl());
  screen.querySelector('[data-logout]').onclick = () => {
    if (!confirm(isOwner ? 'Вернуться можно будет только по твоей ссылке входа. Выйти?' : 'Вернуться можно будет по ссылке-приглашению. Выйти?')) return;
    teardown();
    saveSession(null);
    go('#/', true);
  };
  const installBtn = screen.querySelector('[data-install]');
  if (deferredInstall) {
    installBtn.style.display = '';
    installBtn.onclick = () => { deferredInstall.prompt(); deferredInstall = null; installBtn.style.display = 'none'; };
  }
  const keep = currentTab() === 'couple' ? document.querySelector('.scroll')?.scrollTop || 0 : 0;
  $app.replaceChildren(screen, tabbar('couple'));
  screen.querySelector('.scroll').scrollTop = keep;
}

// ---------- keyboard (desktop) ----------
document.addEventListener('keydown', (e) => {
  if (currentTab() !== 'swipe' || e.target.matches('input, textarea')) return;
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
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  const b = document.querySelector('[data-install]');
  if (b) { b.style.display = ''; b.onclick = () => { deferredInstall.prompt(); deferredInstall = null; b.style.display = 'none'; }; }
});
if ('serviceWorker' in navigator && !LOCAL) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ---------- start ----------
(async function start() {
  spinner();
  try {
    const list = await fetch('movies.json').then((r) => r.json());
    list.forEach((m) => S.movies.set(m.id, m));
    if (CONFIGURED) S.uid = (await authReady).uid;
    const pending = sessionStorage.getItem('movix.toast');
    if (pending) { sessionStorage.removeItem('movix.toast'); setTimeout(() => toast(pending), 300); }
  } catch (e) {
    $app.innerHTML = `<div class="screen"><div class="empty"><div class="big">📡</div><h3>Не удалось загрузиться</h3><p class="muted">${esc(errText(e))}. Проверьте интернет и обновите страницу.</p></div></div>`;
    return;
  }
  route();
})();
