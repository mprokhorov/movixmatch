// MovixMatch client — vanilla JS, no build step.
const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const SESSION_KEY = 'movix.session';

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

// ---------- state ----------
const S = {
  session: loadSession(),
  movies: new Map(),
  moviesList: [],
  data: null, // last /state response
  queue: [],
  undoStack: [],
  shownMatches: new Set(),
  es: null,
  busy: false,
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
function fmtTime(ts) {
  const d = new Date(ts);
  const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${t}`;
}
let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2600);
}
function vibrate(p) { try { navigator.vibrate?.(p); } catch {} }
const me = () => S.data?.me;
const partner = () => S.data?.room.users.find((u) => u.id !== S.data.me.id) || null;
const userName = (id) => S.data?.room.users.find((u) => u.id === id)?.name || '';
const inviteUrl = () => `${location.origin}/#/join/${S.data.room.id}/${S.data.room.inviteCode}`;
const recoveryUrl = () => `${location.origin}/#/login/${S.data.room.id}/${S.data.me.token}`;

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (S.session?.token) headers.Authorization = `Bearer ${S.session.token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || 'Ошибка сети');
    err.status = res.status;
    throw err;
  }
  return json;
}
const roomApi = (path, opts) => api(`/rooms/${S.session.roomId}${path}`, opts);

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

// ---------- routing ----------
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [name, a, b] = parts;
  if (name === 'join' && a && b) return renderJoin(a, b);
  if (name === 'login' && a && b) {
    saveSession({ roomId: a, token: b });
    S.data = null;
    return go('#/swipe', true);
  }
  if (!S.session) return renderWelcome();
  if (!S.data) return boot();
  if (name === 'chat' && a && S.movies.has(a)) return renderChat(a);
  if (name === 'matches') return renderMatches();
  if (name === 'couple') return renderCouple();
  return renderSwipe();
}
function go(hash, replace = false) {
  if (location.hash === hash) return route();
  replace ? location.replace(hash) : (location.hash = hash);
}
window.addEventListener('hashchange', route);

async function boot() {
  $app.innerHTML = '<div class="screen"><div class="spinner"></div></div>';
  try {
    await loadState();
    connectEvents();
    route();
  } catch (e) {
    if (e.status === 401 || e.status === 404) {
      saveSession(null);
      toast('Сессия устарела — создайте пару заново или откройте ссылку-приглашение');
      go('#/', true);
    } else {
      $app.innerHTML = `<div class="screen"><div class="empty"><div class="big">📡</div><h3>Нет связи</h3><p class="muted">${esc(e.message)}</p><button class="btn sm" id="retry">Повторить</button></div></div>`;
      $app.querySelector('#retry').onclick = boot;
    }
  }
}

async function loadState() {
  const data = await roomApi('/state');
  applyState(data);
}
function applyState(data) {
  S.data = data;
  data.matches.forEach((m) => S.shownMatches.add(m.movieId));
  // keep the current top card stable so a refresh doesn't yank it away
  const top = S.queue[0];
  S.queue = data.deck.slice();
  if (top && S.queue.includes(top)) S.queue = [top, ...S.queue.filter((id) => id !== top)];
  preload();
}

function connectEvents() {
  S.es?.close();
  const es = new EventSource(`/api/rooms/${S.session.roomId}/events?token=${encodeURIComponent(S.session.token)}`);
  S.es = es;
  let opened = false;
  es.addEventListener('open', () => {
    if (opened) refreshSoft(); // reconnect — catch up on anything missed
    opened = true;
  });
  es.addEventListener('users', (e) => {
    S.data.room.users = JSON.parse(e.data);
    onUsersChanged();
  });
  es.addEventListener('progress', (e) => {
    const { userId, swiped } = JSON.parse(e.data);
    const u = S.data.room.users.find((x) => x.id === userId);
    if (u) u.swiped = swiped;
    if (userId !== me().id) refreshDeckSoft();
    if (currentTab() === 'couple') renderCouple();
  });
  es.addEventListener('match', (e) => {
    const m = JSON.parse(e.data);
    addMatch(m);
  });
  es.addEventListener('unmatch', (e) => {
    const { movieId } = JSON.parse(e.data);
    S.data.matches = S.data.matches.filter((m) => m.movieId !== movieId);
    S.shownMatches.delete(movieId);
    updateBadges();
    if (currentTab() === 'matches') renderMatches();
  });
  es.addEventListener('message', (e) => onMessage(JSON.parse(e.data)));
  es.addEventListener('watched', (e) => {
    const { movieId, watched } = JSON.parse(e.data);
    const m = S.data.matches.find((x) => x.movieId === movieId);
    if (m) m.watched = watched;
    if (currentTab() === 'matches') renderMatches();
    const t = document.querySelector(`[data-watched="${movieId}"]`);
    if (t) setWatchedToggle(t, watched);
  });
}

async function refreshSoft() {
  try {
    const data = await roomApi('/state');
    const newMatches = data.matches.filter((m) => !S.shownMatches.has(m.movieId));
    applyState(data);
    updateBadges();
    if (newMatches.length) showMatch(newMatches[0].movieId);
    const tab = currentTab();
    if (tab === 'matches') renderMatches();
    if (tab === 'couple') renderCouple();
    if (tab === 'swipe' && !document.querySelector('.card')) renderSwipe();
  } catch {}
}

let deckRefreshTimer;
function refreshDeckSoft() {
  // partner swiped — their likes get boosted into my deck; refetch lazily
  clearTimeout(deckRefreshTimer);
  deckRefreshTimer = setTimeout(async () => {
    try {
      const data = await roomApi('/state');
      const visible = S.queue.slice(0, 2);
      S.data = { ...data, matches: S.data.matches };
      const rest = data.deck.filter((id) => !visible.includes(id));
      S.queue = [...visible.filter((id) => data.deck.includes(id)), ...rest];
      if (currentTab() === 'swipe' && !document.querySelector('.card')) renderSwipe();
    } catch {}
  }, 1500);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.session && S.data) {
    if (!S.es || S.es.readyState === 2) connectEvents();
    refreshSoft();
  }
});

function currentTab() {
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  return ['matches', 'couple', 'chat'].includes(name) ? name : 'swipe';
}

// ---------- shared chrome ----------
function tabbar(active) {
  const unread = (S.data?.matches || []).reduce((n, m) => n + m.unread, 0);
  const nm = S.data?.matches.length || 0;
  const el = h(`
    <nav class="tabbar">
      <button data-tab="swipe" class="${active === 'swipe' ? 'active' : ''}">${ICONS.cards}Фильмы</button>
      <button data-tab="matches" class="${active === 'matches' ? 'active' : ''}">${ICONS.chat}Мэтчи
        <span class="badge" data-badge style="${unread || nm ? '' : 'display:none'}">${unread || nm}</span></button>
      <button data-tab="couple" class="${active === 'couple' ? 'active' : ''}">${ICONS.users}Пара</button>
    </nav>`);
  el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => go(`#/${b.dataset.tab}`)));
  return el;
}
function updateBadges() {
  const unread = S.data.matches.reduce((n, m) => n + m.unread, 0);
  const n = unread || S.data.matches.length;
  document.querySelectorAll('[data-badge]').forEach((b) => {
    b.textContent = n;
    b.style.display = n ? '' : 'none';
  });
}
function onUsersChanged() {
  const p = partner();
  document.querySelectorAll('[data-presence]').forEach((el) => {
    el.innerHTML = p ? `<span class="dot ${p.online ? 'on' : ''}"></span>${esc(p.name)}` : 'ждём партнёра';
  });
  const banner = document.querySelector('[data-invite-banner]');
  if (banner && p) banner.remove();
  if (currentTab() === 'couple') renderCouple();
}

// ---------- welcome / create ----------
function renderWelcome() {
  const sample = ['tt3783958', 'tt1375666', 'tt0245429'].map((id) => `/posters/${id}.jpg`);
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
    btn.disabled = true;
    try {
      const data = await api('/rooms', { method: 'POST', body: { name: e.target.name.value } });
      saveSession({ roomId: data.room.id, token: data.me.token });
      applyState(data);
      connectEvents();
      go('#/couple');
      setTimeout(() => toast('Пара создана! Отправь ссылку-приглашение 💌'), 300);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  };
}

// ---------- join ----------
async function renderJoin(roomId, code) {
  $app.innerHTML = '<div class="screen"><div class="spinner"></div></div>';
  if (S.session?.roomId === roomId) {
    // already in this room on this device
    return go('#/swipe', true);
  }
  let info;
  try {
    info = await api(`/rooms/${roomId}/invite/${code}`);
  } catch (e) {
    $app.replaceChildren(h(`<div class="screen"><div class="empty"><div class="big">💔</div><h3>Ссылка не работает</h3><p class="muted">${esc(e.message)}. Попроси новую ссылку.</p><button class="btn sm" onclick="location.hash='#/'">На главную</button></div></div>`));
    return;
  }
  const rejoin = !!info.partnerName;
  $app.replaceChildren(h(`
    <div class="screen">
      <div class="hero">
        <div class="poster-fan">${['tt0332280', 'tt5311514', 'tt2194499'].map((id) => `<img src="/posters/${id}.jpg" alt="">`).join('')}</div>
        <div class="logo">Movix<span>Match</span></div>
        <h2>${esc(info.ownerName)} зовёт тебя выбирать фильм вместе 💌</h2>
        <p class="muted">${rejoin
          ? `В этой паре уже есть ${esc(info.partnerName)}. Если это ты на новом устройстве — просто войди.`
          : 'Свайпайте карточки: когда фильм понравится вам обоим, будет мэтч.'}</p>
        <form class="form" id="join">
          <input class="field" name="name" placeholder="Твоё имя" maxlength="30" value="${esc(info.partnerName || '')}" ${rejoin ? '' : 'required'}>
          <button class="btn" type="submit">${rejoin ? 'Войти' : 'Присоединиться'}</button>
        </form>
      </div>
    </div>`));
  $app.querySelector('#join').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const data = await api(`/rooms/${roomId}/join`, { method: 'POST', body: { code, name: e.target.name.value } });
      saveSession({ roomId, token: data.me.token });
      applyState(data);
      connectEvents();
      go('#/swipe', true);
      setTimeout(() => toast(`Готово! Твоя пара: ${data.room.users.find((u) => u.role === 'owner').name}. Свайпай 🍿`), 300);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  };
}

