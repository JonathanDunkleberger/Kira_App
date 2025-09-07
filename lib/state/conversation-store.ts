// lib/state/conversation-store.ts
'use client'
import { create } from 'zustand'

interface ConversationMessage { role: 'user' | 'assistant'; content: string }

type ConversationStatus = 'idle' | 'listening' | 'processing' | 'speaking'

interface ConversationState {
  status: ConversationStatus
  messages: ConversationMessage[]
  currentAudio: Blob | null
  wsConnection: WebSocket | null

  setStatus: (status: ConversationStatus) => void
  addMessage: (message: ConversationMessage) => void
  setAudio: (audio: Blob | null) => void
  setWsConnection: (ws: WebSocket | null) => void
  reset: () => void
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  status: 'idle',
  messages: [],
  currentAudio: null,
  wsConnection: null,

  setStatus: (status) => set({ status }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setAudio: (audio) => set({ currentAudio: audio }),
  setWsConnection: (ws) => set({ wsConnection: ws }),
  reset: () => set({ status: 'idle', messages: [], currentAudio: null, wsConnection: null })
}))
