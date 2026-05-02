const board = document.getElementById('board');
const form = document.getElementById('form');
const usernameInput = document.getElementById('username');
const statusEl = document.getElementById('status');
const themesEl = document.getElementById('themes');

const MIN_DIGITS = 7;
const POLL_INTERVAL = 30 * 1000;

const THEMES = [
  { id: 'cream', label: 'Cream', card: '#1d1d1d', digit: '#f0e0c0' },
  { id: 'paper', label: 'Paper', card: '#ffffff', digit: '#0a0a0a' },
  { id: 'solari', label: 'Solari', card: '#0e2a48', digit: '#f4c34a' },
  { id: 'mint', label: 'Mint', card: '#f3f0e8', digit: '#1a4a3a' },
  { id: 'vegas', label: 'Vegas', card: '#461616', digit: '#ffd966' },
  { id: 'phosphor', label: 'Phosphor', card: '#080d0a', digit: '#00ff88' },
  { id: 'sunset', label: 'Sunset', card: '#e89050', digit: '#2a0a0a' },
];

function buildThemePicker() {
  themesEl.innerHTML = '';
  for (const t of THEMES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-dot';
    btn.dataset.theme = t.id;
    btn.title = t.label;
    btn.setAttribute('aria-label', t.label);
    btn.style.setProperty('--dot-card', t.card);
    btn.style.setProperty('--dot-digit', t.digit);
    btn.addEventListener('click', () => setTheme(t.id));
    themesEl.appendChild(btn);
  }
}

function setTheme(id) {
  if (!THEMES.some((t) => t.id === id)) id = 'cream';
  document.body.dataset.theme = id;
  try {
    localStorage.setItem('instaclock.theme', id);
  } catch {}
  themesEl.querySelectorAll('.theme-dot').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === id);
  });
}

let currentValue = null;
let pollTimer = null;
let cards = [];

function buildBoard(numDigits) {
  board.innerHTML = '';
  cards = [];
  for (let i = 0; i < numDigits; i++) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.digit = '0';
    card.innerHTML = `
      <div class="half top"><span>0</span></div>
      <div class="half bottom"><span>0</span></div>
      <div class="flap">
        <div class="flap-front"><span>0</span></div>
        <div class="flap-back"><span>0</span></div>
      </div>
    `;
    board.appendChild(card);
    cards.push(card);
  }
}

function flipCard(card, newDigit) {
  newDigit = String(newDigit);

  if (card._busy) {
    card._pending = newDigit;
    return;
  }
  if (card.dataset.digit === newDigit) return;

  const flap = card.querySelector('.flap');
  const flapFront = card.querySelector('.flap-front span');
  const flapBack = card.querySelector('.flap-back span');
  const topSpan = card.querySelector('.half.top span');
  const bottomSpan = card.querySelector('.half.bottom span');

  card._busy = true;

  flapBack.textContent = newDigit;
  topSpan.textContent = newDigit;

  void flap.offsetHeight;
  flap.classList.add('flipping');
  card.dataset.digit = newDigit;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    flap.removeEventListener('transitionend', finish);

    bottomSpan.textContent = newDigit;
    flapFront.textContent = newDigit;

    flap.style.transition = 'none';
    flap.classList.remove('flipping');
    void flap.offsetHeight;
    flap.style.transition = '';

    card._busy = false;
    if (card._pending && card._pending !== card.dataset.digit) {
      const pending = card._pending;
      card._pending = null;
      flipCard(card, pending);
    }
  };
  flap.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 1000);
}

function updateBoard(value) {
  const v = Math.max(0, Math.floor(value));
  const numDigits = Math.max(MIN_DIGITS, String(v).length);
  if (cards.length !== numDigits) buildBoard(numDigits);

  const padded = String(v).padStart(numDigits, '0');

  for (let i = numDigits - 1; i >= 0; i--) {
    const stagger = (numDigits - 1 - i) * 80;
    setTimeout(() => flipCard(cards[i], padded[i]), stagger);
  }
}

async function fetchFollowers(username) {
  const r = await fetch(`/api/follower?username=${encodeURIComponent(username)}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data.error || `HTTP ${r.status}`);
  }
  return data;
}

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = 'status ' + kind;
}

async function poll(username) {
  try {
    const data = await fetchFollowers(username);
    if (data.followers !== currentValue) {
      currentValue = data.followers;
      updateBoard(data.followers);
    }
    const note = data.exact === false ? ' · 근사값' : '';
    setStatus(`@${data.username} · ${data.followers.toLocaleString('en-US')} followers${note}`, 'ok');
  } catch (e) {
    setStatus(`오류: ${e.message}`, 'err');
  }
}

function start(username) {
  if (pollTimer) clearInterval(pollTimer);
  currentValue = null;
  updateBoard(0);
  setStatus(`@${username} 조회 중…`);
  poll(username);
  pollTimer = setInterval(() => poll(username), POLL_INTERVAL);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const u = usernameInput.value.trim().replace(/^@/, '').toLowerCase();
  if (!u) return;
  usernameInput.value = u;
  history.replaceState(null, '', `?u=${encodeURIComponent(u)}`);
  start(u);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pollTimer) {
    const u = usernameInput.value.trim().replace(/^@/, '').toLowerCase();
    if (u) poll(u);
  }
});

buildThemePicker();
let savedTheme = 'cream';
try {
  savedTheme = localStorage.getItem('instaclock.theme') || 'cream';
} catch {}
setTheme(savedTheme);

buildBoard(MIN_DIGITS);

const params = new URLSearchParams(location.search);
const initial = (params.get('u') || usernameInput.value).trim().replace(/^@/, '').toLowerCase();
if (initial) {
  usernameInput.value = initial;
  start(initial);
}
