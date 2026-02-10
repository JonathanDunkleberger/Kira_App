import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[GuestUsage] ❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
    return null;
  }
  _supabase = createClient(url, key);
  return _supabase;
}

// --- Startup connectivity test ---
async function testSupabaseConnection() {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.from("guest_usage").select("guest_id").limit(1);
    if (error) {
      console.error("[GuestUsage] ❌ Supabase connection FAILED:", error.message);
    } else {
      console.log("[GuestUsage] ✅ Supabase connection OK");
    }
  } catch (err) {
    console.error("[GuestUsage] ❌ Supabase test exception:", err);
  }
}

testSupabaseConnection();

function getToday(): string {
  return new Date().toISOString().split("T")[0];
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
 * isReturning = true if a record exists in Supabase at all (even from a prior day).
 */
export async function getGuestUsageInfo(guestId: string): Promise<{ seconds: number; isReturning: boolean }> {
  const supabase = getSupabase();
  if (!supabase) return { seconds: 0, isReturning: false };
  const today = getToday();
  try {
    const { data, error } = await supabase
      .from("guest_usage")
      .select("seconds, date")
      .eq("guest_id", guestId)
      .single();

    if (error || !data) return { seconds: 0, isReturning: false };
    if (data.date !== today) return { seconds: 0, isReturning: true };
    return { seconds: data.seconds, isReturning: true };
  } catch (err) {
    console.error("[GuestUsage] ❌ Read exception for", guestId, ":", err);
    return { seconds: 0, isReturning: false };
  }
}

/**
 * Save usage for a guest. Only increases stored seconds, never decreases.
 */
export async function saveGuestUsage(guestId: string, seconds: number): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const today = getToday();
  try {
    const { data: existing, error: readErr } = await supabase
      .from("guest_usage")
      .select("seconds, date")
      .eq("guest_id", guestId)
      .single();

    if (!existing || readErr) {
      const { error: insertErr } = await supabase.from("guest_usage").insert({
        guest_id: guestId,
        seconds,
        date: today,
      });
      if (insertErr) console.error("[GuestUsage] ❌ Insert failed for", guestId, ":", insertErr.message);
      return;
    }

    if (existing.date !== today) {
      const { error: updateErr } = await supabase
        .from("guest_usage")
        .update({ seconds, date: today, updated_at: new Date().toISOString() })
        .eq("guest_id", guestId);
      if (updateErr) console.error("[GuestUsage] ❌ Update (new day) failed for", guestId, ":", updateErr.message);
      return;
    }

    // Same day — never decrease
    if (seconds > existing.seconds) {
      const { error: updateErr } = await supabase
        .from("guest_usage")
        .update({ seconds, updated_at: new Date().toISOString() })
        .eq("guest_id", guestId);
      if (updateErr) console.error("[GuestUsage] ❌ Update failed for", guestId, ":", updateErr.message);
    }
  } catch (err) {
    console.error("[GuestUsage] ❌ Write exception for", guestId, ":", err);
  }
}
