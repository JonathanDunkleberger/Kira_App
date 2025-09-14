# Deployment Guide

Monorepo: `packages/web` (Next.js) + `packages/socket-server` (WebSocket realtime server).

---
## 1. Prerequisites
- Node 20.x
- Postgres database (if enabling persistence) and `DATABASE_URL` secret
- Accounts / API keys: Clerk, OpenAI, Deepgram, Azure Speech (or ElevenLabs), Stripe

---
## 2. Environment Variable Matrix

| Scope | Variable | Notes |
| ----- | -------- | ----- |
| Frontend (Vercel) | `NEXT_PUBLIC_WEBSOCKET_URL` | wss://<render-host>/ (or ws://localhost:10000 in dev) |
| Frontend (Vercel) | `CLERK_PUBLISHABLE_KEY` | Public key only |
| Backend (Render) | `CLERK_SECRET_KEY` | Needed if server validates sessions (future) |
| Both (if DB) | `DATABASE_URL` | Postgres connection string |
| Backend | `OPENAI_API_KEY` | LLM responses |
| Backend | `OPENAI_MODEL` | Optional override (default set in code) |
| Backend | `DEEPGRAM_API_KEY` | Streaming STT (omit => mock) |
| Backend | `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | Azure TTS default |
| Backend (optional) | `TTS_PROVIDER=elevenlabs` | Switch TTS provider |
| Backend (optional) | `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | ElevenLabs creds |
| Backend | `FREE_DAILY_LIMIT_SECONDS` | Daily free allowance |
| Backend | `FREE_TRIAL_SECONDS` | Initial trial (if distinct) |

Only `NEXT_PUBLIC_*` vars are exposed to the browser.

---
## 3. Local Verification
```bash
npm install
cp .env.example .env.local
npm run dev
```
Visit http://localhost:3000 then open WebSocket console to confirm connection to `ws://localhost:10000`.

---
## 4. Frontend (Vercel)
1. Create new Vercel project.
2. Project settings → Root Directory: `packages/web` (or keep root and set build command manually).
3. Build Command (if custom):
   ```bash
   npm install
   npm run build --workspace=web
   ```
4. Output Directory: `.next` (detected automatically).
5. Set Environment Variables (Production / Preview) — copy from the table above.
6. After deploying, verify logs show successful Next build and that `NEXT_PUBLIC_WEBSOCKET_URL` points to the Render URL.

### Optional Optimizations
- Enable Vercel Edge for lightweight API routes (if they remain stateless).
- Add `NEXT_TELEMETRY_DISABLED=1` to reduce noise.

---
## 5. Realtime WebSocket Server (Render)
1. New Web Service → Select repo → Root Directory: `packages/socket-server`.
2. Environment: Node 20.
3. Build Command:
   ```bash
   npm install --production=false --workspace=socket-server && npm run build --workspace=socket-server
   ```
4. Start Command:
   ```bash
   npm run start --workspace=socket-server
   ```
5. Add required secrets (OpenAI, Deepgram, Azure, usage limits, DB if used).
6. Health Check Path: `/healthz` (server should respond 200).
7. Note final public URL; set it as `NEXT_PUBLIC_WEBSOCKET_URL` in Vercel (wss://... ).

### Scaling & Performance
- Render autoscaling: set min=1 for warm start; scale on CPU or connection count.
- CPU-bound steps: TTS synth & LLM call (network dominated) — vertical scale usually sufficient early on.
- Consider moving LLM / TTS to async streaming workers if concurrency grows.

---
## 6. Prisma Migrations
Run in Render deploy hook or manual job:
```bash
npx prisma migrate deploy
```
If both services need DB access, run migrations once (frontend build phase or a dedicated job) to avoid race.

---
## 7. Post-Deployment Smoke Test
| Step | Expectation |
| ---- | ----------- |
| Open site | Landing loads, no console errors |
| Start conversation | WebSocket connects (101 Switching Protocols) |
| Speak | `user_transcript` then `assistant_message` events arrive |
| Audio playback | Hear synthesized TTS; no long initial latency (>3s) |
| Usage tick | `usage_update` events increment seconds |
| Limit test | Temporarily set very low `FREE_DAILY_LIMIT_SECONDS` to trigger `limit_exceeded` |

---
## 8. Rollback Strategy

---

## 8a. Stripe Webhook Configuration

1. In Stripe Dashboard → Developers → Webhooks, add an endpoint pointing to:
   - Production: `https://<your-vercel-domain>/api/stripe/webhook`
   - Local (via Stripe CLI):
     ```bash
     stripe listen --forward-to localhost:3000/api/stripe/webhook
     ```
2. Copy the signing secret provided by Stripe; set as `STRIPE_WEBHOOK_SECRET` (Render + Vercel if both need to verify, though only the Vercel frontend route currently handles events).
3. Recommended events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Extend the route handlers (`app/api/stripe/webhook/route.ts`) to persist subscription status via Prisma when those tables are introduced.

Stripe CLI test:
```bash
stripe trigger checkout.session.completed
```
- Vercel: redeploy previous successful build from dashboard.
- Render: select prior build from deploy history and promote.
- Keep DB migrations backward-compatible (additive first) to enable safe rollback.

---
## 9. Observability & Logging
- Add basic log drain (Render) and Vercel Log Streams if volume grows.
- Recommended future additions:
  - Structured JSON logs with request / session correlation id.
  - Metrics: active connections, avg STT latency, avg TTS latency, over‑limit events count.
  - Alert budget on 5xx or failed LLM calls.

---
## 10. Security Checklist
- Ensure no secret appears in client bundle (`grep -R OPENAI_API_KEY .next` should be empty).
- Restrict CORS / WS origin if abuse observed (currently open by design for demo).
- Rotate API keys quarterly.
- Add basic rate limiting (IP) for connection attempts.

---
## 11. Future Enhancements
- Containerize both services (Docker) for uniform infra.
- Dedicated usage aggregation worker (cron) vs inline heartbeat finalization.
- Multi-region deployment (latency reduction for STT/TTS).

---
## 12. Quick Reference
```bash
# Build only
npm run build --workspace=web
npm run build --workspace=socket-server

# Start prod locally
npm run start --workspace=web
npm run start --workspace=socket-server
```

---
Happy shipping! 🎙️
