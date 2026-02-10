import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[GuestUsage] ❌ No Supabase client — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
    return null;
  }
  _supabase = createClient(url, key);
  return _supabase;
}

// --- Startup connectivity test ---
async function testSupabaseConnection() {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      console.error("[GuestUsage] ❌ No Supabase client — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
      return;
    }
    const { data, error } = await supabase.from("guest_usage").select("guest_id").limit(1);
    if (error) {
      console.error("[GuestUsage] ❌ Supabase connection FAILED:", error.message, error);
    } else {
      console.log("[GuestUsage] ✅ Supabase connection OK, guest_usage table accessible");
    }
  } catch (err) {
    console.error("[GuestUsage] ❌ Supabase test exception:", err);
  }
}

// Run on module load
testSupabaseConnection();

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

    console.log(`[GuestUsage] READ for ${guestId}: data=${JSON.stringify(data)}, error=${error?.message || "none"}`);

    if (error || !data) return 0;
    if (data.date !== today) return 0;
    return data.seconds;
  } catch (err) {
    console.error("[GuestUsage] ❌ Read exception for", guestId, ":", err);
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
    const { data: existing, error: readErr } = await supabase
      .from("guest_usage")
      .select("seconds, date")
      .eq("guest_id", guestId)
      .single();

    console.log(`[GuestUsage] WRITE lookup for ${guestId}: existing=${JSON.stringify(existing)}, error=${readErr?.message || "none"}`);

    if (!existing) {
      const { error: insertErr } = await supabase.from("guest_usage").insert({
        guest_id: guestId,
        seconds,
        date: today,
      });
      console.log(`[GuestUsage] INSERT for ${guestId}: seconds=${seconds}, date=${today}, error=${insertErr?.message || "none"}`);
      return;
    }

    if (existing.date !== today) {
      const { error: updateErr } = await supabase
        .from("guest_usage")
        .update({ seconds, date: today, updated_at: new Date().toISOString() })
        .eq("guest_id", guestId);
      console.log(`[GuestUsage] UPDATE (new day) for ${guestId}: seconds=${seconds}, date=${today}, error=${updateErr?.message || "none"}`);
      return;
    }

    // Same day — never decrease
    if (seconds > existing.seconds) {
      const { error: updateErr } = await supabase
        .from("guest_usage")
        .update({ seconds, updated_at: new Date().toISOString() })
        .eq("guest_id", guestId);
      console.log(`[GuestUsage] UPDATE for ${guestId}: seconds=${seconds}, error=${updateErr?.message || "none"}`);
    }
  } catch (err) {
    console.error("[GuestUsage] ❌ Write exception for", guestId, ":", err);
  }
}
