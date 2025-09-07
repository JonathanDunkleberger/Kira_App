# ADR 0002: Chat pipeline v1 (overview)

Date: 2025-09-07

Status: Proposed

## Context

We support an interactive chat experience with two transport layers:

- HTTP (REST) for session/auth, conversation CRUD, text-only requests, and other non-realtime actions.
- WebSocket for low-latency streaming of audio input/output and assistant tokens.

## Current flow (high-level)

1) Client boot
   - Fetches config (`/api/config`), reads env, and initializes Supabase auth.
2) Start/continue a conversation
   - For anonymous users, we create/ensure an anon session; for signed-in users we claim/attach a conversation.
   - Conversation metadata is managed via HTTP endpoints under `/api/conversations*`.
3) Realtime turn
   - A WebSocket connection is created to the voice server (URL from `NEXT_PUBLIC_WEBSOCKET_URL*`).
   - Query params include: `conversationId`, `token` (Supabase access token), and `tts` preference.
   - Client streams microphone audio; server streams interim text and synthesized audio back.
   - Turn timing is recorded (first text chunk, audio start) for UX metrics.
4) Post-turn updates
   - HTTP endpoints record usage, streaks, and analytics (e.g., paywall nudges, upgrade clicks).

## Where WS is used vs HTTP

- WebSocket: audio capture, assistant text chunks, and audio playback events.
- HTTP: conversation CRUD, summarization, sharing, stripe billing, usage counters, and auth/session exchange.

## Legacy paths and plan

- Any prior one-off or non-streaming endpoints for audio should be retired in favor of the single WS path used by `useVoiceSocket`.
- Keep `/api/messages` for pure text (non-audio) requests.
- As we iterate, consolidate client hooks to prefer the simple voice socket where appropriate and remove older variants after parity.

## Decision

- Keep current split (HTTP for control/data ops, WS for realtime audio/text streaming).
- Continue migrating legacy/non-streaming audio logic to the WS server.

## Consequences

- Clear separation of concerns improves reliability and testability.
- Single WS path simplifies client code and observability.
- Requires good fallback/error handling if WS is unreachable; HTTP-only flows must continue to work.
