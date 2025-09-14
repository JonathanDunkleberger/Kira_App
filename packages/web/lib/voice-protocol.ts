// Shared voice WebSocket protocol types
// Discriminated unions for all client<->server messages.

export type ClientEvent =
  | { t: 'client_ready'; persona?: string; session?: string; ua?: string }
  | { t: 'eou' }
  | { t: 'end_chat' }
  | { t: 'mute'; on: boolean };

export type ServerEvent =
  | { t: 'chat_session'; chatSessionId: string }
  | { t: 'heartbeat'; now: number; chatSessionId: string }
  | { t: 'transcript'; text: string }
  | { t: 'assistant_text_chunk'; text?: string; done?: true }
  | { t: 'tts_start' }
  | { t: 'tts_chunk'; b64: string }
  | { t: 'tts_end' }
  | { t: 'speak'; on: boolean }
  | { t: 'error'; message: string };

export type AnyEvent = ClientEvent | ServerEvent;

export function isServerEvent(e: any): e is ServerEvent {
  if (!e || typeof e !== 'object') return false;
  return (
    e.t === 'chat_session' ||
    e.t === 'heartbeat' ||
    e.t === 'transcript' ||
    e.t === 'assistant_text_chunk' ||
    e.t === 'tts_start' ||
    e.t === 'tts_chunk' ||
    e.t === 'tts_end' ||
    e.t === 'speak' ||
    e.t === 'error'
  );
}

export function isClientEvent(e: any): e is ClientEvent {
  if (!e || typeof e !== 'object') return false;
  return e.t === 'client_ready' || e.t === 'eou' || e.t === 'end_chat' || e.t === 'mute';
}

// Narrow helpers
export type ServerEventMap = {
  chat_session: Extract<ServerEvent, { t: 'chat_session' }>;
  heartbeat: Extract<ServerEvent, { t: 'heartbeat' }>;
  transcript: Extract<ServerEvent, { t: 'transcript' }>;
  assistant_text_chunk: Extract<ServerEvent, { t: 'assistant_text_chunk' }>;
  tts_start: Extract<ServerEvent, { t: 'tts_start' }>;
  tts_chunk: Extract<ServerEvent, { t: 'tts_chunk' }>;
  tts_end: Extract<ServerEvent, { t: 'tts_end' }>;
  speak: Extract<ServerEvent, { t: 'speak' }>;
  error: Extract<ServerEvent, { t: 'error' }>;
};

export type ServerEventType = keyof ServerEventMap;

export function assertNever(x: never): never {
  throw new Error('Unexpected object: ' + JSON.stringify(x));
}
