// Deprecated shim: forward all imports to the canonical TypeScript implementation.
// This avoids accidental usage of outdated API fields (audio_content vs audioContent)
// under different module resolvers (NodeNext/tsx) in dev or production.
export { GoogleSTTStreamer } from "./google-stt-streamer.ts";
