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

/** Generic action verbs / temporal words that pass extractTopicWords but carry
 *  no subject-specific meaning.  "plans to watch" should not count as overlap
 *  with an unrelated fact that also contains "plans" and "watch".            */
const GENERIC_WORDS = new Set([
  "plans", "wants", "going", "watch", "play", "listen", "read",
  "tried", "trying", "started", "finished", "looking", "make", "made",
  "doing", "done", "think", "thinks", "having",
  "will", "today", "tomorrow", "later", "soon", "recently",
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
 * "User's favorite Ben Howard song is 'The Burren'" → "howard song burren"
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

  // Strip generic action verbs / temporal words — they carry no subject info
  const meaningfulOverlap = overlap.filter((w: string) => !GENERIC_WORDS.has(w));

  // Require at least 2 meaningful (non-structural, non-generic) words in common
  if (meaningfulOverlap.length >= 2) {
    return { replace: true, reason: `shared topic words: [${meaningfulOverlap.join(", ")}]` };
  }

  return { replace: false, reason: `only ${meaningfulOverlap.length} meaningful topic word(s) in common: [${meaningfulOverlap.join(", ")}] (generic filtered: [${overlap.filter((w: string) => GENERIC_WORDS.has(w)).join(", ")}])` };
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
    if (userMessages.length < 1) {
      console.log("[Memory] Conversation too short for extraction. Skipping.");
      return;
    }

    // 4. Extract via LLM
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a memory extraction system. Extract EVERY specific fact about the user from this conversation. Be thorough and greedy — capture everything. A good friend remembers small details.

RULES:
- Every fact MUST start with "User" or "Their" or "They"
- Extract SPECIFIC details, not summaries. "User's cat Cartofel is missing a tail" NOT "User has a unique cat"
- Extract EVERY preference mentioned: favorite book, song, artist, anime, movie, game, food, color, etc.
- Extract EVERY personal detail: age, name, occupation, location, relationship status, pets and pet details, family members
- Extract EVERY life event or project: what they're working on, what they're reading, upcoming plans, recent experiences
- Extract EVERY opinion they express: likes, dislikes, things they find interesting or boring
- Prefer exact names/titles over generalizations: "User's favorite book is Heretics of Dune" NOT "User likes sci-fi books"
- One atomic fact per entry. Do NOT combine multiple facts into one entry.
- If someone mentions their cat is missing a tail AND is jealous of another cat's tail, those are TWO separate facts.
- Mark is_update: true ONLY if this fact directly contradicts or replaces an existing fact (e.g., "I moved to LA" updates a previous city)
- Do NOT skip facts because they seem minor. "User had tacos for lunch" is worth remembering.
- Do NOT extract meta-relationship facts about the AI/Kira relationship itself. No facts like "User enjoys talking to Kira" or "User considers Kira a friend" — those are about the relationship with the AI, not about the user.
- Extract up to 20 facts per conversation. More is better than fewer.

Categories: identity, preference, relationship, emotional, experience, context, opinion

Respond ONLY with a JSON array. No markdown, no backticks, no explanation:
[{"category": "preference", "content": "User's favorite book series is Dune", "emotional_weight": 0.7, "is_update": false}]

emotional_weight: 0.0-1.0 based on how personally important this seems to the user. Identity facts (age, name) = 0.9. Preferences = 0.6-0.8. Passing mentions = 0.3-0.5.`,
        },
        {
          role: "user",
          content: `Conversation:\n${fullContext}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    const raw = response.choices[0]?.message?.content?.trim() || "[]";

    // 5. Parse response — robust handling of markdown fences and extra text
    let facts: ExtractedFact[];
    try {
      let factsText = raw;

      // Strip markdown code fences if present
      factsText = factsText.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();

      // Try to extract JSON array if there's extra text around it
      const arrayMatch = factsText.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        factsText = arrayMatch[0];
      }

      facts = JSON.parse(factsText);
    } catch (parseErr) {
      console.error("[Memory] Failed to parse extraction JSON:", parseErr);
      console.error("[Memory] Raw response:", raw);
      return;
    }

    if (!Array.isArray(facts) || facts.length === 0) {
      console.log("[Memory] No new facts extracted.");
      return;
    }

    console.log(`[Memory] Extracted ${facts.length} raw facts:`, facts.map((f: ExtractedFact) => f.content));

    // Deduplicate against existing memories
    const deduplicatedFacts = facts.filter(newFact => {
      const newContent = newFact.content.toLowerCase();
      // Extract meaningful keywords (skip common words)
      const skipWords = new Set(['user', 'users', 'their', 'they', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'be', 'been', 'being', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'like', 'that', 'this', 'it', 'and', 'or', 'but', 'not', 'very', 'really', 'just', 'also', 'than', 'then', 'so', 'if', 'when', 'what', 'which', 'who', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same']);
      const newKeywords = newContent.split(/\s+/).filter(w => w.length > 2 && !skipWords.has(w));

      for (const existing of existingMemories) {
        const existingContent = existing.content.toLowerCase();
        const existingKeywords = existingContent.split(/\s+/).filter(w => w.length > 2 && !skipWords.has(w));

        // Check keyword overlap
        const overlap = newKeywords.filter(k => existingKeywords.includes(k));
        const overlapRatio = newKeywords.length > 0 ? overlap.length / newKeywords.length : 0;

        // If same category and >80% keyword overlap, it's a near-exact duplicate
        if (newFact.category === existing.category && overlapRatio > 0.80) {
          console.log(`[Memory] Dedup: "${newFact.content}" overlaps with existing "${existing.content}" (${Math.round(overlapRatio * 100)}%)`);

          // If marked as update, delete old and keep new
          if (newFact.is_update) {
            prisma.memoryFact.delete({ where: { id: existing.id } }).catch(() => {});
            console.log(`[Memory] Replacing old fact with updated version`);
            return true; // Keep the new fact
          }
          return false; // Skip duplicate
        }
      }
      return true; // No duplicate found, keep it
    });

    // Replace facts with deduplicated version
    facts.splice(0, facts.length, ...deduplicatedFacts);
    console.log(`[Memory] After dedup: ${facts.length} new facts to save`);

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

    // --- Memory cap: prune oldest low-weight facts if over 200 ---
    const MAX_MEMORY_FACTS = 200;
    const totalFacts = await prisma.memoryFact.count({ where: { userId } });
    if (totalFacts > MAX_MEMORY_FACTS) {
      const excess = totalFacts - MAX_MEMORY_FACTS;
      const toDelete = await prisma.memoryFact.findMany({
        where: { userId },
        orderBy: [{ emotionalWeight: "asc" }, { createdAt: "asc" }],
        take: excess,
        select: { id: true },
      });
      if (toDelete.length > 0) {
        await prisma.memoryFact.deleteMany({
          where: { id: { in: toDelete.map(f => f.id) } },
        });
        console.log(`[Memory] Pruned ${toDelete.length} low-weight facts (cap: ${MAX_MEMORY_FACTS})`);
      }
    }
  } catch (err) {
    console.error("[Memory] Extraction failed:", (err as Error).message);
    // Non-fatal — conversation still works without memory save
  }
}
