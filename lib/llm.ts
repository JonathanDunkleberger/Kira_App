import OpenAI from 'openai';
import { env } from './env';
import { CHARACTER_SYSTEM_PROMPT, FEW_SHOTS } from './prompt';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export async function chatRespond(userText: string): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: CHARACTER_SYSTEM_PROMPT },
    ...FEW_SHOTS.flatMap(s => ([
      { role: 'user', content: s.user },
      { role: 'assistant', content: s.assistant }
    ])),
    { role: 'user', content: userText }
  ];

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.7,
    max_tokens: 220
  });

  const text = resp.choices[0]?.message?.content ?? '';
  return text.trim();
}
