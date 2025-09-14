# ✨ Kira AI — Monorepo (Web + Realtime Voice Server)

Voice‑first AI media companion. Browser UI (Next.js) + dedicated realtime WebSocket server for STT → LLM → TTS. This README documents the *current* monorepo layout and deployment model (Vercel + Render).

> Live demo (frontend): https://kira-ai-2.vercel.app

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

| Direction | Event | Payload Notes |
| --------- | ----- | ------------- |
| server→client | `server_ack` | Initial confirmation + usage snapshot |
| client→server | `user_audio` | Binary Opus/WebM frames (48k) |
| server→client | `user_transcript` | Final STT segment (text) |
| server→client | `assistant_message` | Assistant text (complete or streaming) |
| server→client | `assistant_audio` | Base64 WAV/Opus chunk(s) |
| server→client | `assistant_speaking_start` / `assistant_speaking_end` | Playback lifecycle |
| server→client | `usage_update` | Periodic seconds used / remaining |
| server→client | `limit_exceeded` | Hard stop message & UI trigger |

Client renders interim partials locally; authoritative usage ticks originate from server heartbeat.

---

## 🛠️ Local Development

```bash
npm install
cp .env.example .env.local
# edit .env.local -> set NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:10000
npm run dev
```

Frontend: http://localhost:3000
WebSocket server: ws://localhost:10000 (health: GET http://localhost:10000/healthz)

Typical troubleshooting:
| Symptom | Check |
| ------- | ----- |
| No audio transcription | `DEEPGRAM_API_KEY` present? MIME type Opus/WebM chunking? |
| Limit banner instantly | FREE limit env values too low / usage persisted from previous day |
| 404 on assets | Ensure running from repo root (so Next sees `public/`) |

---

## 🧪 Testing & Quality

| Command | Purpose |
| ------- | ------- |
| `npm run lint --workspace=web` | ESLint (import order, TS rules) |
| `npm run test --workspace=web` | Unit tests (Vitest) |
| `npx playwright test --workspace=web` | E2E (browser + mic permissions) |
| `npm run typecheck --workspace=web` | TypeScript diagnostics |

Pre-commit (lefthook) runs prettier + lint.

---

## 🚢 Deployment

### Frontend (Vercel)
1. Set project root to `packages/web` in Vercel settings.
2. Install build command: `npm install --workspace=web && npm run build --workspace=web` (Vercel auto handles if root has workspaces). Simpler: keep root; Vercel will detect Next in subfolder if configured.
3. Output: `.next` (served by Vercel). Ensure env vars (all needed `CLERK_*`, `NEXT_PUBLIC_WEBSOCKET_URL`, etc.) configured in Vercel dashboard.
4. Optional: set `NEXT_TELEMETRY_DISABLED=1`.

### Realtime WebSocket Server (Render)
1. New Render Web Service → Root = `packages/socket-server`.
2. Build command:
   ```bash
   npm install --production=false --workspace=socket-server && npm run build --workspace=socket-server
   ```
3. Start command:
   ```bash
   npm run start --workspace=socket-server
   ```
4. Exposes `$PORT` (Render injects). Health check path: `/healthz`.
5. Set secrets: `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, TTS provider keys, `DATABASE_URL` (if Prisma used), usage limit vars.
6. After deploy, update Vercel `NEXT_PUBLIC_WEBSOCKET_URL` to the Render wss URL.

### Database / Prisma
If Postgres backing is enabled:
```bash
npx prisma migrate deploy
```
You can run this either in a separate migration job or as a pre-start script for both services needing DB access.

---

## 🔄 Usage & Limits Model (Summary)

Server increments per active second (heartbeat interval). Guests identified by IP; authenticated users by Clerk user id. When remaining seconds ≤ 0, server sends `limit_exceeded` and ceases processing audio.

---

## 🧬 TTS / STT Switching

Azure default. For ElevenLabs add:
```bash
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=voice_id_here
```
Deepgram STT requires only `DEEPGRAM_API_KEY`. Without it, a mock path can emit placeholder transcripts (development convenience).

---

## 🗺️ Roadmap (Next)
1. Prisma endpoint wiring (`conversations`, `messages`, `usage` persistence).
2. Stripe webhooks → subscription state / entitlement elevation.
3. Achievement catalog + toast awarding pipeline.
4. ElevenLabs streaming upgrade (true chunked Opus).
5. Fine‑grained conversation memory windows.

---

## 💳 Billing & Subscription UX

The app offers a free daily usage tier and a single Pro subscription (Stripe) that unlocks unlimited conversation time.

### Components & Pages

| Path | Purpose |
| ---- | ------- |
| `app/account/billing/page.tsx` | Billing management page (plan status + actions) |
| `components/BillingStatus.tsx` | Client component fetching `/api/billing/subscription` |
| `components/Paywall.tsx` | Upgrade modal triggered by usage exhaustion / proactive click |
| `components/auth/ProfileSettingsModal.tsx` | Quick access links to billing page & portal |

### API Routes

| Route | Method | Description |
| ----- | ------ | ----------- |
| `/api/billing/subscription` | GET | Current subscription snapshot (status, plan, renewal dates) |
| `/api/billing/checkout` | POST | Creates Stripe Checkout session (requires auth) |
| `/api/billing/portal` | POST | Opens Stripe Billing Portal for customer |
| `/api/stripe/webhook` | POST | Stripe events (subscription lifecycle, invoices) |

### Client Helpers

Located in `lib/client-api.ts`:

- `startCheckout()` → POST `/api/billing/checkout` then `window.location.href` to Stripe.
- `openBillingPortal()` → POST `/api/billing/portal` then redirect.

### Subscription Sync

`/api/stripe/webhook` updates `Subscription` + `User.tier` on:

- `customer.subscription.created|updated|deleted`
- `checkout.session.completed` (provisional elevation)
- `invoice.payment_succeeded|invoice.payment_failed` (logs `PaymentEvent` + tier adjust)

Downgrade currently immediate on failure / cancellation (no grace window). Adjust in `syncSubscription` if you add grace logic.

### Environment Vars (Stripe)

| Var | Purpose |
| --- | ------- |
| `STRIPE_SECRET_KEY` | Server-side API key |
| `STRIPE_PRICE_ID` | Recurring price id for Pro plan |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature validation |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | (Optional) For any future client-side Stripe elements |

### Local Testing (Stripe CLI)

```bash
stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_succeeded,invoice.payment_failed --forward-to localhost:3000/api/stripe/webhook

# Create a checkout session
stripe checkout sessions create \
   --mode subscription \
   --success_url http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID} \
   --cancel_url http://localhost:3000/account/billing?canceled=1 \
   --line-items price=$STRIPE_PRICE_ID,quantity=1 \
   --metadata userId=clerk_user_123
```

### Future Enhancements

- Grace period + scheduled downgrade job
- Multiple plan tiers / usage entitlements
- In-app invoice list (surface `PaymentEvent` history)
- Email notifications on payment failure / trial ending

---

---

\n## 🤝 Contributing
Small, focused PRs welcome. Please run:
\n```bash
npm run lint --workspace=web
npm run typecheck --workspace=web
npm test --workspace=web
```
Document any new env vars in `.env.example`.

---

\n## 📄 License
MIT — see `LICENSE`.

---

\n## 📝 Historical Notes
Voice socket consolidated into `lib/voice.ts`; Deepgram client updated (`createClient` + `listen.live`). Limit banner shows after authoritative `limit_exceeded`.

