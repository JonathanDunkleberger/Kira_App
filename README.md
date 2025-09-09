# ✨ Kira AI — The Web‑Based Media Companion

Your voice‑first AI companion, re‑imagined for the web.

Live Demo: [kira-ai-2.vercel.app](https://kira-ai-2.vercel.app)

<!-- Demo screenshot -->

![Kira – voice companion demo](public/KIRA_2_Preview.png)

---

## 🚀 From Desktop Hobby Project to Scalable SaaS

This project is the professional, web-based evolution of the original open-source Kira AI VTuber, a Python-based desktop application.

The goal was to take the core concept of a voice‑first AI companion and re‑architect it as a scalable, accessible, and commercially viable SaaS. By moving to a web‑native stack, Kira becomes a seamless, browser‑based experience.

---

## 🎯 Key Features

- 🎙️ Seamless voice conversations: Voice Activity Detection (VAD) lets you just start talking—no push‑to‑talk.
- ⏱️ Server‑authoritative usage & limits: Heartbeat accrual (every few seconds) updates daily + per‑chat usage; no client drift.
- 📈 Freemium SaaS: Guest, Free, and Pro plans with Stripe subscriptions & upgrade nudges.
- 🧠 Persistent memory (Pro): Long‑term memory context for more personalized replies.
- 🌐 100% web‑based: Nothing to install; works in modern Chromium browsers.
- 🔐 Secure & private: Supabase Auth, RLS, per‑user chat history APIs.

### Unified Limit Dialog

A single `LimitDialog` component presents both daily free paywall and per‑chat cap limits. It subscribes to heartbeat payloads (`t: 'heartbeat'`) via a lightweight global callback `(window as any).__onHeartbeat(msg)` triggered after the usage store updates. This keeps enforcement server‑side while ensuring consistent, minimal UI.

```tsx
// Example wrapper
<ChatGuardrails>
  <YourChatUI />
</ChatGuardrails>
```

---

## 🛠️ Tech Stack & Architecture

Modern web architecture with a dedicated real‑time voice server. Business logic (entitlements, usage, plans) is server‑authoritative; the UI uses centralized state for predictability.

| Category                  | Technology                                                          |
| ------------------------- | ------------------------------------------------------------------- |
| Frontend                  | Next.js, React, Tailwind CSS, Framer Motion                         |
| Voice backend (real‑time) | Node WebSocket server (ws) on Render                                |
| App APIs                  | Next.js API Routes (Vercel or any Node host)                        |
| Database                  | Supabase (Postgres), Supabase Auth, Row‑Level Security              |
| AI                        | Whisper (STT), OpenAI Chat Completions (LLM), Azure TTS (streaming) |
| Payments                  | Stripe Checkout & Webhooks                                          |

---

## 🏆 Highlights & Engineering Challenges

- Heartbeat usage accrual: Server ticks entitlements & emits authoritative snapshots (eliminates race/drift).
- Entitlements schema: `user_entitlements`, `daily_usage`, `chat_sessions` plus RPC for atomic increments.
- Frictionless conversion funnel: Guest → signup → resume chat, upgrade surfaces when limits near.
- Guardrails UX: Unified LimitDialog handles both paywall and per‑chat cap states (one component, two modes).
- Polished UX: Dynamic voice orb (Web Audio API), tuned VAD, streaming TTS for rapid first phoneme.

---

## 🔑 Environment Setup

This project uses environment variables. Use `.env.example` as a template and copy to `.env.local`.

Required categories:

- Supabase URL & keys
- Stripe API & webhook secret
- OpenAI & Azure API keys
- Public app URL & free‑trial configuration
- WebSocket URL(s) for the voice server

Key client/server vars (non‑exhaustive):

- `NEXT_PUBLIC_WEBSOCKET_URL` (e.g. ws://localhost:8080 for dev)
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (client)
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `AZURE_*` for TTS
- `FREE_TRIAL_SECONDS`, `FREE_DAILY_LIMIT`, `PRO_CHAT_SESSION_LIMIT` (usage tuning)

### Realtime Speech Recognition (Deepgram)

Add `DEEPGRAM_API_KEY` to enable production streaming STT (model `nova-2`).

Client sends `audio/webm;codecs=opus` 48k mono chunks; server opens a Deepgram websocket with matching params (`encoding=opus&sample_rate=48000&channels=1`). Partial transcripts are emitted with `{ t: 'partial' }`, finals as `{ t: 'transcript' }` followed by assistant reply `{ t: 'speak' }`.

If the key is absent the server falls back to a lightweight mock transcriber so voice flow still works locally without external spend.

Partial Captions: While you speak, interim hypotheses stream in and render as a faint italic line at the bottom of the conversation (`partialStore`). They are cleared when a final transcript arrives or when the assistant begins speaking.

Auto-Retry: The Deepgram websocket now reconnects with exponential backoff (500ms doubling, capped at 8s) if the connection drops mid‑session. Audio chunks are queued while reconnecting; if reconnection fails they are discarded when the transcriber closes.

Environment only (never expose to browser):

```bash
DEEPGRAM_API_KEY=dg_secret_...
```

Future overrides (not yet parameterized): `model`, `tier`, `smart_format`, `punctuate`.

---

## ⏯️ Getting Started (Local)

1. Copy environment template and fill values

```bash
cp .env.example .env.local
```

1. Install dependencies and run both Next.js and the voice WS server

```bash
npm install
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000)

Notes:

- `npm run dev` runs Next (port 3000) + WebSocket server (port 8080) concurrently.
- Set `NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:8080` in `.env.local`.
- WS server: `/healthz` for liveness; requires Supabase auth token via `?token=` (attached automatically). Active chat session id via `?conversationId=`.
- Heartbeat: server emits usage every ~5s; client store interpolates elapsed seconds for smooth UI.

---

## 🧪 Testing

Basic Playwright scaffolding is included. Microphone permissions are granted in `playwright.config.ts`.

```bash
npx playwright test
```

---

## 📦 Build & Deploy

- Frontend (Next.js)
  - Build: `npm run build`
  - Host on Vercel or any Node host.

- Voice server (WebSocket on Render)
  - Build: `npm run build:server`
  - Start: `npm run start:server` (runs `dist/socket-server.js`)
  - Render deployment supported via `render.yaml` (binds to `PORT`, exposes `/healthz`).

## 🤝 Contributing

Contributions welcome! Ways to help:

1. Open an issue for bugs, DX papercuts, or enhancement ideas.
2. Submit a PR (small, focused changes preferred). Include context in the description.
3. Improve docs: clearer env var explanations, architecture diagrams, or onboarding notes.

Guidelines:

- Run `npm run typecheck && npm test && npm run lint` before opening a PR.
- Keep commits scoped; squash or rebase noisy fixups.
- Avoid introducing breaking env vars without documenting them in `.env.example`.

If you're unsure whether a feature fits, open an issue for discussion first.

## 📄 License

Released under the MIT License – see `LICENSE`.

## 📝 Notes

- Realtime pipeline: STT → limited history fetch → LLM response streaming → TTS stream → client playback.
- Heartbeat authoritative usage prevents client spoofing & clock drift.
- All timers in UI are display-only; enforcement lives server-side.
