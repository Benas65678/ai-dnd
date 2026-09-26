require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, maxAge: 0 }));

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_key_here') {
  console.warn('\n⚠️  WARNING: No GEMINI_API_KEY set in .env — the DM will not work until you add one.\n');
}

// Rooms (adventures) are persisted so they survive server restarts.
// If Supabase credentials are provided, use a real database (required for real
// hosting - Render's free tier wipes local files on restart). Otherwise fall
// back to a local JSON file, which is fine for testing on your own machine.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

let supabase = null;
if (useSupabase) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('Using Supabase for persistent storage.');
} else {
  console.log('No Supabase credentials found - using local file storage (data/sessions.json). Fine for local testing, but this will NOT persist when deployed to a host with an ephemeral filesystem.');
}

const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
if (!useSupabase && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let sessions = {};

async function loadAllSessions() {
  if (useSupabase) {
    const { data, error } = await supabase.from('sessions').select('code, data');
    if (error) {
      console.error('Could not load sessions from Supabase:', error.message);
      return;
    }
    data.forEach(row => { sessions[row.code] = row.data; });
  } else {
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      }
    } catch (err) {
      console.warn('Could not read saved sessions file, starting fresh:', err.message);
    }
  }
  // Older saves predate the "started" flag - mark them as already started so we
  // don't re-trigger the opening narration when someone rejoins them.
  Object.values(sessions).forEach(s => { if (s.started === undefined) s.started = true; });
  console.log(`Loaded ${Object.keys(sessions).length} saved adventure(s).`);
}

// Saves ONE room. Called after every turn, so keep it targeted rather than
// rewriting everything - matters a lot once this is a real database.
async function saveSession(roomCode) {
  const session = sessions[roomCode];
  if (!session) return;

  if (useSupabase) {
    const { error } = await supabase.from('sessions').upsert({ code: roomCode, data: session, updated_at: new Date().toISOString() });
    if (error) console.error('Could not save session to Supabase:', error.message);
  } else {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
    } catch (err) {
      console.error('Could not save sessions to disk:', err.message);
    }
  }
}

function computeTitle(session) {
  const players = session.lastScene?.players || (session.lastScene?.player ? [session.lastScene.player] : []);
  const names = players.map(p => p.name).filter(n => n && n !== 'Adventurer');
  const place = session.lastScene?.environment?.description;
  if (names.length && place) return `${names.join(' & ')} — ${place}`;
  if (place) return `Unnamed party — ${place}`;
  return 'A new adventure';
}

// Transient, in-memory only: who's currently connected to each room, and a
// per-room processing queue so simultaneous messages from different players
// don't race each other and corrupt the conversation history.
const liveRooms = {}; // roomCode -> { sockets: Map(socketId -> playerName), chain: Promise }

function getOrCreateLiveRoom(roomCode) {
  if (!liveRooms[roomCode]) liveRooms[roomCode] = { sockets: new Map(), chain: Promise.resolve() };
  return liveRooms[roomCode];
}

function generateRoomCode() {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
  let code;
  do {
    code = Array.from({ length: 5 }, () => charset[Math.floor(Math.random() * charset.length)]).join('');
  } while (sessions[code]);
  return code;
}

function rollDice(dieStr) {
  const match = /d(\d+)/i.exec(dieStr || 'd20');
  const sides = match ? parseInt(match[1], 10) : 20;
  return 1 + Math.floor(Math.random() * sides);
}

