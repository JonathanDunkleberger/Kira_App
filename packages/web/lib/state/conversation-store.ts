import { create } from 'zustand';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

interface ConversationState {
  messages: Message[];
  isSpeaking: boolean;
  setSpeaking: (isSpeaking: boolean) => void;
  addMessage: (message: { role: 'user' | 'assistant'; content: string; isPartial?: boolean }) => void;
  clearMessages: () => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  messages: [],
  isSpeaking: false,

  setSpeaking: (isSpeaking) => set({ isSpeaking }),

  addMessage: ({ role, content, isPartial }) => {
    set((state) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (isPartial && lastMessage?.role === 'assistant') {
        const updatedMessages = [...state.messages];
        updatedMessages[updatedMessages.length - 1] = {
          ...lastMessage,
          content: lastMessage.content + content,
        };
        return { messages: updatedMessages };
      }
      return { messages: [...state.messages, { role, content }] };
    });
  },

  clearMessages: () => set({ messages: [] }),
}));
