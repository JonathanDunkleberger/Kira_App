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

// --- Topic-aware deduplication helpers ---

/** Structural words that inflate similarity between unrelated facts */
const STRUCTURAL_WORDS = new Set([
  "user", "users", "user's", "favorite", "favourite", "likes", "like",
  "loves", "love", "enjoys", "enjoy", "prefers", "prefer", "preferred",
  "really", "very", "much", "that", "this", "their", "they", "them",
  "have", "has", "had", "been", "being", "some", "about", "would",
  "could", "should", "from", "with", "into", "also", "most", "probably",
]);

/** Category keywords — prevent cross-topic replacement */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  anime: ["anime", "manga", "otaku", "waifu", "weeb", "subbed", "dubbed", "isekai", "shonen", "seinen"],
  music: ["song", "music", "album", "artist", "band", "singer", "track", "melody", "concert", "musician", "guitar", "piano", "rap", "hiphop"],
  movie: ["movie", "film", "cinema", "director", "actress", "actor"],
  book: ["book", "novel", "author", "series", "read", "chapter", "sequel", "trilogy", "saga"],
  game: ["game", "gaming", "play", "console", "steam", "playstation", "xbox", "nintendo", "rpg", "mmorpg"],
  food: ["food", "eat", "cook", "recipe", "restaurant", "meal", "snack", "cuisine", "dish"],
  pet: ["cat", "dog", "pet", "animal", "kitten", "puppy"],
  sport: ["sport", "team", "football", "soccer", "basketball", "baseball", "tennis", "running", "gym", "workout"],
  tech: ["programming", "coding", "computer", "software", "hardware", "language", "framework", "code"],
  show: ["show", "series", "season", "episode", "watched", "watching", "binge", "sitcom", "drama"],
};

/** Detect the topic category of a fact based on keywords */
function detectTopicCategory(fact: string): string | null {
  const lower = fact.toLowerCase();
  for (const [category, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return category;
  }
  return null;
}

/**
 * Extract the specific topic/subject from a fact, stripping structural words.
 * "User's favorite anime is 'Steins;Gate 0'" → "anime steins;gate"
 * "User's favorite Ben Howard song is 'The Burn'" → "howard song burn"
 */
function extractTopicWords(fact: string): string[] {
  return fact
    .toLowerCase()
    .replace(/[''""]/g, "")  // Strip quotes
    .split(/\s+/)
    .filter((w: string) => w.length >= 3)
    .map((w: string) => w.replace(/[^a-z0-9;]/g, ""))
    .filter((w: string) => w.length >= 3 && !STRUCTURAL_WORDS.has(w));
}

/**
 * Determine if a new fact should replace an existing fact.
 * Requires BOTH:
 *   1. No cross-topic-category conflict (anime ≠ music)
 *   2. Meaningful overlap in subject-specific words (not just structural)
 */
function shouldReplace(existingFact: string, newFact: string): { replace: boolean; reason: string } {
  // Gate 1: If both facts have detectable topic categories, they must match
  const existingTopic = detectTopicCategory(existingFact);
  const newTopic = detectTopicCategory(newFact);

  if (existingTopic && newTopic && existingTopic !== newTopic) {
    return { replace: false, reason: `different topics: ${existingTopic} vs ${newTopic}` };
  }

  // Gate 2: Extract topic words (excluding structural words) and check overlap
  const existingWords = extractTopicWords(existingFact);
  const newWords = extractTopicWords(newFact);
  const newWordSet = new Set(newWords);

  const overlap = existingWords.filter((w: string) => newWordSet.has(w));

  // Require at least 2 meaningful (non-structural) words in common
  if (overlap.length >= 2) {
    return { replace: true, reason: `shared topic words: [${overlap.join(", ")}]` };
  }

  return { replace: false, reason: `only ${overlap.length} topic word(s) in common: [${overlap.join(", ")}]` };
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
        // Uses topic-aware matching: requires subject-word overlap AND same topic category.
        const existing = await prisma.memoryFact.findMany({
          where: { userId, category: fact.category },
        });

        for (const old of existing) {
          const { replace, reason } = shouldReplace(old.content, fact.content);

          if (replace) {
            await prisma.memoryFact.delete({ where: { id: old.id } });
            console.log(
              `[Memory] Replaced stale fact (${reason}): "${old.content}" → "${fact.content}"`
            );
          } else {
            console.log(
              `[Memory] Kept both facts (${reason}): "${old.content}" ≠ "${fact.content}"`
            );
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
