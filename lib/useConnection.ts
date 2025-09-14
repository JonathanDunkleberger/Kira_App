'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnState = 'idle' | 'connecting' | 'open' | 'retry' | 'closed';

interface UseConnectionOptions<T> {
  url: string | (() => string);
  parse?: (event: MessageEvent) => T | null;
  onMessage?: (msg: T, raw: MessageEvent) => void;
  auto?: boolean;
  minDelay?: number;
  maxDelay?: number;
  factor?: number;
  jitter?: number; // 0..1 fraction of delay spread
}

function backoffFactory(min: number, max: number, factor: number) {
  let attempt = 0;
  return () => Math.min(max, Math.round(min * Math.pow(factor, attempt++)));
}

export function useConnection<T = any>(options: UseConnectionOptions<T>) {
  const {
    url,
    parse,
    onMessage,
    auto = true,
    minDelay = 500,
    maxDelay = 10_000,
    factor = 1.7,
    jitter = 0.2,
  } = options;
  const [state, setState] = useState<ConnState>(auto ? 'connecting' : 'idle');
  const [messages, setMessages] = useState<T[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const stopRef = useRef(false);
  const nextDelay = useRef<() => number>(() => maxDelay);
  const manualClose = useRef(false);

  const resolveUrl = useCallback(() => (typeof url === 'function' ? (url as any)() : url), [url]);

  const connect = useCallback(() => {
    manualClose.current = false;
    stopRef.current = false;
    if (!nextDelay.current) nextDelay.current = backoffFactory(minDelay, maxDelay, factor);
    setState('connecting');
    let current: WebSocket | null = null;
    const openSocket = () => {
      if (stopRef.current) return;
      const u = resolveUrl();
      current = new WebSocket(u);
      wsRef.current = current;
      current.onopen = () => {
        setState('open');
      };
      current.onmessage = (ev) => {
        let parsed: T | null = null;
        try {
          parsed = parse ? parse(ev) : (JSON.parse(ev.data) as any as T);
        } catch {
          parsed = null;
        }
        if (parsed) {
          setMessages((m) => [...m, parsed!]);
          onMessage?.(parsed, ev);
        }
      };
      current.onclose = () => {
        if (manualClose.current) {
          setState('closed');
          return;
        }
        setState('retry');
        const base = nextDelay.current ? nextDelay.current() : maxDelay;
        const spread = base * jitter;
        const delay = base - spread / 2 + Math.random() * spread;
        setTimeout(openSocket, delay);
      };
      current.onerror = () => {
        // rely on close for retry
      };
    };
    openSocket();
  }, [factor, jitter, maxDelay, minDelay, onMessage, parse, resolveUrl]);

  const send = useCallback((data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === 'string' ? data : JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  const close = useCallback(() => {
    manualClose.current = true;
    stopRef.current = true;
    wsRef.current?.close();
    setState('closed');
  }, []);

  useEffect(() => {
    if (auto) {
      connect();
      return () => {
        manualClose.current = true;
        stopRef.current = true;
        wsRef.current?.close();
      };
    }
  }, [auto, connect]);

  return { state, send, close, messages, connect } as const;
}
