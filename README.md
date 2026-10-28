<p align="center">
  <img src="web/public/icon-256.png" alt="Sostituto" width="96" height="96">
</p>

<h1 align="center">Sostituto</h1>
<p align="center"><b>Your personal AI Composer agent</b></p>

Sostituto is a local app that turns an AI agent into a songwriting and film-scoring partner. You talk to it about your song or soundtrack (chords, melody, groove, arrangement, mood), and it does two jobs at once:

1. **Creative partner**: it suggests progressions, variations, bass lines, melodies, contrast and arrangement ideas based on what the piece already has and what you want it to feel like.
2. **Secretary**: it writes everything down in plain Markdown notes inside your music vault (Obsidian-compatible), so the next conversation picks up exactly where you left off.

It runs on your own computer, works with your files, and uses the AI subscription you already have. You don't need an API key.

> The app's interface and the assistant speak **Portuguese** by default. You can edit the assistant's prompt in the app's Settings.

---

## The idea

Composing with an AI chat usually falls apart after a few sessions. The context is lost, ideas get mixed up with decisions, and nothing ends up in your project folder. Sostituto keeps the creative conversation and the project memory together:

- **One folder per song** in your vault, with a fixed structure the agent understands.
- **One conversation per song per day.** Each day has its own session note.
- **Your decisions stay yours.** The agent records what *you* decided separately from what *it* suggested, and never promotes a suggestion to a decision on its own.
- **Your files are protected.** Your exports, your original scores and imported originals are off-limits to the agent. This is enforced by the app, not just requested in the prompt.

## Features

