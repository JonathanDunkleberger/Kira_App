export interface PaywallEventProperties {
  userId?: string;
  userType: 'guest' | 'authenticated';
  plan: 'free' | 'pro';
  secondsRemaining?: number;
  conversationId?: string;
  source?: string;
  // Allow extra fields for specific events
  [key: string]: any;
}

export function trackPaywallEvent(event: string, properties: PaywallEventProperties) {
  if (typeof window === 'undefined') return;

  const events = {
    PAYWALL_TRIGGERED: 'paywall_triggered',
    PAYWALL_DISMISSED: 'paywall_dismissed',
    PAYWALL_UPGRADE_CLICKED: 'paywall_upgrade_clicked',
    PAYWALL_UPGRADE_SUCCESS: 'paywall_upgrade_success',
    PAYWALL_TIME_EXHAUSTED: 'paywall_time_exhausted',
  };

  // Console breadcrumb
  // eslint-disable-next-line no-console
  console.log('Paywall Analytics:', event, properties);

  // Plausible
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w: any = window as any;
  if (typeof w.plausible === 'function') {
    try { w.plausible(event, { props: properties }); } catch {}
  }

  // Google Analytics 4
  if (typeof w.gtag === 'function') {
    try { w.gtag('event', event, properties); } catch {}
  }

  // Backend persistence
  fetch('/api/analytics/paywall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      properties,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    }),
  }).catch(() => {});
}

// Helpers
export const trackPaywallTriggered = (properties: PaywallEventProperties) =>
  trackPaywallEvent('paywall_triggered', properties);

export const trackUpgradeClick = (properties: PaywallEventProperties) =>
  trackPaywallEvent('paywall_upgrade_clicked', properties);

export const trackUpgradeSuccess = (properties: PaywallEventProperties) =>
  trackPaywallEvent('paywall_upgrade_success', properties);
