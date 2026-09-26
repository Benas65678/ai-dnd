# Deploying Online (Phase 3: Real Internet Multiplayer)

This makes your game reachable by friends anywhere, not just your Wi-Fi network. It uses
three free services together:

- **GitHub** — holds your code so Render can deploy it
- **Supabase** — a real database, so adventures survive server restarts
- **Render** — actually runs your server, 24/7, at a public URL

None of this costs money. Render's free tier does have a quirk (explained below), but no
payment is required anywhere in this guide.

---

## Part 1: Put your code on GitHub

1. Go to https://github.com and sign up for a free account if you don't have one.
2. Once logged in, click the **+** icon (top right) → **New repository**.
3. Name it anything (e.g. `ai-dnd`), leave it **Public**, don't add a README, click
   **Create repository**.
4. On the next page, click **uploading an existing file**.
5. Drag your entire `ai-dnd` folder's contents into the upload box (all the files and
   folders — `server.js`, `package.json`, `public/`, etc. — but **not** `node_modules`,
   `.env`, or `data` if you have them locally; the included `.gitignore` handles this
   automatically if you use GitHub Desktop or git instead of drag-and-drop — see the note
   below).
6. Scroll down, click **Commit changes**.

**Note on drag-and-drop**: GitHub's web upload doesn't respect `.gitignore` — if you drag
your whole folder including `node_modules` or `.env`, it'll upload those too, which is
slow and, worse, would expose your API key publicly. Two safer options:
- Before dragging, manually delete your local `node_modules` folder and `.env` file from
  the copy you're uploading (you can always run `npm install` again and recreate `.env`
  afterward).
- Or install **GitHub Desktop** (https://desktop.github.com) — a proper app that respects
  `.gitignore` automatically. Recommended if you'll make more changes later.

**Double-check after uploading**: open your repo on GitHub and confirm there is no `.env`
file listed. If you see one, delete it immediately from GitHub (it means your key was
exposed — go regenerate your Gemini key at https://aistudio.google.com/apikey if this
happens).

---

## Part 2: Create your database on Supabase

1. Go to https://supabase.com, sign up for free, and create a **New Project**.
   - Pick any name and a database password (save this password somewhere — you won't
     need to type it again for this guide, but keep it just in case).
   - Pick the region closest to you.
2. Wait about a minute for the project to finish setting up.
3. In the left sidebar, click the **SQL Editor** icon.
4. Click **New query**, paste this in, and click **Run**:

   ```sql
   create table sessions (
     code text primary key,
     data jsonb not null,
     updated_at timestamptz default now()
   );
   ```

5. In the left sidebar, click the **gear icon (Project Settings)** → **API**.
6. You'll need two values from this page:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **service_role key** (under "Project API keys" — NOT the "anon" key; the service
     role key is needed so the server can read/write freely. Keep this secret, same as
     your Gemini key.)

Keep this tab open — you'll paste these into Render in Part 3.

---

## Part 3: Deploy on Render

1. Go to https://render.com and sign up for free (signing up with your GitHub account is
   easiest, since it connects the two automatically).
2. From the Render dashboard, click **New +** → **Web Service**.
3. Connect your GitHub account if prompted, then select your `ai-dnd` repository.
4. Fill in the settings:
   - **Name**: anything, e.g. `ai-dnd`
   - **Region**: any
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
5. Scroll to **Environment Variables** and add these (click "Add Environment Variable"
   for each):
   - `GEMINI_API_KEY` → your Gemini key
   - `GEMINI_MODEL` → `gemini-3.8-flash`
   - `SUPABASE_URL` → the Project URL from Part 2
   - `SUPABASE_KEY` → the service_role key from Part 2
6. Click **Create Web Service**.

Render will now build and deploy your app — this takes a few minutes the first time.
When it's done, you'll get a public URL like `https://ai-dnd-xxxx.onrender.com`.

**That URL is your game, live on the internet.** Share it with friends — they just open
it in a browser, no setup needed on their end.

---

## The one quirk: free tier "sleep"

Render's free tier puts your server to sleep after 15 minutes of no traffic. The next
person to visit the URL after that will see it take up to a minute to "wake up" — this is
normal, just a one-time delay per idle period, not a bug. Your saved adventures are safe
either way since they live in Supabase, not on Render's disk.

If this delay bothers you and you're willing to spend a little money later, Render's
paid tier removes it — but that's optional and not something you need for this guide.

---

## Updating your game later

Whenever Claude gives you updated files:
1. Replace the files in your local `ai-dnd` folder as before.
2. Upload the changed files to your GitHub repo the same way (or, if using GitHub
   Desktop, just commit and push — much easier for repeated updates).
3. Render automatically redeploys within a minute or two of detecting the change on
   GitHub. No need to touch the Render dashboard again unless you're changing environment
   variables.
