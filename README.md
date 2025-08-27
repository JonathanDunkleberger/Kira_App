# 🎤 Kira AI VTuber — Web App Extension

This repo is the web app extension of the original Kira AI VTuber project. It brings Kira’s voice-first companion experience to the browser with push‑to‑talk, transcripts, real auth, metered usage, and Stripe billing.

- Original project: [Kira_AI](https://github.com/JonathanDunkleberger/Kira_AI)
- Demo GIF: [VTuber Demo — Kira v3](https://github.com/JonathanDunkleberger/Kira_AI/blob/main/VTuber%20Demo%20-%20Kirav3.gif?raw=true)


## 🧭 Overview

- Next.js 14 (App Router) frontend hosted on Vercel
- Server routes for STT → LLM → TTS loop, auth/session, and billing
- Supabase for Auth + Postgres (usage metering, entitlements, memories)
- Stripe Checkout + Webhook for paid plans
- Azure Speech (Ashley) for TTS; OpenAI for LLM

This extends the local/desktop Kira by exposing a minimal, production-grade web stack that preserves the identity and UX of the original (voice, personality, barge‑in), while adding web auth and metering.


## ✨ Features

- 🎙️ Push‑to‑Talk mic button (pulsing orb)
- 📝 Transcript pane
- ⏸️ Barge‑in: talking cancels current playback immediately
- 🔔 Earcon if response prep >800ms (no filler speech)
- 🔐 Real auth with Supabase
- 🧮 Usage metering: tracks seconds and characters
- 💳 Stripe billing with webhook‑driven entitlements
- 🚦 Simple per‑IP rate limits


## 🧱 Architecture (high level)

- Client (Next.js 14)
  - Mic capture → POST to /api/utterance
  - Plays returned MP3, shows transcript, handles barge‑in + earcon
  - Supabase Auth UI on the client
- Server (Edge + Node routes)
  - /api/session (Edge): reads Supabase session, ensures entitlements, returns secondsRemaining
  - /api/utterance (Node): audio → STT → LLM → Azure TTS (Ashley) → MP3
  - /api/stripe/create-checkout (Node): creates Stripe Checkout session
  - /api/stripe/webhook (Node): grants plan on successful events
- Data (Supabase tables)
  - entitlements (free vs paid)
  - usage_counters (seconds + chars)
  - user_memories (optional)


## 🔐 Auth + Metering flow

- Client authenticates with Supabase; session is available to server routes
- /api/session
  - ensureEntitlements(userId, FREE_TRIAL_SECONDS)
  - return secondsRemaining
- /api/utterance
  - after ttsToMp3Base64, decrementSeconds(userId, estSeconds)
  - if balance ≤ 0 → HTTP 402 with { paywall: true }


## 🚦 Rate limits

- Per‑IP limiter keyed by ip + hour in Supabase
- Reject new utterances if exceeding N/minute


## 🔔 Earcon and ⏯️ Barge‑in

- If /api/utterance >800ms, play a subtle chime so the UX feels “alive”
- If user holds PTT while audio is playing, pause immediately and discard queued playback


## 🗂️ API summary

- GET /api/session (Edge)
  - Input: cookie‑based auth (Supabase)
  - Output: { secondsRemaining: number, ephemeralToken?: string }
- POST /api/utterance (Node)
  - Input: audio blob/stream (PCM/WEBM), user_id from session
  - Steps: STT → LLM → TTS
  - Output: { audioBase64: string, transcript: string }
  - Errors: 402 { paywall: true } when out of balance
- POST /api/stripe/create-checkout (Node)
  - Input: { priceId }
  - Output: { url } (redirect)
- POST /api/stripe/webhook (Node)
  - Handles checkout completion → grants entitlements


## 🔧 Environment variables

Copy .env.example to .env.local and fill in values:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# OpenAI
OPENAI_API_KEY=

# Azure Speech (TTS)
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=

# Stripe
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_PRICE_ID=
STRIPE_WEBHOOK_SECRET=

# App
FREE_TRIAL_SECONDS=120
```


## 🧪 Local development

Prereqs

- Node 18+ (or newer) and pnpm/yarn/npm
- Supabase project (URL + anon key)
- Stripe test keys
- Azure Speech key + region
- OpenAI API key

Run

```bash
pnpm install
pnpm dev
```

App will be available at [http://localhost:3000](http://localhost:3000).


## 🚀 Deploy

- Vercel: import repo and set all env vars
  - Route runtimes: /api/session → Edge; /api/utterance and /api/stripe/* → Node.js
- Supabase: run supabase/migrations.sql and create RLS policies by user_id
- Stripe: set STRIPE_PRICE_ID and STRIPE_WEBHOOK_SECRET; add webhook to /api/stripe/webhook
- Azure Speech: set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION


## 🔄 Roadmap

- Move STT + LLM to a WebRTC Live adapter (Realtime/Gemini)
- Keep Azure Ashley TTS to preserve voice identity


## 📁 Project structure

```text
app/
  api/
    session/route.ts
    utterance/route.ts
    stripe/
      create-checkout/route.ts
      webhook/route.ts
  layout.tsx
  page.tsx
components/
  MicButton.tsx
  PulsingOrb.tsx
  Transcript.tsx
  Paywall.tsx
lib/
  env.ts
  supabaseClient.ts
  prompt.ts
  usage.ts
  audio.ts
  stt.ts
  llm.ts
  tts.ts
supabase/
  migrations.sql
```


## ✅ Status

- Web app extension scaffolded
- Core PTT loop in place (client + server)
- Auth + metering hooks defined
- Stripe integration wired (Checkout + Webhook)

---

Questions or ideas? Open an issue or start a discussion. Let’s ship it. 🚀

