// lib/server/openai-compat.ts
// Minimal "OpenAI" class compatible with the parts of the SDK you use.
// It calls the REST API with fetch under the hood.

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export default class OpenAI {
  private apiKey: string;
  private baseURL: string;

  constructor(cfg: { apiKey?: string; baseURL?: string } = {}) {
    this.apiKey = cfg.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseURL = cfg.baseURL ?? 'https://api.openai.com/v1';
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is missing');
  }

  chat = {
    completions: {
      create: async (args: {
        model: string;
        messages: ChatMessage[];
        max_tokens?: number;
        temperature?: number;
        top_p?: number;
        presence_penalty?: number;
        frequency_penalty?: number;
        response_format?: any;
      }) => {
        const r = await fetch(`${this.baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(args),
        });
        if (!r.ok) {
          const body = await r.text().catch(()=> '');
          throw new Error(`OpenAI chat failed: ${r.status} ${body}`);
        }
        return await r.json();
      },
    },
  };

  embeddings = {
    create: async (args: { model: string; input: string | string[] }) => {
      const r = await fetch(`${this.baseURL}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
      });
      if (!r.ok) {
        const body = await r.text().catch(()=> '');
        throw new Error(`OpenAI embeddings failed: ${r.status} ${body}`);
      }
      return await r.json();
    },
  };
}
