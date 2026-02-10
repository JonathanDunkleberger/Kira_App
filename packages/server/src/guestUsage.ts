import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Get current usage for a guest. Returns 0 if no record or different day.
 */
export async function getGuestUsage(guestId: string): Promise<number> {
  const today = getToday();
  try {
    const { data, error } = await supabase
      .from("guest_usage")
      .select("seconds, date")
      .eq("guest_id", guestId)
      .single();

    if (error || !data) return 0;
    if (data.date !== today) return 0;
    return data.seconds;
  } catch (err) {
    console.error("[GuestUsage] Read error:", err);
    return 0;
  }
}

/**
 * Save usage for a guest. Only increases stored seconds, never decreases.
 */
export async function saveGuestUsage(guestId: string, seconds: number): Promise<void> {
  const today = getToday();
  try {
    const { data: existing } = await supabase
      .from("guest_usage")
      .select("seconds, date")
      .eq("guest_id", guestId)
      .single();

    if (!existing) {
      await supabase.from("guest_usage").insert({
        guest_id: guestId,
        seconds,
        date: today,
      });
      return;
    }

    if (existing.date !== today) {
      await supabase
        .from("guest_usage")
        .update({ seconds, date: today, updated_at: new Date().toISOString() })
        .eq("guest_id", guestId);
      return;
    }

    // Same day — never decrease
    if (seconds > existing.seconds) {
      await supabase
        .from("guest_usage")
        .update({ seconds, updated_at: new Date().toISOString() })
        .eq("guest_id", guestId);
    }
  } catch (err) {
    console.error("[GuestUsage] Write error:", err);
  }
}
