import { create } from 'zustand';

interface PartialState {
  partial: string;
  setPartial: (t: string) => void;
  clear: () => void;
}

export const usePartialStore = create<PartialState>((set) => ({
  partial: '',
  setPartial: (t) => set({ partial: t }),
  clear: () => set({ partial: '' }),
}));
