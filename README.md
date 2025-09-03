# ✨ Kira AI — The Web‑Based Media Companion

Your voice‑first AI companion, re‑imagined for the web.

Live Demo: [kira-ai-2.vercel.app](https://kira-ai-2.vercel.app)

<!-- Demo screenshot -->
<p align="center">
  <img src="ai-media-companion/public/KIRA%202%20README%20PICv2.png" alt="Kira – voice companion demo" width="900">
</p>

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

Built on a modern serverless architecture for reliability and a high‑quality UX. The server enforces business logic (entitlements, usage, plans); the UI uses centralized state for predictability.

| Category | Technology |
|---|---|
| Frontend | Next.js, React, Tailwind CSS, Framer Motion |
| Backend | Next.js API Routes (Vercel Serverless) |
| Database | Supabase (Postgres), Supabase Auth, Row‑Level Security |
| AI | OpenAI Whisper (STT), OpenAI/Gemini (LLM), Microsoft Azure (TTS) |
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

---

## ⏯️ Getting Started (local)

1) Copy environment template and fill values

```bash
cp .env.example .env.local
```

2) Install dependencies and run the dev server

```bash
npm install
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000)

---

## 🧪 Testing (Playwright)

Basic Playwright scaffolding is included. Microphone permissions are granted in `playwright.config.ts`.

```bash
npx playwright test
```

---

## � Notes

- Production builds use `npm run build` and deploy on Vercel.
- Entitlement resets are server‑authoritative and configured via environment variables.
