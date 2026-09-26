const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');

const hostNameInput = document.getElementById('host-name');
const rulesInput = document.getElementById('rules');
const hostBtn = document.getElementById('host-btn');

const joinNameInput = document.getElementById('join-name');
const joinCodeInput = document.getElementById('join-code');
const joinBtn = document.getElementById('join-btn');

const lobbyError = document.getElementById('lobby-error');
const recentList = document.getElementById('recent-list');

const roomCodeLabel = document.getElementById('room-code-label');
const playersOnlineLabel = document.getElementById('players-online');

const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

const mapArea = document.getElementById('map-area');
const mapDecor = document.getElementById('map-decor');
const envLabel = document.getElementById('env-label');
const enemyRow = document.getElementById('enemy-row');
const objectRow = document.getElementById('object-row');
const playerRow = document.getElementById('player-row');
const effectLayer = document.getElementById('effect-layer');

const diceOverlay = document.getElementById('dice-overlay');
const diceFace = document.getElementById('dice-face');
const diceReason = document.getElementById('dice-reason');

const socket = io();
let myName = null;
let myRoomCode = null;

// ---------- Lobby helpers ----------
function showLobbyError(msg) {
  lobbyError.textContent = msg;
  lobbyError.classList.remove('hidden');
}
function clearLobbyError() {
  lobbyError.classList.add('hidden');
  lobbyError.textContent = '';
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadRecentRooms() {
  try {
    const res = await fetch('/api/rooms');
    const data = await res.json();
    recentList.innerHTML = '';
    if (!data.rooms || data.rooms.length === 0) {
      recentList.innerHTML = '<p id="recent-empty">No saved adventures yet.</p>';
      return;
    }
    data.rooms.forEach(r => {
      const item = document.createElement('div');
      item.className = 'recent-item';
      item.innerHTML = `<span class="recent-item-title">${escapeHtml(r.title)} <span class="recent-item-meta">(${r.code})</span></span><span class="recent-item-meta">${timeAgo(r.updatedAt)}</span>`;
      item.addEventListener('click', () => {
        joinCodeInput.value = r.code;
        joinNameInput.focus();
        joinNameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      recentList.appendChild(item);
    });
  } catch (err) {
    // Recent list is a nice-to-have; fail silently
  }
}
loadRecentRooms();

// ---------- Hosting / joining ----------
hostBtn.addEventListener('click', async () => {
  clearLobbyError();
  const name = hostNameInput.value.trim();
  if (!name) { showLobbyError('Enter your name first.'); return; }

  hostBtn.disabled = true;
  hostBtn.textContent = 'Creating room...';
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customRules: rulesInput.value })
    });
    const data = await res.json();
    joinRoom(data.roomCode, name);
  } catch (err) {
    showLobbyError('Could not reach the server. Is it running?');
    hostBtn.disabled = false;
    hostBtn.textContent = 'Host New Adventure';
  }
});

joinBtn.addEventListener('click', () => {
  clearLobbyError();
  const name = joinNameInput.value.trim();
  const code = joinCodeInput.value.trim();
  if (!name) { showLobbyError('Enter your name first.'); return; }
  if (!code) { showLobbyError('Enter a room code.'); return; }
  joinBtn.disabled = true;
  joinBtn.textContent = 'Joining...';
  joinRoom(code, name);
});

function joinRoom(roomCode, name) {
  myName = name;
  socket.emit('join-room', { roomCode, playerName: name });
}

socket.on('join-error', ({ message }) => {
  showLobbyError(message);
  hostBtn.disabled = false;
  hostBtn.textContent = 'Host New Adventure';
  joinBtn.disabled = false;
  joinBtn.textContent = 'Join Game';
});

socket.on('joined', ({ roomCode, displayLog, lastScene, players }) => {
  myRoomCode = roomCode;
  setupScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');

  roomCodeLabel.textContent = `Room: ${roomCode}`;
  updatePlayersOnline(players);

  chatLog.innerHTML = '';
  if (displayLog.length === 0) {
    addMessage('The DM is preparing your world...', 'system');
  } else {
    displayLog.forEach(entry => addMessage(entry.text, entry.role, entry.playerName));
  }
  renderScene(lastScene);
});

