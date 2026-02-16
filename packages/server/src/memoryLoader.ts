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
    take: 100, // Load up to 100 facts — each is small, total stays well within token budget
  });

  if (memories.length === 0) return "";

  // Group by category for clean formatting
  const grouped: Record<string, string[]> = {};
  for (const m of memories) {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push(m.content);
  }

  // Format for injection into system prompt
  let memoryBlock = "[WHAT YOU REMEMBER ABOUT THIS USER — reference these naturally like a friend would]:\n";

  const categoryLabels: Record<string, string> = {
    identity: "WHO THEY ARE",
    preference: "THEIR FAVORITES & PREFERENCES",
    relationship: "PEOPLE & PETS IN THEIR LIFE",
    emotional: "EMOTIONAL PATTERNS",
    experience: "SHARED MOMENTS & INSIDE JOKES",
    context: "WHAT'S GOING ON IN THEIR LIFE",
    opinion: "THEIR VIEWS & OPINIONS",
  };

  for (const [category, facts] of Object.entries(grouped)) {
    const label = categoryLabels[category] || category;
    memoryBlock += `\n${label}:\n`;
    for (const fact of facts) {
      memoryBlock += `• ${fact}\n`;
    }
  }

  memoryBlock += `\nREMEMBER: These are facts about THE USER, not about you. You are Kira with your own opinions. Reference these memories naturally — "didn't you say...", "how's that thing with...", "wait, isn't your cat...". If the user asks "do you remember X?" and the answer is in this list, say YES confidently and share the detail. Do NOT say "I don't think you've told me" if the information IS listed above.`;

  return memoryBlock;
}
