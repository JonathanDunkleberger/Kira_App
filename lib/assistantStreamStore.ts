import { create } from 'zustand';

interface AssistantStreamState {
  streaming: boolean;
  text: string;
  start: () => void;
  append: (t: string) => void;
  finalize: (t?: string) => void;
  reset: () => void;
}

export const useAssistantStream = create<AssistantStreamState>((set) => ({
  streaming: false,
  text: '',
  start: () => set({ streaming: true, text: '' }),
  append: (t) => set((s) => ({ text: s.text + t })),
  finalize: (t) => set((s) => ({ streaming: false, text: t ?? s.text })),
  reset: () => set({ streaming: false, text: '' }),
}));
