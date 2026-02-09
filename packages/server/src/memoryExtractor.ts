// packages/server/src/memoryExtractor.ts
//
// Post-conversation memory extraction (Layer 2 — Write).
// Called when a signed-in user's WebSocket disconnects.
// Sends the conversation to gpt-4o-mini, extracts structured facts,
// and stores them in the MemoryFact table.

import { OpenAI } from "openai";
import { PrismaClient } from "@prisma/client";

interface ExtractedFact {
  category: string;
  content: string;
  emotional_weight: number;
  is_update: boolean;
}

export async function extractAndSaveMemories(
  openai: OpenAI,
  prisma: PrismaClient,
  userId: string, // clerkId
  conversationMessages: Array<{ role: string; content: string }>,
  conversationSummary: string
): Promise<void> {
  try {
    // 1. Load existing memories for dedup
    const existingMemories = await prisma.memoryFact.findMany({
      where: { userId },
      orderBy: { emotionalWeight: "desc" },
      take: 50,
    });

    const existingText =
      existingMemories.length > 0
        ? existingMemories
            .map((m) => `[${m.category}] ${m.content}`)
            .join("\n")
        : "(no existing memories)";

    // 2. Build conversation text
    const conversationText = conversationMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "User" : "Kira"}: ${m.content}`)
      .join("\n");

    const fullContext = conversationSummary
      ? `[Earlier in conversation]: ${conversationSummary}\n\n[Recent]:\n${conversationText}`
      : conversationText;

    // 3. Skip extraction if conversation is too short (< 4 user messages)
    const userMessages = conversationMessages.filter(
      (m) => m.role === "user"
    );
    if (userMessages.length < 2) {
      console.log("[Memory] Conversation too short for extraction. Skipping.");
      return;
    }

    // 4. Extract via LLM
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a memory extraction system for Kira, an AI companion. Analyze this conversation and extract important facts about the user that Kira should remember for future conversations.

Extract facts into these categories:
- identity: Name, age, location, occupation, pronouns
- preference: Likes, dislikes, favorites, tastes, hobbies
- relationship: People in their life, pets, relationship dynamics
- emotional: Emotional patterns, recurring feelings, sensitivities
- experience: Shared jokes, memorable moments, callbacks
- context: Ongoing life situations, upcoming events, current projects
- opinion: Their views, beliefs, stances on topics

Rules:
- Only extract facts the USER explicitly stated or clearly implied. Do not infer.
- Each fact should be a single, atomic statement.
- Include emotional context where relevant.
- If a fact UPDATES a previously known fact, mark is_update as true.
- If the conversation was low-content, return an empty array. Do not force facts.
- Max 10 facts per conversation.

Respond ONLY with a JSON array:
[{"category": "identity", "content": "User's name is Alex", "emotional_weight": 0.8, "is_update": false}]

emotional_weight: 0.0 to 1.0 — how personally important is this fact.`,
        },
        {
          role: "user",
          content: `Conversation:\n${fullContext}\n\nExisting known facts (avoid duplicates):\n${existingText}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
    });

    const raw = response.choices[0]?.message?.content?.trim() || "[]";

    // 5. Parse response (handle markdown fences)
    let facts: ExtractedFact[];
    try {
      const cleaned = raw
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      facts = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("[Memory] Failed to parse extraction response:", raw);
      return;
    }

    if (!Array.isArray(facts) || facts.length === 0) {
      console.log("[Memory] No new facts extracted.");
      return;
    }

    // 6. Save to database
    const validCategories = [
      "identity",
      "preference",
      "relationship",
      "emotional",
      "experience",
      "context",
      "opinion",
    ];

    let savedCount = 0;
    for (const fact of facts) {
      if (!validCategories.includes(fact.category)) continue;
      if (!fact.content || fact.content.trim().length === 0) continue;

      if (fact.is_update) {
        // Delete older facts in the same category that this fact supersedes.
        // Simple heuristic: if the new fact mentions the same key nouns as an
        // existing fact in the same category, the old one is stale.
        // For v1, just delete all facts in the same category that share any
        // 4+ letter word with the new fact. This is rough but prevents
        // contradictions like "hates his job" + "loves his new job" coexisting.
        const keywords = fact.content
          .toLowerCase()
          .split(/\s+/)
          .filter((w: string) => w.length >= 4)
          .map((w: string) => w.replace(/[^a-z]/g, ""));

        if (keywords.length > 0) {
          const existing = await prisma.memoryFact.findMany({
            where: { userId, category: fact.category },
          });

          for (const old of existing) {
            const oldWords = old.content
              .toLowerCase()
              .split(/\s+/)
              .filter((w: string) => w.length >= 4)
              .map((w: string) => w.replace(/[^a-z]/g, ""));
            const overlap = keywords.filter((k: string) => oldWords.includes(k));

            // If 2+ keywords overlap, this is likely an update to the same topic
            if (overlap.length >= 2) {
              await prisma.memoryFact.delete({ where: { id: old.id } });
              console.log(
                `[Memory] Replaced stale fact: "${old.content}" → "${fact.content}"`
              );
            }
          }
        }
      }

      await prisma.memoryFact.create({
        data: {
          userId,
          category: fact.category,
          content: fact.content.trim(),
          emotionalWeight: Math.max(
            0,
            Math.min(1, fact.emotional_weight || 0.5)
          ),
        },
      });
      savedCount++;
    }

    console.log(
      `[Memory] Extracted and saved ${savedCount} facts for user ${userId}.`
    );
  } catch (err) {
    console.error("[Memory] Extraction failed:", (err as Error).message);
    // Non-fatal — conversation still works without memory save
  }
}
