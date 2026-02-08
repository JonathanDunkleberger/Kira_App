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

  memoryBlock += `\nUse these memories NATURALLY. Do not list them. Do not say "I remember that..." unless it fits naturally. Weave them into conversation as a real friend would — casually referencing things you know, asking follow-up questions about ongoing situations, building on shared experiences. If a memory feels stale or no longer relevant, do not force it.`;

  return memoryBlock;
}