function buildSystemInstruction(customRules) {
  return `You are an expert Dungeons & Dragons Dungeon Master running a text adventure for a PARTY of one or more adventurers, playing together over chat. New adventurers may join partway through - welcome them in and give them a moment to establish a character.

Your job:
- Narrate vividly but concisely (2-4 short paragraphs max per turn).
- Generate a NEW setting, map layout, and enemies at the start of the adventure, and keep introducing fresh locations and encounters as the story progresses. Never reuse the same map or enemy roster from a previous playthrough.
- Track every adventurer's HP, inventory, and any custom stats individually.
- Messages from players arrive prefixed like "[PlayerName] message" so you always know who is acting - address and track each adventurer as their own character, distinct from the others.
- Call for dice rolls when the outcome is uncertain. The game client rolls real dice automatically when you request one — you do not roll it yourself, and you do not need to wait for anyone to type a number back; the system will inject the roll result as the next message and you narrate the outcome from it.
- Never control any adventurer's actions or decisions — only describe the world, NPCs, and enemies.
- Stay strictly in character as the DM. Do not break the fourth wall unless a player explicitly asks an out-of-character question.

CUSTOM RULES FOR THIS GAME (set by the host — follow these exactly, even if they override standard D&D rules):
${customRules && customRules.trim() ? customRules.trim() : '(No custom rules given — use standard 5e-inspired rules as a loose guide.)'}

CRITICAL FORMAT REQUIREMENT — every single response you give MUST end with a machine-readable scene block, exactly in this format, with valid JSON between the markers and nothing else on those lines:

<<<SCENE>>>
{
  "players": [{"name": "string", "hp": number, "maxHp": number, "icon": "single emoji representing this adventurer", "distance": "far, near, or melee"}],
  "enemies": [{"name": "string", "hp": number, "maxHp": number, "icon": "single emoji representing this enemy", "status": "alive or defeated", "distance": "far, near, or melee"}],
  "objects": [{"icon": "single emoji for a temporary object/obstacle/effect in the scene, e.g. a wall, fire, trap, barricade", "label": "short name, 1-4 words", "distance": "far, near, or melee"}],
  "effect": null,
  "environment": {"description": "short phrase, 3-6 words, describing the current location", "palette": "one of: swamp, dungeon, forest, cave, ruins, snow, desert, city, ship, generic"},
  "diceRoll": null
}
<<<END_SCENE>>>

Rules for the scene block:
- "players" has ONE entry per adventurer currently in the party, matched by the character name they've established (not their chat display name). Add an entry the moment someone introduces a character; before that, use a placeholder entry like {"name": "Adventurer", "hp": 10, "maxHp": 10, "icon": "🧑", "distance": "far"}. Keep every existing party member's entry updated every turn even if only one of them acted.
- "enemies" is an empty array [] when there are no enemies currently present.
- "distance" (on each player AND separately on each individual enemy) reflects physical closeness to the fight: "far" (across the room/area), "near" (closing in, a few steps away), or "melee" (right next to each other, weapons' reach). Each entity tracks its OWN distance independently. Default new enemies/players to "far" unless narration says otherwise. Update distance every turn to reflect movement described that turn (charging/approaching closes it, retreating opens it). When no enemies are present, distance is just "far" for everyone.
- "objects" is for anything semi-permanent added to the scene that isn't a character — a wall thrown up, a fire spreading, a trap set, rubble, a barricade. Give it a "distance" the same way as characters. Keep an object in the array every turn while it still exists, and drop it once destroyed or no longer relevant.
- "effect" is a one-time visual flourish for the CURRENT turn only — use it whenever an action just visibly resolved (a hit connects, a spell fires, an object is created/destroyed). Format: {"icon": "single emoji, e.g. 👊 for a landed punch, 🔥 for fire magic, ⚔️ for a clash", "label": "very short phrase, e.g. 'Fist connects!'"}. Set it to null on quieter turns.
- Set "diceRoll" to an object like {"die": "d20", "reason": "short phrase, e.g. attack roll against the goblin"} ONLY on the turn where you are asking for a roll. Otherwise it must be null.
- Never put narration inside the scene block, and never omit it. Keep icons to a single emoji each.

Begin by introducing the world and the party's starting situation, and ask whoever has joined so far to describe their character if that hasn't been established yet.`;
}

function extractScene(rawText) {
  const match = rawText.match(/<<<SCENE>>>([\s\S]*?)<<<END_SCENE>>>/);
  if (!match) return { narrative: rawText.trim(), scene: null };

  const narrative = rawText.slice(0, match.index).trim();
  let scene = null;
  try {
    scene = JSON.parse(match[1].trim());
  } catch (err) {
    console.warn('Could not parse SCENE JSON from model output:', err.message);
  }
  return { narrative, scene };
}

// Runs one turn of the conversation: sends `message` to Gemini using the room's
// running history, broadcasts the result to everyone in the room, and - if the
// DM calls for a dice roll - rolls it, broadcasts that too, then automatically
// continues the conversation with the result (recursively, in case that leads
// to another roll).
async function advanceTurn(roomCode, message, { visible = true, playerName = null } = {}) {
  const session = sessions[roomCode];
  if (!session) return;

  if (visible) {
    session.displayLog.push({ role: 'player', text: message, playerName });
    io.to(roomCode).emit('player-message', { playerName, message });
  }

  session.history.push({ role: 'user', parts: [{ text: playerName ? `[${playerName}] ${message}` : message }] });

  const body = {
    system_instruction: { parts: [{ text: session.systemInstruction }] },
    contents: session.history,
    generationConfig: { temperature: 1.0, maxOutputTokens: 1500 }
  };

  const MAX_RETRIES = 3;
  let response, errText;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify(body)
      });
    } catch (networkErr) {
      errText = networkErr.message;
      break;
    }

    if (response.ok) break;

    if ((response.status === 503 || response.status === 429) && attempt < MAX_RETRIES) {
      const waitMs = attempt * 1500;
      console.log(`Gemini returned ${response.status}, retrying in ${waitMs}ms (attempt ${attempt}/${MAX_RETRIES})...`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    errText = await response.text();
    break;
  }

  if (!response || !response.ok) {
    const status = response ? response.status : 'network error';
    const logLine = `\n[${new Date().toISOString()}] Gemini API error ${status}\nRequest body: ${JSON.stringify(body)}\nResponse: ${errText}\n`;
    console.error(logLine);
    fs.appendFileSync(path.join(__dirname, 'gemini-error.log'), logLine);
    const friendlyMsg = status === 503
      ? 'The DM (Gemini) is overloaded right now even after retrying. Please wait a bit and try sending a message again.'
      : `Gemini API error (${status}). Check the server's API key and model name in .env. Full details were written to gemini-error.log`;
    io.to(roomCode).emit('system-message', { text: `⚠️ ${friendlyMsg}` });
    return;
  }

  const data = await response.json();
  const rawReply = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || '(The DM pauses, unsure what to say. Try again.)';

  session.history.push({ role: 'model', parts: [{ text: rawReply }] });

  const { narrative, scene } = extractScene(rawReply);

  session.displayLog.push({ role: 'dm', text: narrative });
  if (scene) session.lastScene = scene;
  session.title = computeTitle(session);
  session.updatedAt = Date.now();
  await saveSession(roomCode);

  io.to(roomCode).emit('dm-reply', { reply: narrative, scene });

  if (scene && scene.diceRoll) {
    const { die, reason } = scene.diceRoll;
    const result = rollDice(die);
    io.to(roomCode).emit('dice-roll', { die: die || 'd20', reason, result });

    const sysText = `🎲 Rolled ${result} on a ${die || 'd20'}${reason ? ` — ${reason}` : ''}`;
    session.displayLog.push({ role: 'system', text: sysText });
    await saveSession(roomCode);
    io.to(roomCode).emit('system-message', { text: sysText });

    await advanceTurn(roomCode, `(Dice result: I rolled a ${result} on a ${die || 'd20'} for: ${reason || 'the requested roll'}.)`, { visible: false });
  }
}

