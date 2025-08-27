import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { CHARACTER_SYSTEM_PROMPT, FEW_SHOTS } from "./prompt";

const provider = (process.env.LLM_PROVIDER || 'openai') as 'openai' | 'gemini';
const openaiKey = process.env.OPENAI_API_KEY || '';
const geminiKey = process.env.GOOGLE_GEMINI_API_KEY || '';
const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

function buildPrompt(userText: string) {
  const fewShotText = FEW_SHOTS
    .map((s) => `User: ${s.user}\nKira: ${s.assistant}`)
    .join("\n\n");
  return `${CHARACTER_SYSTEM_PROMPT}

${fewShotText}

User: ${userText}
Kira:`;
}

function postProcess(text: string) {
  return text.trim().replace(/\*[^*]+\*/g, "").replace(/\([^)]+\)/g, "");
}

export async function generateReply(userText: string) {
  const prompt = buildPrompt(userText);

  // Prefer OpenAI if available or explicitly selected
  if ((provider === 'openai' || !geminiKey) && openaiKey) {
    try {
      const openai = new OpenAI({ apiKey: openaiKey });
      const resp = await openai.chat.completions.create({
        model: openaiModel,
        messages: [
          { role: 'system', content: CHARACTER_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 400
      } as any);
      const text = resp.choices?.[0]?.message?.content || '';
      if (text) return postProcess(text);
    } catch (e) {
      console.warn('OpenAI failed, falling back to Gemini:', e);
    }
  }

  // Fallback to Gemini
  if (geminiKey) {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: geminiModel });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 400,
      },
    });
    const text = result.response.text();
    return postProcess(text);
  }

  throw new Error('No LLM configured. Set OPENAI_API_KEY or GOOGLE_GEMINI_API_KEY');
}