// ---------- swipe ----------
function renderSwipe() {
  const p = partner();
  const screen = h(`
    <div class="screen">
      <header class="topbar">
        <div class="logo">Movix<span>Match</span></div>
        <span class="pill" data-presence>${p ? `<span class="dot ${p.online ? 'on' : ''}"></span>${esc(p.name)}` : 'ждём партнёра'}</span>
      </header>
      ${!p && me().role === 'owner' ? `
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
  const el = h(`
    <div class="card ${behind ? 'behind' : ''}" data-id="${m.id}">
      <img class="poster" src="/${m.poster}" alt="" draggable="false">
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
  return el;
}

function buildDeck() {
  const deck = document.querySelector('.deck');
  if (!deck) return;
  deck.innerHTML = '';
  updateControls();
  if (!S.queue.length) {
    const n = S.data.matches.length;
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

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
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

async function commitSwipe(movieId, likeIt) {
  S.queue = S.queue.filter((id) => id !== movieId);
  S.undoStack.push(movieId);
  if (S.undoStack.length > 20) S.undoStack.shift();
  promoteNext();
  preload();
  const mine = S.data.room.users.find((u) => u.id === me().id);
  if (mine) mine.swiped++;
  try {
    const { match } = await roomApi('/swipe', { method: 'POST', body: { movieId, like: likeIt } });
    if (match) addMatch(match);
  } catch (e) {
    toast(e.message);
    S.undoStack.pop();
    S.queue.unshift(movieId);
    buildDeck();
  }
  if (S.queue.length < 3) refreshDeckSoft();
}

async function undo() {
  if (S.busy || !S.undoStack.length) return;
  S.busy = true;
  try {
    const { movieId, unmatched } = await roomApi('/undo', { method: 'POST' });
    S.undoStack = S.undoStack.filter((id) => id !== movieId);
    S.queue = [movieId, ...S.queue.filter((id) => id !== movieId)];
    if (unmatched) {
      S.data.matches = S.data.matches.filter((m) => m.movieId !== movieId);
      S.shownMatches.delete(movieId);
      updateBadges();
    }
    const mine = S.data.room.users.find((u) => u.id === me().id);
    if (mine) mine.swiped = Math.max(0, mine.swiped - 1);
    const deck = document.querySelector('.deck');
    if (deck?.classList.contains('empty')) return renderSwipe();
    buildDeck();
  } catch (e) {
    toast(e.message);
  } finally {
    S.busy = false;
  }
}

function preload() {
  S.queue.slice(0, 4).forEach((id) => {
    const m = S.movies.get(id);
    if (m) new Image().src = `/${m.poster}`;
  });
}

// ---------- match overlay ----------
function addMatch(m) {
  if (!S.data.matches.find((x) => x.movieId === m.movieId)) {
    S.data.matches.unshift({ ...m, lastMessage: null, unread: 0 });
  }
  updateBadges();
  if (currentTab() === 'matches') renderMatches();
  if (!S.shownMatches.has(m.movieId)) showMatch(m.movieId);
}

function showMatch(movieId) {
  S.shownMatches.add(movieId);
  const m = S.movies.get(movieId);
  const p = partner();
  vibrate([30, 60, 30, 60, 80]);
  const ov = h(`
    <div class="overlay">
      <h2>Это мэтч!</h2>
      <img src="/${m.poster}" alt="">
      <p><b>${esc(m.title)}</b><br><span class="muted">${esc(me().name)} и ${esc(p?.name || '')} оба хотят посмотреть</span></p>
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
  document.body.append(ov, confetti);
  setTimeout(() => confetti.remove(), 4500);
}

// ---------- matches list ----------
function renderMatches() {
  const list = S.data.matches;
  const screen = h(`
    <div class="screen">
      <header class="topbar"><h1>Мэтчи</h1><span class="pill">${list.length} ${plural(list.length, 'фильм', 'фильма', 'фильмов')}</span></header>
      <div class="scroll">
        ${list.length ? `<div class="grid">${list.map((x) => {
          const m = S.movies.get(x.movieId);
          const last = x.lastMessage ? `${x.lastMessage.userId === me().id ? 'Вы' : esc(userName(x.lastMessage.userId))}: ${esc(x.lastMessage.text)}` : 'Напишите первым 💬';
          return `<button class="match-tile" data-id="${m.id}">
            <img src="/${m.poster}" alt="" loading="lazy">
            <div class="shade"></div>
            ${x.watched ? '<span class="watched">✓ смотрели</span>' : ''}
            ${x.unread ? `<span class="badge">${x.unread}</span>` : ''}
            <div class="t"><b>${esc(m.title)}</b><span>${last}</span></div>
          </button>`;
        }).join('')}</div>` : `
          <div class="empty">
            <div class="big">💞</div>
            <h3>Пока без мэтчей</h3>
            <p class="muted">${partner() ? 'Продолжайте свайпать — как только фильм понравится обоим, он появится здесь.' : 'Сначала пригласи партнёра во вкладке «Пара».'}</p>
          </div>`}
      </div>
    </div>`);
  screen.querySelectorAll('.match-tile').forEach((b) => (b.onclick = () => go(`#/chat/${b.dataset.id}`)));
  $app.replaceChildren(screen, tabbar('matches'));
}

// ---------- chat ----------
const QUICK = ['Смотрим сегодня? 🍿', 'Давай в выходные', 'Я уже видел(а), но пересмотрю', 'Где посмотреть?', 'Хм, не уверен(а) 🤔'];

function setWatchedToggle(el, on) {
  el.classList.toggle('on', on);
  el.innerHTML = on ? '✓ Посмотрели' : '○ Ещё не смотрели';
}

async function renderChat(movieId) {
  const m = S.movies.get(movieId);
  const match = S.data.matches.find((x) => x.movieId === movieId);
  if (!match) return go('#/matches', true);
  const screen = h(`
    <div class="screen">
      <header class="topbar">
        <button class="icon-btn" data-back aria-label="Назад">${ICONS.back}</button>
        <h1>Обсуждение</h1>
        <span class="pill" data-presence></span>
      </header>
      <div class="scroll" data-scroll>
        <div class="chat-head">
          <img src="/${m.poster}" alt="">
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
  onUsersChanged();

  screen.querySelector('[data-back]').onclick = () => (history.length > 1 ? history.back() : go('#/matches'));
  const toggle = screen.querySelector('[data-watched]');
  setWatchedToggle(toggle, match.watched);
  toggle.onclick = async () => {
    const next = !match.watched;
    match.watched = next;
    setWatchedToggle(toggle, next);
    try { await roomApi(`/matches/${movieId}/watched`, { method: 'POST', body: { watched: next } }); }
    catch (e) { toast(e.message); }
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
    text = text.trim();
    if (!text) return;
    try {
      const { message } = await roomApi(`/matches/${movieId}/messages`, { method: 'POST', body: { text } });
      appendMessage(movieId, message);
    } catch (e) { toast(e.message); }
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = ta.value;
    ta.value = '';
    autosize();
    sendText(text);
  };
  screen.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => sendText(b.dataset.q)));

  try {
    const { messages, watched } = await roomApi(`/matches/${movieId}/messages`);
    match.unread = 0;
    match.watched = watched;
    setWatchedToggle(toggle, watched);
    const box = screen.querySelector('[data-messages]');
    box.innerHTML = messages.length ? '' : '<p class="muted small center" data-hint>Это мэтч! Договоритесь, когда смотрите 🍿</p>';
    messages.forEach((msg) => appendMessage(movieId, msg, false));
    scrollChat();
  } catch (e) {
    toast(e.message);
  }
}

function appendMessage(movieId, msg, scroll = true) {
  const match = S.data.matches.find((x) => x.movieId === movieId);
  if (match) match.lastMessage = msg;
  const box = document.querySelector('[data-messages]');
  if (!box || location.hash !== `#/chat/${movieId}`) return;
  if (box.querySelector(`[data-mid="${msg.id}"]`)) return;
  box.querySelector('[data-hint]')?.remove();
  box.querySelector('.spinner')?.remove();
  const mine = msg.userId === me().id;
  box.appendChild(h(`<div class="msg ${mine ? 'mine' : ''}" data-mid="${msg.id}">${esc(msg.text)}<time>${fmtTime(msg.at)}</time></div>`));
  if (scroll) scrollChat();
}
function scrollChat() {
  const sc = document.querySelector('[data-scroll]');
  if (sc) sc.scrollTop = sc.scrollHeight;
}

function onMessage({ movieId, message }) {
  const match = S.data.matches.find((x) => x.movieId === movieId);
  if (!match) return;
  match.lastMessage = message;
  const open = location.hash === `#/chat/${movieId}` && document.visibilityState === 'visible';
  if (open) {
    appendMessage(movieId, message);
    if (message.userId !== me().id) roomApi(`/matches/${movieId}/read`, { method: 'POST' }).catch(() => {});
  } else if (message.userId !== me().id) {
    match.unread++;
    vibrate(20);
    toast(`${userName(message.userId)} · ${S.movies.get(movieId).title}: ${message.text}`);
  }
  updateBadges();
  if (currentTab() === 'matches') renderMatches();
}

// ---------- couple ----------
function renderCouple() {
  const owner = S.data.room.users.find((u) => u.role === 'owner');
  const p = S.data.room.users.find((u) => u.role === 'partner');
  const total = S.data.total;
  const isOwner = me().role === 'owner';
  const person = (u) => u
    ? `<div class="person"><div class="avatar">${initial(u.name)}<span class="dot ${u.online ? 'on' : ''}"></span></div><b>${esc(u.name)}${u.id === me().id ? ' (ты)' : ''}</b></div>`
    : `<div class="person"><div class="avatar empty-av">?</div><span class="muted">ждём…</span></div>`;
  const bar = (u) => u ? `
    <div class="stat-row"><span>${esc(u.name)}</span><span class="muted">${u.swiped} / ${total}</span></div>
    <div class="progress"><i style="width:${Math.round((u.swiped / total) * 100)}%"></i></div>` : '';

  const screen = h(`
    <div class="screen">
      <header class="topbar"><h1>Ваша пара</h1></header>
      <div class="scroll">
        <div class="people">${person(owner)}<div class="heart">💞</div>${person(p)}</div>
        ${isOwner ? `
          <div class="card-block">
            <h3>${p ? 'Ссылка-приглашение' : 'Пригласи свою половинку'}</h3>
            <p class="muted small">${p ? `${esc(p.name)} уже в паре. По этой ссылке можно войти заново с другого устройства.` : 'Отправь ссылку — откроется MovixMatch, нужно будет только ввести имя.'}</p>
            <div class="linkbox">${esc(inviteUrl())}</div>
            <div class="row">
              <button class="btn sm" data-share>${ICONS.share} Отправить</button>
              <button class="btn sm secondary" data-copy>Копировать</button>
            </div>
            <button class="btn ghost small" data-reset>Сделать новую ссылку (старая перестанет работать)</button>
          </div>` : ''}
        <div class="card-block">
          <h3>Прогресс</h3>
          ${bar(owner)}${bar(p)}
          <div class="stat-row"><span>Мэтчей</span><b>${S.data.matches.length}</b></div>
        </div>
        <div class="card-block">
          <h3>Открыть на другом устройстве</h3>
          <p class="muted small">Личная ссылка для входа в твой аккаунт${isOwner ? ' владельца' : ''}. Никому не отправляй — она даёт полный доступ.</p>
          <button class="btn sm secondary" data-recovery>Скопировать мою ссылку входа</button>
        </div>
        <div class="card-block">
          <h3>Установить на телефон</h3>
          <p class="muted small">iPhone: «Поделиться» → «На экран „Домой“». Android: меню браузера → «Установить приложение».</p>
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
      const { inviteCode } = await roomApi('/invite/reset', { method: 'POST' });
      S.data.room.inviteCode = inviteCode;
      renderCouple();
      toast('Новая ссылка готова');
    } catch (e) { toast(e.message); }
  });
  screen.querySelector('[data-recovery]').onclick = () => copy(recoveryUrl());
  screen.querySelector('[data-logout]').onclick = () => {
    if (!confirm(isOwner ? 'Без ссылки входа вернуться в эту пару не получится. Выйти?' : 'Вернуться можно будет по ссылке-приглашению. Выйти?')) return;
    S.es?.close();
    saveSession(null);
    S.data = null;
    S.queue = [];
    S.undoStack = [];
    go('#/', true);
  };
  const installBtn = screen.querySelector('[data-install]');
  if (deferredInstall) {
    installBtn.style.display = '';
    installBtn.onclick = async () => { deferredInstall.prompt(); deferredInstall = null; installBtn.style.display = 'none'; };
  }
  const sc = document.querySelector('.scroll');
  const keep = currentTab() === 'couple' && sc ? sc.scrollTop : 0;
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
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ---------- start ----------
(async function start() {
  $app.innerHTML = '<div class="screen"><div class="spinner"></div></div>';
  try {
    const list = await fetch('/movies.json').then((r) => r.json());
    S.moviesList = list;
    list.forEach((m) => S.movies.set(m.id, m));
  } catch {
    $app.innerHTML = '<div class="screen"><div class="empty"><div class="big">📡</div><h3>Не удалось загрузить фильмы</h3><p class="muted">Проверьте интернет и обновите страницу.</p></div></div>';
    return;
  }
  route();
})();
