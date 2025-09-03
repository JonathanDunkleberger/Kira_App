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
- 📈 Freemium SaaS: Metered usage with Guest, Registered Free, and Pro plans; Stripe handles subscriptions.
- 🧠 Persistent memory (Pro): Long‑term memory for a personalized companion experience.
- 🌐 Accessible anywhere: 100% web‑based—no installs required.
- 🔐 Secure & private: Supabase Auth with per‑user conversation history.

---

## 🛠️ Tech Stack & Architecture

Modern web architecture with a dedicated real‑time voice server. Business logic (entitlements, usage, plans) is server‑authoritative; the UI uses centralized state for predictability.

| Category | Technology |
|---|---|
| Frontend | Next.js, React, Tailwind CSS, Framer Motion |
| Voice backend (real‑time) | Node WebSocket server (ws) on Render |
| App APIs | Next.js API Routes (Vercel or any Node host) |
| Database | Supabase (Postgres), Supabase Auth, Row‑Level Security |
| AI | Whisper (STT), OpenAI Chat Completions (LLM), Azure TTS (streaming) |
| Payments | Stripe Checkout & Webhooks |

---

## 🏆 Highlights & Engineering Challenges

- Server‑authoritative entitlements: Rebuilt plan/usage logic to eliminate inconsistencies across Guest/Free/Pro.
- Frictionless conversion funnel: Guest → signup → claim conversation flow; proactive upgrade nudge.
- Polished UX: Dynamic, voice‑driven orb animation (Web Audio API) and tuned VAD for natural back‑and‑forth.

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

- NEXT_PUBLIC_WEBSOCKET_URL (e.g. ws://localhost:8080 for dev)
- NEXT_PUBLIC_WEBSOCKET_URL_PROD (wss://your-render-service.onrender.com)
- OPENAI_API_KEY, OPENAI_MODEL
- SUPABASE_URL, SUPABASE_ANON_KEY (client)
- SUPABASE_SERVICE_ROLE_KEY (server, on Render), SUPABASE_URL
- AZURE_* for TTS

---

## ⏯️ Getting Started (local)

1) Copy environment template and fill values

```bash
cp .env.example .env.local
```

1) Install dependencies and run both Next.js and the voice WS server

```bash
npm install
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000)

Notes:

- `npm run dev` runs Next (port 3000) and the WS server (default port 8080) in parallel.
- Set `NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:8080` in `.env.local` for the client to connect.
- The WS server exposes `/healthz` and requires a Supabase auth token via `?token=`; the client attaches it automatically. Active conversation id is sent as `?conversationId=`.

---

## 🧪 Testing (Playwright)

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

## 📝 Notes

- The WS pipeline is STT → memory fetch (last 6 messages) → LLM → TTS streaming back to the client.
- Entitlements/limits are enforced server‑side; the UI reflects state from server responses.
