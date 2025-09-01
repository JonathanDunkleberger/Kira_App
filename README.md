# Kira AI

## Your Voice-First AI Media Companion

**[Live Demo](https://kira.ai)**

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?logo=supabase)
![Stripe](https://img.shields.io/badge/Stripe-Checkout-635BFF?logo=stripe)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)


## Overview & Demo

Kira AI is a voice-first, real-time media companion that turns conversation into creation. It combines speech-to-text, LLM reasoning, and lifelike text-to-speech to deliver a natural, hands-free experience. The product is built as a modern, freemium SaaS with a robust paywall and a conversion-focused user journey.

<!-- Replace with an actual product GIF/screencast -->
![Kira AI demo](https://user-images.githubusercontent.com/placeholder/kira-demo.gif)


## Key Features

- Intelligent Voice Activity Detection: Seamless, hands-free conversation—just start talking and Kira responds.
- Robust Usage Metering: A server-authoritative entitlement system built on Supabase to manage daily time limits for free-tier users.
- Freemium SaaS Model: A complete subscription system with three distinct user states (Guest, Registered Free, and Pro) powered by Stripe.
- Proactive Upgrade Nudge: A subtle, one-time nudge below a usage threshold that accelerates conversion without interrupting flow.
- Seamless Guest-to-User Claiming: After signup, conversations started as a guest are automatically claimed to the new account.
- Real-Time STT → LLM → TTS Loop: Production-grade pipeline for natural conversations.


## Tech Stack & Architecture

- Frontend: Next.js, React, Tailwind CSS, Framer Motion
- Backend: Next.js App Router (API Routes), Vercel Serverless Functions
- Database: Supabase (Postgres), including Auth and database functions
- AI Pipeline: OpenAI Whisper (STT), OpenAI/Gemini (LLM), Microsoft Azure (TTS)
- Payments: Stripe Checkout & Webhooks

Kira AI is built on a modern, scalable, serverless architecture. The front-end leverages a centralized state management pattern to ensure a predictable UI, while the backend uses a server-authoritative model for all business logic, including the robust entitlement and payment systems.


## Project Highlights (What I'm Proud Of)

- End-to-End Refactoring: Led a full-stack refactor that transformed a buggy prototype into a stable, commercially viable V1. This involved diagnosing persistent state management issues, eliminating technical debt, and establishing a new, robust architecture.
- Architected a Scalable Entitlement System: Designed and implemented a server-authoritative system from scratch to manage user plans and daily usage limits, solving critical bugs related to inconsistent state.
- Designed a Seamless Conversion Funnel: Engineered the complete user journey from a free guest session to a paying subscriber, including a proactive nudge system and a frictionless guest-to-user conversation claiming process.


## Local Development

Environment Setup (required .env.local keys)

Supabase

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

Stripe

- STRIPE_SECRET_KEY
- STRIPE_PRICE_ID
- STRIPE_WEBHOOK_SECRET (optional)

AI

- OPENAI_API_KEY (optional)
- GOOGLE_GEMINI_API_KEY (optional)
- LLM_PROVIDER (openai|gemini)
- OPENAI_MODEL / GEMINI_MODEL (optional)

Azure Speech (TTS)

- AZURE_SPEECH_KEY
- AZURE_SPEECH_REGION
- AZURE_TTS_VOICE (default en-US-AshleyNeural)
- AZURE_TTS_RATE (default +25%)
- AZURE_TTS_PITCH (default +25%)

App

- APP_URL
- FREE_TRIAL_SECONDS
- PRO_SESSION_SECONDS (default 1800)
- ALLOWED_ORIGIN
- DEV_ALLOW_NOAUTH (optional)

