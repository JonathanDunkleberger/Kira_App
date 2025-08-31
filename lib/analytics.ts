export function trackPaywallEvent(event: string, properties: Record<string, any> = {}) {
  if (typeof window === 'undefined') return;

  // Integrate with analytics if present
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (typeof w.plausible === 'function') {
      w.plausible(event, { props: properties });
    }
  } catch {}

  // Fire-and-forget to backend for logging
  fetch('/api/analytics/paywall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, properties })
  }).catch(() => {});
}
