// Simple WebSocket server for streaming audio frames and responses
// Run alongside Next.js during development

import { WebSocketServer } from 'ws';

const PORT = Number(process.env.WS_PORT || 8080);

const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  console.log(`WS server listening on ws://localhost:${PORT}`);
});

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`WS client connected${ip ? ` from ${ip}` : ''}`);

  ws.on('message', (data: Buffer, isBinary) => {
    const size = data?.byteLength ?? 0;
    console.log(`WS message received: ${size} bytes${isBinary ? ' (binary)' : ''}`);
    // Future: route audio to STT -> LLM -> TTS and ws.send() back audio frames
  });

  ws.on('close', () => {
    console.log('WS client disconnected');
  });

  ws.on('error', (err) => {
    console.error('WS client error:', err);
  });
});

wss.on('error', (err) => {
  console.error('WS server error:', err);
});
