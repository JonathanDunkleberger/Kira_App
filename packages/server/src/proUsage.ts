import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("[ProUsage] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — Pro usage tracking disabled");
    return null;
  }
  _supabase = createClient(url, key);
  return _supabase;
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

/**
 * Get current monthly usage for a Pro user. Returns 0 if no record or different month.
 */
export async function getProUsage(clerkId: string): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0; // DB not configured — fail open
  const month = getCurrentMonth();
  try {
    const { data, error } = await supabase
      .from("pro_usage")
      .select("seconds, month")
      .eq("clerk_id", clerkId)
      .single();

    if (error || !data) return 0;
    if (data.month !== month) return 0; // New billing month — fresh start
    return data.seconds;
  } catch (err) {
    console.error("[ProUsage] Read error:", err);
    return 0;
  }
}

/**
 * Save monthly usage for a Pro user. Only increases stored seconds, never decreases.
 */
export async function saveProUsage(clerkId: string, seconds: number): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return; // DB not configured — silently skip
  const month = getCurrentMonth();
  try {
    const { data: existing } = await supabase
      .from("pro_usage")
      .select("seconds, month")
      .eq("clerk_id", clerkId)
      .single();

    if (!existing) {
      await supabase.from("pro_usage").insert({
        clerk_id: clerkId,
        seconds,
        month,
      });
      return;
    }

    if (existing.month !== month) {
      // New month — reset
      await supabase
        .from("pro_usage")
        .update({ seconds, month, updated_at: new Date().toISOString() })
        .eq("clerk_id", clerkId);
      return;
    }

    // Same month — never decrease
    if (seconds > existing.seconds) {
      await supabase
        .from("pro_usage")
        .update({ seconds, updated_at: new Date().toISOString() })
        .eq("clerk_id", clerkId);
    }
  } catch (err) {
    console.error("[ProUsage] Write error:", err);
  }
}
