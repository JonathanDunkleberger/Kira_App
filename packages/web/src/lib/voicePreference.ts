const VOICE_PREF_KEY = "kira_voice_preference";

export type VoicePreference = "anime" | "natural";

export function getVoicePreference(): VoicePreference {
  if (typeof window === "undefined") return "natural";
  return (localStorage.getItem(VOICE_PREF_KEY) as VoicePreference) || "natural";
}

export function setVoicePreference(pref: VoicePreference): void {
  localStorage.setItem(VOICE_PREF_KEY, pref);
}
