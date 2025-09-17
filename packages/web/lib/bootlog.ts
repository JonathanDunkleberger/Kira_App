'use client';
// Boot-time health logging for voice subsystem.
// (legacy useVoiceSocket removed)

(function bootLog() {
  if (typeof window === 'undefined') return; // only client
  try {
    const prod = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
    const legacy = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
    const modern = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
    const resolved = modern || (process.env.NODE_ENV === 'production' ? prod : legacy) || '(unset)';
    if (!prod && !legacy && !modern) {
      console.warn('[boot] No NEXT_PUBLIC_WEBSOCKET_URL* envs found; voice ws disabled until set');
    }
    console.log('[boot] voice ws url:', resolved);
    console.log('[boot] voice ws binaryType target: arraybuffer');
  } catch (e) {
    console.warn('[boot] voice log error', e);
  }
})();
