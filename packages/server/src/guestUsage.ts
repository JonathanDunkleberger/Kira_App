import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("[GuestUsage] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — guest usage tracking disabled");
    return null;
  }
  _supabase = createClient(url, key);
  return _supabase;
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Get current usage for a guest. Returns 0 if no record or different day.
 */
export async function getGuestUsage(guestId: string): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0; // DB not configured — fail open
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
  const supabase = getSupabase();
  if (!supabase) return; // DB not configured — silently skip
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
