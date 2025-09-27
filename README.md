# ✨ Kira AI — Monorepo (Web + Realtime Voice Server)

Voice‑first AI media companion. Browser UI (Next.js) + dedicated realtime WebSocket server for STT → LLM → TTS. This README documents the *current* monorepo layout and deployment model (Vercel + Render).

> Official site: <https://www.xoxokira.com>

---

## 📦 Packages

| Path | Name | Purpose |
| ---- | ---- | ------- |
| `packages/web` | `web` | Next.js App Router frontend (UI, auth, billing UX) |
| `packages/socket-server` | `socket-server` | Plain Node WS server: Deepgram STT, OpenAI responses, Azure TTS, usage metering |
| `prisma/` (root) | — | Shared Prisma schema + migrations used by both packages |

Root `package.json` exposes convenience scripts for parallel dev.

---

## 🚀 Key Capabilities

- Low‑latency voice loop: microphone → streaming STT → LLM → streaming TTS.
- Server‑authoritative usage & limits (daily seconds, guest IP fallback).
- Upgrade nudges & limit banner (`LimitBanner`) triggered by `limit_exceeded` event.
- Pluggable TTS (Azure default, ElevenLabs optional).
- Clean public env surface via `publicEnv` (only `NEXT_PUBLIC_*`).

---

## 🗂️ Monorepo Scripts (Root)

```bash
npm run dev         # Run socket server (port 10000 or PORT) + web (3000) in parallel
npm run dev:server  # Only websocket server
npm run dev:web     # Only frontend
npm run build       # Build frontend (web)
npm run start       # Start production frontend
```

Package‑local scripts follow conventional names (`npm run build --workspace=socket-server`, etc.).

---

## 🔑 Environment Variables

Copy `.env.example` → `.env.local`. Frontend only sees `NEXT_PUBLIC_*`.

| Category | Vars |
| -------- | ---- |
| Auth (Clerk) | `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` (server only) |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Deepgram STT | `DEEPGRAM_API_KEY` |
| Azure TTS | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| ElevenLabs (optional) | `TTS_PROVIDER=elevenlabs`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` |
| Usage limits | `FREE_DAILY_LIMIT_SECONDS`, `FREE_TRIAL_SECONDS` (names may evolve) |
| Realtime | `NEXT_PUBLIC_WEBSOCKET_URL` (e.g. ws://localhost:10000) |
| Database | `DATABASE_URL` (Postgres for Prisma) |

Only the websocket server needs the STT / TTS secrets; keep them out of `NEXT_PUBLIC_*`.

---

## 🔁 Realtime Event Protocol (Representative)
﻿# ✨ Kira AI — Voice‑First Media Companion

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FJonathanDunkleberger%2FKira_AI_2)

Kira is a voice‑first AI media companion, inspired by the fluid, low‑latency conversational UX of apps like Sesami AI. The goal: eliminate alt‑tab friction so you can talk to an AI while gaming, reading, or watching media—hands free.

**Live Demo:** <https://www.xoxokira.com>

---

## Core Features

- **End-to-End Voice Streaming:** Real-time pipeline: client microphone → Deepgram STT (streaming) → OpenAI response (streaming) → Azure Speech TTS (sentence streaming back to browser).
- **Dual-Service Architecture:** Stateless Next.js frontend (Vercel) + dedicated Node WebSocket server (Render) for persistent audio sessions.
- **Authentication:** Clerk-powered user accounts (sign up, sign in, profile management).
- **Subscription Billing:** Stripe Checkout + Billing Portal; server-side webhook processing (subscription lifecycle).
- **Modern Monorepo:** `pnpm` workspaces (`packages/web`, `packages/socket-server`) with shared Prisma schema.

---

## Tech Stack

| Area | Technology / Service |
| :--- | :--- |
| **Frontend** | Next.js 14 (App Router), React 18, Tailwind CSS, Vercel |
| **Realtime Backend** | Node.js, `ws` WebSocket server (Render) |
| **Database** | Supabase (PostgreSQL) + Prisma ORM |
| **Auth** | Clerk |
| **Billing** | Stripe (Checkout + Portal + Webhooks) |
| **Speech-to-Text** | Deepgram Live |
| **Language Model** | OpenAI (streamed responses) |
| **Text-to-Speech** | Azure Speech (per-sentence streaming) |

---

## Architecture Overview

Monorepo layout:

| Path | Description |
| ---- | ----------- |
| `packages/web` | Next.js frontend (UI, auth, billing routes, static assets) |
| `packages/socket-server` | Long-running WebSocket server orchestrating STT → LLM → TTS pipeline |
| `prisma/` | Shared Prisma schema & migrations |

The WebSocket server manages: audio ingestion, transcription buffering, LLM stream aggregation, sentence boundary detection, Azure TTS synthesis, usage accounting, and event emission back to the client.

---

### Architecture Diagram

```mermaid
flowchart LR
    subgraph Browser (Vercel - packages/web)
        MIC[Microphone]
        HK[useKiraSocket Hook]
        Q[Playback Queue]
        UI[Chat / Transcript UI]
    end

    subgraph Render (packages/socket-server)
        WS[WebSocket Server]
        STT[Deepgram Streaming STT]
        LLM[OpenAI Streaming Response]
        SB[Sentence Buffer]
        TTS[Azure Speech TTS]
        USG[Usage Meter]
        DB[(Postgres / Supabase)]
    end

    MIC -->|Opus/WebM chunks| HK -->|binary frames| WS
    WS -->|audio stream| STT -->|final sentences| SB
    SB -->|prompt segments| LLM -->|token stream| SB
    SB -->|complete sentence text| TTS -->|audio chunks (base64)| WS -->|assistant_audio events| Q --> UI
    STT -->|user_transcript events| WS --> HK --> UI
    LLM -->|assistant_message events| WS --> HK --> UI
    USG -->|usage_update events| WS --> HK --> UI
    WS -->|persist user/assistant messages| DB
    USG -->|read/write usage| DB
