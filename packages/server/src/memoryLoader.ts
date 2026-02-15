// packages/server/src/memoryLoader.ts
//
// Layer 2 — Read. Loads a signed-in user's persistent memories from the
// MemoryFact table and formats them into a system-message block that gets
// injected into the context window on connect.

import { PrismaClient } from "@prisma/client";

export async function loadUserMemories(
  prisma: PrismaClient,
  userId: string
): Promise<string> {
  const memories = await prisma.memoryFact.findMany({
    where: { userId },
    orderBy: [
      { emotionalWeight: "desc" },
      { lastRecalledAt: "desc" },
      { createdAt: "desc" },
    ],
    take: 30, // Cap at 30 facts to stay within token budget
  });

  if (memories.length === 0) return "";

  // Group by category for clean formatting
  const grouped: Record<string, string[]> = {};
  for (const m of memories) {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push(m.content);
  }

  // Format for injection into system prompt
  let memoryBlock = "[WHAT YOU KNOW ABOUT THIS USER]:\n";
  const categoryLabels: Record<string, string> = {
    identity: "Who they are",
    preference: "What they like/dislike",
    relationship: "People in their life",
    emotional: "Emotional patterns",
    experience: "Shared moments & inside jokes",
    context: "What's going on in their life",
    opinion: "Their views & opinions",
  };

  for (const [category, facts] of Object.entries(grouped)) {
    const label = categoryLabels[category] || category;
    memoryBlock += `${label}: ${facts.join(". ")}.\n`;
  }

  memoryBlock += `\nIMPORTANT: These are facts about THE USER — their preferences, their life, their opinions. They are NOT your preferences. You are Kira — you have your OWN opinions, tastes, and personality that may differ from the user's. When referencing these memories:
- Treat them as things you KNOW ABOUT the user, not things you personally feel
- You can agree, disagree, or be curious about their preferences
- Reference them naturally like a friend would: "didn't you say you were into..." or "how's that thing with..."
- NEVER adopt their favorites as your own. If they love Attack on Titan, you might love it too OR you might think it's overrated — that's YOUR call based on your personality
- Do not list or recite memories. Weave them in naturally.
- If a memory feels stale or irrelevant, ignore it.`;

  return memoryBlock;
}
