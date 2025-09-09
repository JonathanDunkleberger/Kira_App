import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

import { WebSocket } from 'ws';

import { generateReplyWithHistory } from '../lib/llm';
import { synthesizeSpeechStream } from '../lib/server/tts';

/**
 * Streaming transcription adapter interface.
 * Replace mock implementation with a real provider (Deepgram, AssemblyAI, etc.).
 */
export interface StreamingTranscriber extends EventEmitter {
  send(chunk: Buffer): void;
  close(): void;
}

class MockTranscriber extends EventEmitter implements StreamingTranscriber {
  private assembled: Buffer[] = [];
  private timer: any = null;
  send(chunk: Buffer) {
    this.assembled.push(chunk);
    const total = this.assembled.reduce((n, b) => n + b.length, 0);
    if (total > 3000 && !this.timer) {
      // Emit a fake partial then final shortly after
      this.emit('transcript', { text: 'mock partial', final: false });
      this.timer = setTimeout(() => {
        this.emit('transcript', { text: 'mock transcript', final: true });
        this.assembled = [];
        this.timer = null;
      }, 500);
    }
  }
  close() {
    if (this.timer) clearTimeout(this.timer);
    this.removeAllListeners();
  }
}

class DeepgramTranscriber extends EventEmitter implements StreamingTranscriber {
  private ws: WebSocket | null = null;
  private closed = false;
  private ready = false;
  private queue: Buffer[] = [];
  private key: string;
  private attempt = 0;
  private reconnectTimer: any = null;
  constructor(apiKey: string) {
    super();
    this.key = apiKey;
    this.init();
  }
  private init() {
    const url =
      'wss://api.deepgram.com/v1/listen?encoding=opus&sample_rate=48000&channels=1&model=nova-2&punctuate=true&smart_format=true';
    const headers = {
      Authorization: `Token ${this.key}`,
      'User-Agent': 'kira-voice/1.0',
      'X-Request-Id': crypto.randomUUID?.() || Math.random().toString(36).slice(2),
    } as any;
    const dg = new WebSocket(url, { headers });
    this.ws = dg;
    dg.binaryType = 'arraybuffer';
    dg.onopen = () => {
      this.ready = true;
      this.attempt = 0;
      // Flush queued audio
      this.queue.forEach((b) => this._send(b));
      this.queue = [];
    };
    dg.onmessage = (ev) => {
      try {
        const data = typeof ev.data === 'string' ? ev.data : ev.data.toString();
        const json = JSON.parse(data);
        // Deepgram streaming messages: look for channel.alternatives
        const channel = json.channel || json.channel_index !== undefined ? json : null;
        const alts = channel?.channel?.alternatives || json?.alternatives;
        const isFinal = json?.is_final || json?.speech_final || json?.type === 'final';
        const transcript = alts?.[0]?.transcript;
        if (transcript) {
          this.emit('transcript', { text: transcript, final: !!isFinal });
        }
      } catch {}
    };
    dg.onerror = (err) => {
      if (!this.closed) this.emit('error', err);
    };
    dg.onclose = () => {
      if (this.closed) return;
      this.emit('close');
      // Retry with exponential backoff (cap 8s)
      const delay = Math.min(8000, 500 * Math.pow(2, this.attempt++));
      this.reconnectTimer = setTimeout(() => {
        if (this.closed) return;
        this.init();
      }, delay);
    };
  }
  private _send(chunk: Buffer) {
    if (!this.ws || this.ws.readyState !== 1) return;
    try {
      this.ws.send(chunk);
    } catch {}
  }
  send(chunk: Buffer) {
    if (this.closed) return;
    if (!this.ready) {
      this.queue.push(chunk);
      return;
    }
    this._send(chunk);
  }
  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {}
    this.removeAllListeners();
  }
}

function createTranscriber(): StreamingTranscriber {
  const key = process.env.DEEPGRAM_API_KEY || process.env.DG_API_KEY;
  if (key) {
    return new DeepgramTranscriber(key);
  }
  return new MockTranscriber();
}

export function handleVoiceConnection(
  ws: WebSocket,
  opts: { onFinal(text: string): Promise<string>; userId?: string | null },
) {
  const transcriber = createTranscriber();
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let turnStart = 0;

  transcriber.on('transcript', async (t: { text: string; final?: boolean }) => {
    if (!t.text) return;
    if (!t.final) {
      safeJSON(ws, { t: 'partial', text: t.text });
      return;
    }
    // Final user transcript
    safeJSON(ws, { t: 'transcript', text: t.text });
    history.push({ role: 'user', content: t.text });
    turnStart = Date.now();
    let reply = '';
    try {
      // Use history-aware LLM
      reply = await generateReplyWithHistory(history, t.text, false, opts.userId || undefined);
    } catch (e: any) {
      safeJSON(ws, { t: 'error', where: 'llm', message: String(e?.message || e) });
      return;
    }

    history.push({ role: 'assistant', content: reply });
    // Begin TTS streaming
    safeJSON(ws, { t: 'tts_start' });
    try {
      await synthesizeSpeechStream(reply, async (chunk) => {
        // Send each binary chunk base64 for simplicity (could switch to binary frames later)
        if (chunk && chunk.byteLength) {
          safeJSON(ws, { t: 'tts_chunk', b64: Buffer.from(chunk).toString('base64') });
        }
      });
      safeJSON(ws, { t: 'tts_end' });
    } catch (e: any) {
      safeJSON(ws, { t: 'error', where: 'tts', message: String(e?.message || e) });
    } finally {
      const elapsed = (Date.now() - turnStart) / 1000;
      // Fire and forget usage update (elapsed approximates user speaking for now)
      if (elapsed > 0.2) {
        try {
          fetch('/api/usage/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secondsUsed: Math.ceil(elapsed) }),
          }).catch(() => {});
        } catch {}
      }
    }
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      transcriber.send(Buffer.from(data as any));
      return;
    }
    try {
      const msg = JSON.parse(data.toString());
      if (msg.t === 'end') {
        try {
          ws.close(1000, 'end');
        } catch {}
      }
    } catch {}
  });

  ws.on('close', () => transcriber.close());
  ws.on('error', () => transcriber.close());
}

function safeJSON(ws: WebSocket, obj: any) {
  if (ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {}
  }
}
