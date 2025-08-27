# 🎙️ AI Media Companion — Web App Extension

A production-ready Next.js 14 app that turns your local AI VTuber companion into a push-to-talk, metered, paid web experience. Minimal stack, real auth + billing, and a polished voice UX.


## 🧱 What you’ll deploy

- A single Next.js 14 (App Router) app on Vercel
- Server routes:
  - `GET /api/session` (Edge): auth + grant ephemeral session + report remaining trial seconds
  - `POST /api/utterance` (Node): mic audio → STT → LLM → Azure TTS → return MP3
  - `POST /api/stripe/create-checkout` (Node): Stripe Checkout
  - `POST /api/stripe/webhook` (Node): Stripe webhook → grant plan
- Data on Supabase:
  - `user_memories` (optional)
  - `usage_counters` (track seconds + chars)
  - `entitlements` (free vs paid)


## 🗺️ Architecture

- Client UI
  - Push-to-talk button (pulsing orb)
  - Transcript pane
  - Barge-in: starting to talk cancels current playback
  - Soft earcon if response prep > 800ms (no filler speech)
- Server
  - Auth via Supabase Auth
  - Session ephemeralization in `/api/session`
  - ASR in `lib/stt.ts`, LLM in `lib/llm.ts`, TTS in `lib/tts.ts` (Azure Ashley)
  - Usage metering in `lib/usage.ts`
  - Stripe Checkout + Webhook for entitlements


## 🔐 Real Auth + Metering

- Client uses Supabase Auth UI (via `@supabase/auth-helpers-nextjs`).
- In `/api/session`:
  - Read `user_id` from Supabase session
  - `ensureEntitlements(userId, FREE_TRIAL_SECONDS)`
  - Return `secondsRemaining` for the client
- In `/api/utterance`:
  - After `ttsToMp3Base64`, call `decrementSeconds(userId, estSeconds)`
  - If balance ≤ 0, return `HTTP 402` with `{ paywall: true }`


## 🚦 Rate limits

- Simple per-IP limiter (store counts in Supabase keyed by `ip + hour`)
- Reject new utterances if exceeding N per minute


## 🔔 Earcon

- If `/api/utterance` takes >800ms to respond, play a subtle chime on the client before the reply arrives — keeps the experience “alive” without filler speech.


## ⏯️ Barge-in polish

- If the user presses and holds while a reply is playing, immediately pause audio and discard any queued playback.


## 🔄 Roadmap: Realtime / Gemini

- Replace `lib/stt.ts` and `lib/llm.ts` with a WebRTC Live adapter later.
- Keep `lib/tts.ts` (Azure Ashley) as-is for voice identity.


## 💸 Why this gets you to $1.99 quickly

- The PTT flow is intuitive and unjarring.
- Voice is yours (Ashley + pitch/rate), preserving your product’s identity.
- Stack is minimal yet production-grade: Vercel + Supabase + Stripe + Azure + OpenAI.
- Add avatars/personalities as “skins” later without touching the core loop.


## 🧰 Tech stack

- Next.js 14 (App Router), TypeScript, Edge + Node runtimes
- Supabase (Auth, Postgres, RLS)
- Stripe (Checkout + Webhooks)
- Azure Speech (TTS: Ashley)
- OpenAI (LLM)
- Vercel (hosting)


## 🧪 Local development

Prereqs:
- Node 18+ and pnpm/yarn/npm
- Supabase project (URL + anon key)
- Stripe test keys
- Azure Speech key + region
- OpenAI API key

Install and run:

```bash
# install deps
pnpm install

# run dev
pnpm dev
```

The app should be available at http://localhost:3000.


## 🔧 Environment variables

Copy `.env.example` to `.env.local` and fill in values:

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


## 🚀 Deploy

Vercel
- Import this repo
- Add all environment variables from above
- Set the following route runtimes:
  - `/api/session` → Edge
  - `/api/utterance` → Node.js
  - `/api/stripe/*` → Node.js

Supabase
- Run `supabase/migrations.sql`
- Create policies to scope rows by `user_id`

Stripe
- Create a Price and set `STRIPE_PRICE_ID`
- Add a webhook endpoint at `/api/stripe/webhook` with the signing secret in `STRIPE_WEBHOOK_SECRET`

Azure Speech
- Create a Speech resource, set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`


## 🧾 API overview

- `GET /api/session` (Edge)
  - Input: cookie-based auth (Supabase)
  - Output: `{ secondsRemaining: number, ephemeralToken?: string }`

- `POST /api/utterance` (Node)
  - Input: audio blob or stream (PCM/WEBM), user_id from session
  - Steps: STT → LLM → TTS
  - Output: `{ audioBase64: string, transcript: string }`
  - Errors: `402 { paywall: true }` when out of balance

- `POST /api/stripe/create-checkout` (Node)
  - Input: `{ priceId }`
  - Output: `{ url }` to redirect

- `POST /api/stripe/webhook` (Node)
  - Handles checkout completion → grants entitlements


## 📂 Project structure

```
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


## ✅ Status and next steps

- Core PTT loop and server routes scaffolded
- Wire Supabase Auth UI on client
- Implement `ensureEntitlements`, `decrementSeconds`, and per-IP limiter
- Add earcon on >800ms response time
- Polish barge-in: discard queued playback on hold
- Later: swap STT/LLM to WebRTC Live; keep Azure Ashley voice


---

Questions or ideas? Open an issue or start a discussion. Let’s ship it. 🚀

