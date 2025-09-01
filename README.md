✨ Kira AI — The Web-Based Media Companion
Your voice-first AI companion, re-imagined for the web.
Live Demo kira-ai-2.vercel.app

🚀 From Desktop Hobby Project to Scalable SaaS
This project is the professional, web-based evolution of the original open-source Kira AI VTuber, a Python-based desktop application.

The goal of this new version was to take the core concept of a voice-first AI companion and re-architect it as a scalable, accessible, and commercially viable SaaS application. By moving to a web-native stack, Kira is no longer a complex local setup but a seamless experience available to anyone in a browser.

🎯 Key Features
🎙️ Seamless Voice Conversations: Engage in fluid, natural conversations. The intelligent Voice Activity Detection (VAD) means you can just start talking, and Kira listens and responds without the need for push-to-talk.

📈 Freemium SaaS Model: Kira operates on a metered-usage model with three distinct user states (Guest, Registered Free, and Pro), powered by Stripe for secure subscriptions.

🧠 Persistent Memory (Pro Feature): Pro subscribers unlock Kira's long-term memory, allowing her to recall details from previous conversations for a truly personalized companion experience.

🌐 Accessible Anywhere: As a fully web-based application, there are no downloads or complicated installations. If you have a browser, you can talk to Kira.

🔐 Secure & Private: User authentication is handled securely by Supabase Auth, and conversation history is private to each registered user.

🛠️ Tech Stack & Architecture
This project was built with a modern, scalable, serverless architecture to ensure reliability and a high-quality user experience.

Category	Technology
Frontend	Next.js, React, Tailwind CSS, Framer Motion
Backend	Next.js API Routes (Serverless Functions on Vercel)
Database	Supabase (Postgres), Supabase Auth, Row Level Security
AI Pipeline	OpenAI Whisper (STT), OpenAI/Gemini (LLM), Microsoft Azure (TTS)
Payments	Stripe Checkout & Webhooks
The application's frontend relies on a centralized state management pattern to ensure a predictable UI. The backend uses a server-authoritative model for all business logic, including the robust entitlement system that manages user plans and daily usage limits.

🏆 Project Highlights & Engineering Challenges
This wasn't just a rebuild; it was a comprehensive refactoring focused on stability and commercial viability.

Architected a Bug-Free Entitlement System: Diagnosed and resolved persistent, critical bugs related to inconsistent state management. I designed and implemented a new server-authoritative system from scratch to handle user plans, daily time limits, and guest sessions reliably.

Designed a Frictionless Conversion Funnel: Engineered the complete user journey from a free guest session to a paying subscriber. This included building a proactive "nudge" system and a seamless guest-to-user conversation claiming process that preserves user history after signup.

Implemented a Polished User Experience: Overhauled the core user interface, including a dynamic, voice-driven orb animation using the Web Audio API and fine-tuning the Voice Activity Detection (VAD) for a more natural and responsive conversational flow.

🔑 Environment Setup
This project is configured via environment variables and is not intended to be a step-by-step open-source guide. The setup expects the following keys:

Supabase URL & Keys

Stripe API & Webhook Keys

OpenAI & Azure API Keys

Application URL & Free Trial Configuration