| | |
|---|---|
| 💬 **Composition chat** | A chat window per song. Ask for options, explanations in scale degrees and harmonic functions, or arrangement directions. The agent gives 2–3 alternatives and explains the effect of each. |
| 📝 **Automatic notes** | After each answer, the agent updates the day's session note (decisions, new ideas, suggestions, discarded ideas, open questions, next steps) and creates or updates idea notes. It records everything in a single tool call, so annotating doesn't slow the conversation down. |
| 🌙 **Close the day** (*Fechar o dia*) | One button wraps up the session. It updates the song's index (where you stopped, current structure, key/BPM, links) and writes the next steps. If you forget, the agent closes the previous day on your next visit. |
| 🎹 **MIDI generation** | Ask for a progression, bass line, melody or drum groove and get a `.mid` file you can drag into your DAW. It is saved under `Ideias/<song part>/` (for example `Ideias/Verso/` or `Ideias/Refrão/`). If the part isn't clear, the agent asks first. |
| 📥 **Import a song from notes** | Point the app at an existing song folder (its summary note). The agent reorganizes sessions, ideas, analyses and references into the Sostituto structure. Your originals are copied and left untouched. |
| 📥 **Import a song from MIDI** | Pick a MIDI file and the app reads it: tempo, meter, key signature, estimated key, tracks, instruments, markers and lyrics. The agent then asks a few questions (genre, references, structure, whether it's finished) and builds the song's notes. |
| 🤖 **Choose your AI** | Switch between **Claude**, **Codex** and **Kimi** right in the chat, at any time. When you switch mid-day, the new agent gets a recap of the conversation. Each one uses its own subscription login. |
| 🧠 **Think harder** (*Pensar mais*) | A per-message toggle that uses a deeper model or a higher reasoning effort for the hard questions. |
| 🔎 **References** | When the agent researches something (a genre's typical progressions, rhythms, textures), it saves the findings with their sources and its confidence level in `Referências/`. |
| 🗂️ **File panel** | Browse the song folder, preview notes (with clickable `[[wikilinks]]`) and download files. |
| ⚙️ **Settings** | Edit the assistant's prompt, choose models and effort, and adjust permissions globally or per song. |

## How it works

```
┌────────────┐     ┌──────────────────────────┐     ┌───────────────────────┐
│  Browser   │ ──▶ │  Sostituto server (Node) │ ──▶ │  AI agent             │
│  (chat UI) │ ◀── │  127.0.0.1 only          │ ◀── │  Claude / Codex / Kimi│
└────────────┘     └────────────┬─────────────┘     └───────────┬───────────┘
                                │  app tools (notes, MIDI,      │
                                │  copy, safe file writes)      │
                                ▼                               │
                     ┌──────────────────────┐                   │
                     │  Your vault          │ ◀─────────────────┘
                     │  Músicas/<Song>/…    │   (reads; writes only
                     └──────────────────────┘    through app tools)
```

1. The server builds each conversation from your **assistant prompt**, the **app rules** (`CLAUDE.md`) and the song context (index, latest session note, file list). The agent doesn't need to re-read everything at the start.
2. The agent works inside the song's folder. Occasional tasks (importing, closing the day) come with their own **on-demand instructions** (`instruções/`), so the everyday prompt stays short.
3. Writing goes through **app tools**: `anotar` (notes), `gerar_midi` (MIDI files), `copiar_arquivo` (binary files) and, for Codex and Kimi, `escrever_arquivo` / `editar_arquivo`. Every write is checked against the same safety rules.
4. With Claude, the agent runs through the Claude Agent SDK. Codex and Kimi run through their official CLIs, with their own file-writing tools and terminal disabled. They reach the app tools through a local MCP server.

### The vault structure

```
Músicas/
  <Song name>/
    _índice.md            ← song index: intent, structure, key/BPM, where we stopped
    Sessões/AAAA-MM-DD.md ← one note per day
    Ideias/               ← idea notes + generated MIDI (Ideias/<part>/…)
    Análises/             ← analyses, original score (read-only)
    Referências/          ← research, with sources and confidence
    Export/               ← yours only: the agent never writes here
    Importado/            ← untouched copy of imported originals (read-only)
```

### Safety rules (enforced by the app)

Whatever is asked in the conversation, the agent **cannot**:

- write, move or rename anything in `Export/`;
- modify `.mscz` scores;
- write outside `Músicas/`, inside `Importado/`, or in the song's `.claude/` settings;
- run terminal commands (so it has no way to delete files).

It never overwrites your versions: its own versions get new names (`-2`, `-3`…).

## Getting started

### Requirements

- **Node.js 20+**
- At least one AI subscription:
  - **Claude**: sign in with [Claude Code](https://claude.com/claude-code) (`claude`, then `/login`). This is the default provider.
  - **Codex** (optional): a ChatGPT plan that includes Codex.
  - **Kimi** (optional): a Kimi membership that includes Kimi Code.

### Install and run

```bash
npm install
npm start          # builds the UI and starts the server
```

Open **http://localhost:4517**. On the first run the app creates a vault at `~/Sostituto` (you can change it in Settings) and copies its default prompt and permission settings from the templates.

```bash
npm run restart    # stop the running server and start again
npm stop           # stop the server
```

### Optional: Codex and Kimi

Log in once from a regular terminal. The logins are stored in the app's own `data/` folder, separate from your global CLI configuration.

```bash
npm run login:codex   # opens the browser to sign in with your ChatGPT account
npm run login:kimi    # in Kimi Code, type /login, choose "Kimi Code OAuth", then /exit
```

Then pick the provider in the chat, above the 🧠 button.

## Project layout

```
server/src/     Node server (Fastify): chat, providers, app tools, MIDI read/write, safety guard
web/src/        Chat UI (React + Vite)
instruções/     On-demand instructions for occasional tasks
scripts/        stop/restart, provider login, Kimi safety hook
CLAUDE.md       App rules injected into every conversation
prompt-assistente.padrao.md     Default assistant prompt (copied to prompt-assistente.md)
claude-settings/settings.example.json  Default permissions (copied to settings.json)
config.example.json             Example local config (vault path, port)
```

Your personal files (`config.json`, `prompt-assistente.md`, `claude-settings/settings.json`, conversations and logins in `data/`) are git-ignored.

## Current limitations

- Sostituto doesn't **listen** to audio. It works from MIDI, notes and what you describe, and it says so.
- Outside of the MIDI import, it can't read a `.mid` file you send yet. Audio analysis isn't available either.
- There's no built-in MIDI player or score viewer yet. Open the files in your DAW or notation app.
- Codex and Kimi support is new. Their answers arrive in blocks rather than word by word, and "Think harder" doesn't change anything on Kimi yet.

## License

Sostituto is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).

- ✅ **Allowed:** personal use, study, hobby projects, research and other noncommercial purposes, as well as use by charities, schools and other noncommercial organizations. You may modify the code and share it under the same terms.
- ❌ **Not allowed:** any commercial use, such as selling the software, offering it as a paid service, or using it in a for-profit product or business.

For commercial use, contact the author for a separate license.

This is a *source-available* license, not an OSI-approved open-source license. Third-party dependencies keep their own licenses.
