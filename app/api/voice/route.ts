export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Json = Record<string, any>;

export async function GET(_req: Request) {
  // @ts-ignore Edge runtime provides WebSocketPair
  const pair = new WebSocketPair();
  const client = (pair as any)[0] as WebSocket;
  const server = (pair as any)[1] as WebSocket;

  // @ts-ignore Edge runtime WebSocket has accept()
  server.accept();
  let timer: number | undefined;

  server.addEventListener('message', (ev: MessageEvent) => {
    try {
      if (typeof ev.data === 'string') {
        const msg: Json = JSON.parse(ev.data);
        if (msg.t === 'client_ready') {
          // @ts-ignore setInterval present in Edge
          timer = setInterval(() => {
            server.send(JSON.stringify({ t: 'heartbeat', now: Date.now() }));
          }, 1000) as any;
          server.send(JSON.stringify({ t: 'hello', ok: true }));
          return;
        }
        if (msg.t === 'mute') {
          server.send(JSON.stringify({ t: 'muted', value: !!msg.muted }));
          return;
        }
        if (msg.t === 'end_chat') {
          server.send(JSON.stringify({ t: 'ended' }));
          try { if (timer) clearInterval(timer as any); } catch {}
          server.close();
          return;
        }
      }
      // Binary audio ignored in stub (ev.data instanceof ArrayBuffer / Blob)
    } catch {
      // ignore parse errors
    }
  });

  server.addEventListener('close', () => {
    try { if (timer) clearInterval(timer as any); } catch {}
  });

  // @ts-ignore webSocket is an allowed Edge ResponseInit extension
  return new Response(null, { status: 101, webSocket: client });
}
