const GUEST_ID_KEY = "kira_guest_id";

export function getOrCreateGuestId(): string {
  if (typeof window === "undefined") return "";

  let guestId = localStorage.getItem(GUEST_ID_KEY);
  if (!guestId) {
    guestId = `guest_${crypto.randomUUID()}`;
    localStorage.setItem(GUEST_ID_KEY, guestId);
  }
  return guestId;
}

export function clearGuestId(): void {
  localStorage.removeItem(GUEST_ID_KEY);
}
