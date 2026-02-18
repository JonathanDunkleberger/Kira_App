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

  memoryBlock += `\n---\nCRITICAL MEMORY INSTRUCTIONS:
• These are facts about THE USER that you learned in previous conversations.
• If the user asks "do you remember X?" — scan the list above. If the answer is there, say YES confidently and share the specific detail. Do NOT say "I don't remember" or "I don't think you've told me" if the fact IS listed above.
• Reference memories naturally: "oh right, didn't you say...", "how's Cartofel doing?", "still working on that song?"
• You can bring up relevant memories proactively when they're related to what the user is talking about.
• These are YOUR memories of the user. Own them confidently like a real friend would.`;

  // Load recent conversation summaries for narrative context
  try {
    const recentConversations = await prisma.conversation.findMany({
      where: { userId: userId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { summary: true, createdAt: true },
    });

    const withSummaries = recentConversations.filter(c => c.summary);
    if (withSummaries.length > 0) {
      memoryBlock += `\n\nRECENT CONVERSATION HISTORY:\n`;
      for (const conv of withSummaries.reverse()) {
        const date = conv.createdAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        memoryBlock += `• ${date}: ${conv.summary}\n`;
      }
    }
  } catch (e) {
    console.warn('[Memory] Failed to load conversation summaries:', e);
    // Non-fatal — continue without summaries
  }

  console.log(`[Memory] Loaded ${memories.length} facts (${memoryBlock.length} chars) for ${userId}`);

  return memoryBlock;
}