socket.on('player-joined', ({ playerName, players }) => {
  updatePlayersOnline(players);
  addMessage(`${playerName} joined the game.`, 'system');
});

socket.on('player-left', ({ playerName, players }) => {
  updatePlayersOnline(players);
  addMessage(`${playerName} left the game.`, 'system');
});

function updatePlayersOnline(players) {
  playersOnlineLabel.textContent = players && players.length ? `Online: ${players.join(', ')}` : '';
}

// ---------- Chat log ----------
function addMessage(text, role, playerName) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (role === 'player' && playerName) {
    const nameSpan = document.createElement('span');
    nameSpan.className = 'player-name';
    nameSpan.textContent = `${playerName}: `;
    div.appendChild(nameSpan);
    div.appendChild(document.createTextNode(text));
  } else {
    div.textContent = text;
  }
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !myRoomCode) return;
  chatInput.value = '';
  socket.emit('send-message', text);
});

socket.on('player-message', ({ playerName, message }) => {
  addMessage(message, 'player', playerName);
});

socket.on('system-message', ({ text }) => {
  addMessage(text, 'system');
});

socket.on('dm-reply', ({ reply, scene }) => {
  addMessage(reply, 'dm');
  renderScene(scene);
});

socket.on('dice-roll', ({ die, reason, result }) => {
  playDiceAnimation(die, reason, result);
});

// ---------- Scene / map rendering ----------
function hpFillClass(hp, maxHp) {
  const pct = maxHp > 0 ? hp / maxHp : 0;
  if (pct <= 0.3) return 'low';
  if (pct <= 0.6) return 'mid';
  return '';
}

function makeToken(entity, kind) {
  const wrap = document.createElement('div');
  wrap.className = `token ${kind}` + (entity.status === 'defeated' ? ' defeated' : '');

  const name = document.createElement('div');
  name.className = 'token-name';
  name.textContent = entity.name || (kind === 'player' ? 'Adventurer' : 'Enemy');

  const hpBar = document.createElement('div');
  hpBar.className = 'token-hp-bar';
  const hpFill = document.createElement('div');
  const maxHp = entity.maxHp || 1;
  const hp = Math.max(0, Math.min(entity.hp ?? maxHp, maxHp));
  hpFill.className = `token-hp-fill ${hpFillClass(hp, maxHp)}`;
  hpFill.style.width = `${(hp / maxHp) * 100}%`;
  hpBar.appendChild(hpFill);

  const icon = document.createElement('div');
  icon.className = 'token-icon';
  icon.textContent = entity.icon || (kind === 'player' ? '🧑' : '👹');

  wrap.appendChild(name);
  wrap.appendChild(hpBar);
  wrap.appendChild(icon);
  return wrap;
}

function makeObjectToken(obj) {
  const wrap = document.createElement('div');
  wrap.className = 'object-token';

  const name = document.createElement('div');
  name.className = 'token-name';
  name.textContent = obj.label || 'Object';

  const icon = document.createElement('div');
  icon.className = 'token-icon';
  icon.textContent = obj.icon || '📦';

  wrap.appendChild(name);
  wrap.appendChild(icon);
  return wrap;
}

// Horizontal spread so multiple entities at the same distance don't overlap
function spreadLeft(index, total) {
  const spacingPx = 90;
  const offset = (index - (total - 1) / 2) * spacingPx;
  return `calc(50% + ${offset}px)`;
}

const DISTANCE_TO_TOP = { far: '14%', near: '34%', melee: '50%' };
const DISTANCE_TO_BOTTOM = { far: '8%', near: '30%', melee: '48%' };