// ---------- REST: creating rooms and listing recent ones ----------

app.post('/api/rooms', async (req, res) => {
  const { customRules } = req.body;
  const roomCode = generateRoomCode();
  const now = Date.now();
  sessions[roomCode] = {
    systemInstruction: buildSystemInstruction(customRules || ''),
    history: [],
    displayLog: [],
    lastScene: null,
    title: 'A new adventure',
    createdAt: now,
    updatedAt: now,
    started: false
  };
  await saveSession(roomCode);
  res.json({ roomCode });
});

// List recent rooms for the "Recently Played" menu, newest first
app.get('/api/rooms', (req, res) => {
  const list = Object.entries(sessions)
    .map(([code, s]) => ({ code, title: s.title, updatedAt: s.updatedAt, turns: (s.displayLog || []).length }))
    .filter(s => s.turns > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10);
  res.json({ rooms: list });
});

// ---------- Realtime: joining rooms and playing ----------

io.on('connection', socket => {
  socket.on('join-room', ({ roomCode, playerName }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const session = sessions[code];
    if (!session) {
      socket.emit('join-error', { message: 'Room not found. Check the code and try again.' });
      return;
    }

    socket.data.roomCode = code;
    socket.data.playerName = (playerName || 'Adventurer').trim().slice(0, 24);

    socket.join(code);
    const live = getOrCreateLiveRoom(code);
    live.sockets.set(socket.id, socket.data.playerName);
    const playersOnline = Array.from(live.sockets.values());

    socket.emit('joined', {
      roomCode: code,
      displayLog: session.displayLog || [],
      lastScene: session.lastScene || null,
      players: playersOnline
    });
    socket.to(code).emit('player-joined', { playerName: socket.data.playerName, players: playersOnline });

    // Kick off the opening narration exactly once per room, whoever joins first.
    if (!session.started) {
      session.started = true;
      saveSession(code);
      live.chain = live.chain.then(() => advanceTurn(
        code,
        "(The adventure begins. Introduce the world and the party's starting situation, and ask whoever has joined so far to describe their character.)",
        { visible: false }
      )).catch(err => console.error('Error starting adventure:', err));
    }
  });

  socket.on('send-message', message => {
    const { roomCode, playerName } = socket.data || {};
    if (!roomCode || !sessions[roomCode]) return;
    if (typeof message !== 'string' || !message.trim()) return;

    const live = getOrCreateLiveRoom(roomCode);
    live.chain = live.chain
      .then(() => advanceTurn(roomCode, message.trim(), { visible: true, playerName }))
      .catch(err => {
        console.error('Error advancing turn:', err);
        io.to(roomCode).emit('system-message', { text: '⚠️ Something went wrong reaching the DM. Try again.' });
      });
  });

  socket.on('disconnect', () => {
    const { roomCode, playerName } = socket.data || {};
    if (!roomCode || !liveRooms[roomCode]) return;
    liveRooms[roomCode].sockets.delete(socket.id);
    const playersOnline = Array.from(liveRooms[roomCode].sockets.values());
    io.to(roomCode).emit('player-left', { playerName, players: playersOnline });
  });
});

loadAllSessions()
  .catch(err => console.error('Error loading saved sessions:', err))
  .finally(() => {
    httpServer.listen(PORT, () => {
      console.log(`\n🎲 AI Dungeon Master running at http://localhost:${PORT}\n`);
    });
  });
