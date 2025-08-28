import { CHARACTER_SYSTEM_PROMPT, FEW_SHOTS } from "./prompt";
// Use type-only imports so they don't affect bundling
import type { Content } from "@google/generative-ai";
import type { ChatCompletionMessageParam } from "openai/resources/index.mjs";

function postProcess(text: string) {
  return text.trim().replace(/\*[^*]+\*/g, "").replace(/\([^)]+\)/g, "");
}

export async function generateReply(userText: string): Promise<string> {
  // Read env at runtime (not module init) to avoid build-time analysis issues
  const provider = (process.env.LLM_PROVIDER || 'openai') as 'openai' | 'gemini';
  const openaiKey = process.env.OPENAI_API_KEY || '';
  const geminiKey = process.env.GOOGLE_GEMINI_API_KEY || '';
  const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  // Prefer OpenAI if available or explicitly selected
  if ((provider === 'openai' || !geminiKey) && openaiKey) {
    try {
  // Lazy-load OpenAI SDK
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: openaiKey });

      // Properly structured message history
      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: CHARACTER_SYSTEM_PROMPT },
        ...FEW_SHOTS.flatMap(shot => ([
          { role: 'user' as const, content: shot.user },
          { role: 'assistant' as const, content: shot.assistant },
        ])),
        { role: 'user', content: userText },
      ];

      const resp = await openai.chat.completions.create({
        model: openaiModel,
        messages,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 400,
      });

      const text = resp.choices?.[0]?.message?.content || '';
      if (text) return postProcess(text);

    } catch (e) {
      console.warn('OpenAI failed, falling back to Gemini:', e);
    }
  }

  // Fallback to Gemini
  if (geminiKey) {
  // Lazy-load Gemini SDK
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: geminiModel });
      const history: Content[] = FEW_SHOTS.flatMap(shot => ([
          { role: "user", parts: [{ text: shot.user }] },
          { role: "model", parts: [{ text: shot.assistant }] },
      ]));

      const chat = model.startChat({
          history,
          generationConfig: {
              temperature: 0.7,
              topP: 0.9,
              maxOutputTokens: 400,
          },
          systemInstruction: {
            role: "system",
            parts: [{ text: CHARACTER_SYSTEM_PROMPT }]
          }
      });
      
      const result = await chat.sendMessage(userText);
      const text = result.response.text();
      return postProcess(text);
  }

  throw new Error('No LLM configured. Set OPENAI_API_KEY or GOOGLE_GEMINI_API_KEY');
}