```

---

## Getting Started

### 1. Clone

```bash
git clone https://github.com/JonathanDunkleberger/Kira_AI_2.git
cd Kira_AI_2/ai-media-companion
```

### 2. Install Dependencies (pnpm preferred)

```bash
pnpm install
```

### 3. Environment Variables

Two `.env.local` files are required for local dev:

**A. Frontend (root `./.env.local`)** — copy `./.env.example`.

**B. Socket Server (`./packages/socket-server/.env.local`)** — copy `./packages/socket-server/.env.example`.

Fill in service keys (leave `NEXT_PUBLIC_*` only in the root file). Never commit secrets.

### 4. Run Locally

```bash
pnpm dev
```
Frontend: <http://localhost:3000>  
WebSocket server: ws://localhost:10000 (health: GET <http://localhost:10000/healthz>)

Root scripts:

```bash
pnpm run dev        # parallel: socket-server + web
pnpm run dev:server # only socket-server
pnpm run dev:web    # only web
pnpm run build      # build web
pnpm run start      # start production web
```

---

## Environment Reference (Union of Examples)

Frontend `.env.example`:
```text
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=
DATABASE_URL=
DIRECT_URL=
STRIPE_SECRET_KEY=
STRIPE_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=https://www.xoxokira.com
NEXT_PUBLIC_WEBSOCKET_URL=wss://kira-voice-ws.onrender.com
```

Socket server `.env.example`:
```text
DATABASE_URL=
DIRECT_URL=
DEEPGRAM_API_KEY=
OPENAI_API_KEY=
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
```

Keep STT / LLM / TTS secrets out of any `NEXT_PUBLIC_*` names.

---

## Realtime Flow (High Level)

1. Browser captures mic (MediaRecorder WebM Opus) → sends binary chunks via WS.
2. Server streams audio to Deepgram → receives interim/final transcripts.
3. Final sentence aggregated → prompt sent to OpenAI (streaming tokens).
4. Sentence buffer triggers Azure TTS; audio chunks base64-encoded → client.
5. Client queues & plays audio while next sentence is already processing.
6. Usage metering updates sent periodically; limits enforced server-side.

---

## Deployment

### Frontend (Vercel)

1. Import repo → set root (or monorepo framework auto-detect) pointing to repository root (build script targets `packages/web`).
1. Configure env vars from root example (exclude STT/LLM/TTS secrets unless needed by API routes).
1. Build output: `.next` (handled automatically).

### WebSocket Server (Render)

1. New Web Service → Root Directory: `packages/socket-server`.
1. Build Command:
```bash
pnpm install --filter socket-server... && pnpm --filter socket-server run build
```
1. Start Command:
```bash
pnpm --filter socket-server start
```
1. Set env vars: `DATABASE_URL`, `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, Stripe keys, Clerk secrets.
1. Copy deployed wss URL into Vercel `NEXT_PUBLIC_WEBSOCKET_URL`.

### Prisma
Run migrations anywhere both services can reach the DB:
```bash
pnpm --filter web prisma:deploy
```
or
```bash
pnpm --filter socket-server prisma:deploy
```

---

## Testing & Quality

| Command | Purpose |
| ------- | ------- |
| `pnpm --filter web lint` | Lint code (web) |
| `pnpm --filter web test` | Unit tests (Vitest) |
| `pnpm --filter web typecheck` | TypeScript diagnostics |
| `pnpm --filter web build` | Build Next.js app |
| `pnpm --filter socket-server build` | Compile server TS → JS |

Add Playwright tests as needed for end-to-end voice flows.

---

## Security & Secrets

History was scrubbed to remove an accidental code dump. If rotating keys:
1. Revoke old Azure / OpenAI / Stripe / Clerk / Supabase keys.
2. Issue new keys; store only in appropriate `.env.local` / hosting provider dashboard.
3. Never commit raw dumps containing secrets.

---

## Roadmap (Sample)
1. Conversation persistence + titles.
2. Rich memory window / context summarization.
3. Improved adaptive VAD + silence trimming.
4. Fine-grained streaming prosody controls.
5. Progressive enhancement for low-bandwidth clients.

---

## Contributing
PRs welcome. Before submitting:
```bash
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test
```
Document any new env var in BOTH example files.

---

## License
MIT — see `LICENSE`.

---

## Attribution / Inspiration
Inspired by modern low-latency conversational assistants (e.g., Sesami AI) emphasizing real-time bidirectional streaming UX.