const DECOR_BY_PALETTE = {
  swamp:   ['💧', '🪷', '💧', '🌾'],
  dungeon: ['⛓️', '🕯️', '💀'],
  forest:  ['🌲', '🌳', '🌲', '🍄'],
  cave:    ['⛰️', '🦇', '💎'],
  ruins:   ['🏚️', '🗿', '🪨'],
  snow:    ['❄️', '🌨️', '🧊'],
  desert:  ['🌵', '🏜️', '☀️'],
  city:    ['🏛️', '🏮', '🪧'],
  ship:    ['⚓', '🪢', '🌊'],
  generic: ['🗻', '🌿']
};
const DECOR_POSITIONS = [
  { top: '8%', left: '6%' }, { top: '12%', left: '88%' },
  { top: '85%', left: '10%' }, { top: '80%', left: '90%' }
];

function renderScene(scene) {
  if (!scene) return;

  const palette = scene.environment?.palette || 'generic';
  mapArea.dataset.palette = palette;
  envLabel.textContent = scene.environment?.description || 'Unknown location';

  mapDecor.innerHTML = '';
  const decorIcons = DECOR_BY_PALETTE[palette] || DECOR_BY_PALETTE.generic;
  DECOR_POSITIONS.forEach((pos, i) => {
    const span = document.createElement('span');
    span.textContent = decorIcons[i % decorIcons.length];
    span.style.top = pos.top;
    span.style.left = pos.left;
    mapDecor.appendChild(span);
  });

  // Enemies: each gets its own vertical position based on its own distance, spread horizontally
  enemyRow.innerHTML = '';
  const enemies = scene.enemies || [];
  enemies.forEach((enemy, i) => {
    const token = makeToken(enemy, 'enemy');
    token.style.top = DISTANCE_TO_TOP[enemy.distance] || DISTANCE_TO_TOP.far;
    token.style.left = spreadLeft(i, enemies.length);
    enemyRow.appendChild(token);
  });

  // Objects: persistent scenery (walls, fire, traps...) placed the same way
  objectRow.innerHTML = '';
  const objects = scene.objects || [];
  objects.forEach((obj, i) => {
    const token = makeObjectToken(obj);
    token.style.top = DISTANCE_TO_TOP[obj.distance] || DISTANCE_TO_TOP.near;
    token.style.left = spreadLeft(i, objects.length);
    objectRow.appendChild(token);
  });

  // Players: one token per party member (backward-compatible with older single-"player" saves)
  playerRow.innerHTML = '';
  const players = scene.players || (scene.player ? [scene.player] : []);
  players.forEach((p, i) => {
    const token = makeToken(p, 'player');
    const distance = enemies.length > 0 ? (p.distance || 'far') : 'far';
    token.style.bottom = DISTANCE_TO_BOTTOM[distance] || DISTANCE_TO_BOTTOM.far;
    token.style.left = spreadLeft(i, players.length);
    playerRow.appendChild(token);
  });

  // One-shot action flash
  effectLayer.innerHTML = '';
  if (scene.effect && scene.effect.icon) {
    const iconEl = document.createElement('div');
    iconEl.className = 'effect-icon';
    iconEl.textContent = scene.effect.icon;
    const labelEl = document.createElement('div');
    labelEl.className = 'effect-label';
    labelEl.textContent = scene.effect.label || '';
    effectLayer.appendChild(iconEl);
    effectLayer.appendChild(labelEl);
  }
}

// ---------- Dice roll animation ----------
function sidesFromDie(dieStr) {
  const match = /d(\d+)/i.exec(dieStr || 'd20');
  return match ? parseInt(match[1], 10) : 20;
}

function playDiceAnimation(dieStr, reason, finalResult) {
  diceOverlay.classList.remove('hidden');
  diceFace.classList.add('rolling');
  diceReason.textContent = reason || `Rolling a ${dieStr}...`;

  const sides = sidesFromDie(dieStr);
  const spinInterval = setInterval(() => {
    diceFace.textContent = String(1 + Math.floor(Math.random() * sides));
  }, 80);

  setTimeout(() => {
    clearInterval(spinInterval);
    diceFace.classList.remove('rolling');
    diceFace.textContent = String(finalResult);
    setTimeout(() => {
      diceOverlay.classList.add('hidden');
    }, 700);
  }, 1100);
}
