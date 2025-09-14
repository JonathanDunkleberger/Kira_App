export function createBackoff(min = 500, max = 10_000, factor = 1.7) {
  let attempt = 0;
  return () => Math.min(max, Math.round(min * Math.pow(factor, attempt++)));
}

export type ConnectionState = 'open' | 'retry' | 'closed';

export function connectWithBackoff(
  url: string,
  onMsg: (m: MessageEvent) => void,
  onState: (s: ConnectionState) => void,
): () => void {
  const nextDelay = createBackoff();
  let ws: WebSocket | null = null;
  let closed = false;

  const open = () => {
    ws = new WebSocket(url);
    ws.onopen = () => onState('open');
    ws.onmessage = onMsg;
    ws.onclose = async () => {
      if (closed) return onState('closed');
      onState('retry');
      const delay = nextDelay();
      await new Promise((r) => setTimeout(r, delay));
      open();
    };
    ws.onerror = () => {
      /* handled by close */
    };
  };
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
