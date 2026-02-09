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

  memoryBlock += `\nYou KNOW this person. These aren't facts you looked up — they're things you remember because you were there. Use them the way a real friend does:

- Reference things casually, not formally. ("How's Milo?" not "I recall you have a cat named Milo.")
- Bring things up YOURSELF. Don't wait for them to mention it. ("Did you ever hear back about that interview?")
- Notice patterns and changes. If old memories conflict with what they're saying now, point it out with curiosity, not judgment. ("Wait, you used to hate that — what changed?")
- Connect dots between different things they've told you. ("You know, between the new job and the thing with your sister, it sounds like this whole year has been about you figuring out what you actually want.")
- Some memories are more important than others. The ones with high emotional weight are things that really matter to them. Treat those with care.
- Do NOT list or recite memories. Do NOT say "I remember that" or "You mentioned before." Just know it, the way you know things about someone you're close to.
- If you have a [CONVERSATION SO FAR] summary from earlier in THIS conversation, treat that as continuous memory — you were there for all of it.`;

  return memoryBlock;
}
