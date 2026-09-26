# AI Dungeon Master (Phase 2: Multiplayer, Text)

A multiplayer text-based D&D adventure where Gemini acts as your Dungeon Master for a
whole party — it generates the world, enemies, and map fresh every playthrough, follows
any custom rules the host sets, and now supports friends joining your game over the
network using a room code.

## Setup

1. **Install Node.js** (v18 or newer) if you don't have it: https://nodejs.org

2. **Get a free Gemini API key**: https://aistudio.google.com/apikey

3. **Open a terminal in this folder** and install dependencies:
   ```
   npm install
   ```

4. **Set up your API key:**
   - Copy `.env.example` to a new file called `.env`
   - Open `.env` and paste your Gemini key in place of `your_key_here`
   - Never share this `.env` file or paste its contents anywhere (chat, GitHub, etc.)

5. **Start the server:**
   ```
   npm start
   ```

6. Open your browser to **http://localhost:3000**

## Playing with friends (same Wi-Fi network)

Only ONE person needs to run the server (this becomes the "host" machine) — everyone
else just opens it in their browser, they don't need Node.js or a Gemini key themselves.

1. On the host machine, find its local network IP address:
   - Windows: open Command Prompt, run `ipconfig`, look for "IPv4 Address" (e.g. `192.168.1.42`)
   - Mac/Linux: run `ifconfig` or `ip addr`, look for something similar
2. Make sure the server is running (`npm start`) on the host machine.
3. Friends on the **same Wi-Fi network** open `http://<that IP address>:3000` in their
   browser (e.g. `http://192.168.1.42:3000`), instead of `localhost:3000`.
4. One person clicks **"Host New Adventure"**, enters their name and any custom rules,
   and gets a **room code** (e.g. `K7F3X`).
5. Everyone else enters their own name and that room code under **"Join an Existing
   Game"**.
6. Everyone sees the same chat, the same map, and the same dice rolls in real time. Any
   player can type an action any time — the DM addresses whoever's turn it narratively
   makes sense to respond to.

If this doesn't work, it's usually a firewall on the host machine blocking incoming
connections on port 3000 — you may need to allow Node.js through your firewall, or
temporarily disable it to test.

## Playing over the real internet (friends anywhere)

For friends anywhere, not just your Wi-Fi, see **`DEPLOY.md`** in this folder — a full
step-by-step guide to putting this online for free using GitHub + Supabase + Render.
Once deployed, you get a public URL and nobody needs to run anything locally except you
(once, to deploy it).

## How it works

- `server.js` — an Express + Socket.IO server. It keeps your Gemini API key secret (only
  the server talks to Google) and manages "rooms" (adventures), broadcasting chat
  messages, DM replies, and dice rolls to everyone connected to the same room in real
  time. Messages from different players are serialized per room so simultaneous actions
  don't corrupt the conversation.
- `public/` — the browser-based interface: a lobby to host or join a game, a chat panel
  with player-name attribution, and a live battle map with generated icon tokens (now
  supporting a whole party, not just one character) with HP bars and individual
  positioning, on a terrain background that matches the current scene.
- `data/sessions.json` (local mode) or Supabase (deployed mode) — every room is saved
  automatically after each turn, so adventures survive server restarts. The setup
  screen's "Recently Played" list shows saved rooms — click one to prefill its room code
  and rejoin.

## Troubleshooting

- **"Gemini API error (404)"** — the model name in use (`gemini-3.8-flash` by default,
  set in `.env` as `GEMINI_MODEL` if you want to change it) may not be available for your
  key/region. Check https://ai.google.dev/gemini-api/docs/models for current model names.
- **"Gemini API error (429)"** or **(503)** — rate limit or temporary overload; the server
  retries automatically a few times before giving up.
- **Room not found** — room codes are case-insensitive but must match exactly; also, a
  room only exists while the server that created it is still running (or was saved to
  its `data/sessions.json`).
- Full error details are always written to `gemini-error.log` in this folder.
