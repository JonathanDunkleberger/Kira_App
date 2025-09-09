export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type J = Record<string, any>;

export async function GET(req: Request) {
  // @ts-ignore
  const pair = new WebSocketPair();
  const client = (pair as any)[0] as WebSocket;
  const server = (pair as any)[1] as WebSocket;

  // @ts-ignore Edge runtime WebSocket has accept()
  server.accept();

  let hb: number | undefined;

  server.addEventListener('message', (ev: MessageEvent) => {
    try {
      if (typeof ev.data === 'string') {
        const msg: J = JSON.parse(ev.data);
        if (msg.t === 'client_ready') {
          // start heartbeat so your usage store/timer keeps moving
          // @ts-ignore
          hb = setInterval(() => {
            server.send(JSON.stringify({ t: 'heartbeat', now: Date.now() }));
          }, 1000) as any;
          return;
        }
        if (msg.t === 'mute') return;
        if (msg.t === 'end_chat') {
          try { if (hb) clearInterval(hb as any); } catch {}
          server.close();
          return;
        }
      }
      // Binary audio chunks arrive as ev.data (ignored in this stub)
    } catch {}
  });

  server.addEventListener('close', () => {
    try { if (hb) clearInterval(hb as any); } catch {}
  });

  // @ts-ignore Edge Response supports webSocket init property
  return new Response(null, { status: 101, webSocket: client });
}
