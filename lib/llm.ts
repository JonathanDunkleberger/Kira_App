import { GoogleGenerativeAI } from "@google/generative-ai";
import { CHARACTER_SYSTEM_PROMPT, FEW_SHOTS } from "./prompt";

const API_KEY = process.env.GOOGLE_GEMINI_API_KEY!;
if (!API_KEY) throw new Error("Missing GOOGLE_GEMINI_API_KEY");

const genAI = new GoogleGenerativeAI(API_KEY);
const MODEL_ID = "gemini-1.5-flash";

export async function generateReply(userText: string) {
  const model = genAI.getGenerativeModel({ model: MODEL_ID });

  const fewShotText = FEW_SHOTS
    .map((s) => `User: ${s.user}\nKira: ${s.assistant}`)
    .join("\n\n");

  const prompt = `${CHARACTER_SYSTEM_PROMPT}

${fewShotText}

User: ${userText}
Kira:`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 400,
    },
  });

  const text = result.response.text().trim();
  const clean = text.replace(/\*[^*]+\*/g, "").replace(/\([^)]+\)/g, "");
  return clean;
}
