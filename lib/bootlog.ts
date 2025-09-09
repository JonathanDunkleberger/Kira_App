'use client';
// Boot-time health logging for voice subsystem.
import { } from './useVoiceSocket'; // for side-effect type refs

(function bootLog(){
  if (typeof window === 'undefined') return; // only client
  try {
    const prod = process.env.NEXT_PUBLIC_WEBSOCKET_URL_PROD;
    const legacy = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
    const modern = process.env.NEXT_PUBLIC_VOICE_WS_URL;
    const resolved = (modern || (process.env.NODE_ENV==='production'? prod : legacy) || '/api/voice (fallback)');
    if (!prod && !legacy && !modern) {
      console.warn('[boot] No NEXT_PUBLIC_WEBSOCKET_URL* envs found, falling back to /api/voice');
    }
    console.log('[boot] voice ws url:', resolved);
    console.log('[boot] voice ws binaryType target: arraybuffer');
  } catch (e) {
    console.warn('[boot] voice log error', e);
  }
})();
