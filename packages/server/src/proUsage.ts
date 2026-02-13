import prisma from "./prismaClient.js";

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

/**
 * Get current monthly usage for a Pro user. Returns 0 if no record or different month.
 */
export async function getProUsage(clerkId: string): Promise<number> {
  const month = getCurrentMonth();
  try {
    const usage = await prisma.monthlyUsage.findUnique({
      where: { userId_month: { userId: clerkId, month } },
    });
    const seconds = usage?.seconds ?? 0;
    console.log(`[ProUsage] Read ${clerkId} ${month}: ${seconds}s`);
    return seconds;
  } catch (err) {
    console.error("[ProUsage] Read error:", err);
    return 0;
  }
}

/**
 * Save monthly usage for a Pro user (upsert — atomic increment on existing, create if new).
 */
export async function saveProUsage(clerkId: string, seconds: number): Promise<void> {
  const month = getCurrentMonth();
  try {
    await prisma.monthlyUsage.upsert({
      where: { userId_month: { userId: clerkId, month } },
      update: { seconds },
      create: { userId: clerkId, month, seconds },
    });
    console.log(`[ProUsage] Persisted ${clerkId} ${month}: ${seconds}s`);
  } catch (err) {
    console.error("[ProUsage] Write error:", err);
  }
}
