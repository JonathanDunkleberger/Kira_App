// Simple event bus for voice state + audio level (optional)
// Usage:
// import { voiceBus } from '@/lib/voiceBus';
// voiceBus.emit('speaking', true|false);

class VoiceBus extends EventTarget {
  emit<T = any>(name: string, detail?: T) {
    this.dispatchEvent(new CustomEvent<T>(name, { detail }));
  }
  on<T = any>(name: string, cb: (detail: T) => void) {
    const h = (e: Event) => cb((e as CustomEvent<T>).detail);
    this.addEventListener(name, h as EventListener);
    return () => this.removeEventListener(name, h as EventListener);
  }
}

export const voiceBus = new VoiceBus();
