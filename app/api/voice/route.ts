export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

// Tunables
const EOU_SILENCE_MS = 800; // ms of silence to finalize utterance
const SYS_PROMPT = `You are Kira, an empathetic, concise voice companion. Keep replies short and natural for speech.`;

type J = Record<string, any>;

async function transcribeWebmToText(webm: Blob): Promise<string> {
  const form = new FormData();
  form.append('file', webm as any, 'audio.webm');
  form.append('model', 'whisper-1');
  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form as any,
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  return (data.text || '').trim();
}

async function replyLLM(input: string): Promise<string> {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: input },
      ],
      temperature: 0.7,
      max_tokens: 180,
    }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

export async function GET(req: Request) {
  // @ts-ignore
  const pair = new WebSocketPair();
  const client = (pair as any)[0] as WebSocket;
  const server = (pair as any)[1] as WebSocket;

  // @ts-ignore Edge runtime WebSocket has accept()
  server.accept();

  let hb: number | undefined;
  let chunks: Uint8Array[] = [];
  let eouTimer: number | undefined;
  let busy = false;

  const flushEOU = async () => {
    if (busy) return;
    busy = true;
    const size = chunks.reduce((n, u) => n + u.byteLength, 0);
    if (!size) {
      busy = false;
      return;
    }
    // Ensure proper BlobPart[] types
    const webm = new Blob(
      chunks.map((c) => new Uint8Array(c)),
      { type: 'audio/webm' },
    );
    chunks = [];
    try {
      const text = await transcribeWebmToText(webm);
      if (!text) {
        busy = false;
        return;
      }
      const reply = await replyLLM(text);
      if (!reply) {
        busy = false;
        return;
      }
      server.send(JSON.stringify({ t: 'speak', on: true }));
      const ttsUrl = `/api/tts?q=${encodeURIComponent(reply)}`;
      server.send(JSON.stringify({ t: 'tts_url', url: ttsUrl }));
      setTimeout(
        () => {
          try {
            server.send(JSON.stringify({ t: 'speak', on: false }));
          } catch {}
        },
        Math.min(6000, 800 + reply.length * 35),
      );
    } catch (e: any) {
      try {
        server.send(JSON.stringify({ t: 'error', msg: String(e?.message || e) }));
      } catch {}
    } finally {
      busy = false;
    }
  };

  const pokeEOU = () => {
    if (eouTimer) clearTimeout(eouTimer as any);
    // @ts-ignore
    eouTimer = setTimeout(flushEOU, EOU_SILENCE_MS) as any;
  };

  server.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data;
    if (data && typeof data !== 'string') {
      if (data instanceof ArrayBuffer) {
        chunks.push(new Uint8Array(data));
      } else if (data instanceof Blob) {
        // @ts-ignore
        data.arrayBuffer().then((ab: ArrayBuffer) => chunks.push(new Uint8Array(ab)));
      }
      pokeEOU();
      return;
    }
    try {
      const msg: J = JSON.parse(typeof data === 'string' ? data : '{}');
      if (msg.t === 'client_ready') {
        // @ts-ignore
        hb = setInterval(
          () => server.send(JSON.stringify({ t: 'heartbeat', now: Date.now() })),
          1000,
        ) as any;
        return;
      }
      if (msg.t === 'mute') return;
      if (msg.t === 'end_chat') {
        try {
          if (hb) clearInterval(hb as any);
        } catch {}
        try {
          if (eouTimer) clearTimeout(eouTimer as any);
        } catch {}
        server.close();
        return;
      }
      if (msg.t === 'eou') {
        flushEOU();
        return;
      }
    } catch {}
  });

  server.addEventListener('close', () => {
    try {
      if (hb) clearInterval(hb as any);
    } catch {}
    try {
      if (eouTimer) clearTimeout(eouTimer as any);
    } catch {}
  });

  // @ts-ignore Edge Response supports webSocket init property
  return new Response(null, { status: 101, webSocket: client });
}
