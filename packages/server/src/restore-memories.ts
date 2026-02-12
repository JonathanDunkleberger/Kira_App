// One-time script to restore memory facts that were incorrectly deleted
// by the overly-aggressive dedup logic.
//
// Run: npx ts-node packages/server/src/restore-memories.ts
// Or:  npx tsx packages/server/src/restore-memories.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const USER_ID = "user_35iRtYT7SyO6u5KnHPuu7OWH1FC";

const LOST_FACTS = [
  { category: "preference", content: "User's favorite anime is 'Steins;Gate 0'", emotionalWeight: 0.8 },
  { category: "preference", content: "User's favorite character from 'Steins;Gate' is Ferris", emotionalWeight: 0.7 },
  { category: "preference", content: "User's favorite anime movie is 'Princess Mononoke'", emotionalWeight: 0.8 },
  { category: "preference", content: "User's favorite sequel in the Dune series is probably 'Heretics' or 'Chapterhouse'", emotionalWeight: 0.7 },
  { category: "preference", content: "User likes the haunting vibe of the song 'Empty Corridors' by Ben Howard", emotionalWeight: 0.6 },
];

async function main() {
  console.log(`[Restore] Restoring ${LOST_FACTS.length} facts for ${USER_ID}...`);

  for (const fact of LOST_FACTS) {
    // Check if it already exists (idempotent)
    const existing = await prisma.memoryFact.findFirst({
      where: { userId: USER_ID, content: fact.content },
    });

    if (existing) {
      console.log(`[Restore] Already exists, skipping: "${fact.content}"`);
      continue;
    }

    await prisma.memoryFact.create({
      data: {
        userId: USER_ID,
        category: fact.category,
        content: fact.content,
        emotionalWeight: fact.emotionalWeight,
      },
    });
    console.log(`[Restore] Created: "${fact.content}"`);
  }

  console.log("[Restore] Done.");
}

main()
  .catch((err) => {
    console.error("[Restore] Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
