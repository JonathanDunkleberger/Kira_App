import prisma from "./prismaClient.js";

function getToday(): string {
  return new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"
}

/**
 * Get current usage for a guest. Returns 0 if no record or different day.
 */
export async function getGuestUsage(guestId: string): Promise<number> {
  const info = await getGuestUsageInfo(guestId);
  return info.seconds;
}

/**
 * Get usage info for a guest, including whether they are a returning visitor.
 * isReturning = true if any record exists at all (even from a prior day).
 */
export async function getGuestUsageInfo(guestId: string): Promise<{ seconds: number; isReturning: boolean }> {
  const today = getToday();
  try {
    // Check for any record (returning guest detection)
    const records = await prisma.guestUsage.findMany({
      where: { guestId },
      orderBy: { date: "desc" },
      take: 1,
    });

    if (records.length === 0) return { seconds: 0, isReturning: false };

    const latest = records[0];
    if (latest.date !== today) return { seconds: 0, isReturning: true };
    return { seconds: latest.seconds, isReturning: true };
  } catch (err) {
    console.error("[GuestUsage] ❌ Read error for", guestId, ":", err);
    return { seconds: 0, isReturning: false };
  }
}

/**
 * Save usage for a guest. Upsert for today's row; never decreases stored seconds.
 */
export async function saveGuestUsage(guestId: string, seconds: number): Promise<void> {
  const today = getToday();
  try {
    await prisma.guestUsage.upsert({
      where: { guestId_date: { guestId, date: today } },
      update: { seconds },
      create: { guestId, date: today, seconds },
    });
    console.log(`[GuestUsage] Persisted ${guestId} ${today}: ${seconds}s`);
  } catch (err) {
    console.error("[GuestUsage] ❌ Write error for", guestId, ":", err);
  }
}
