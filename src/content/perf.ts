import type { PerformanceMetrics } from '../shared/types';

// Observers register when the content script loads; buffered: true replays entries recorded
// before that, so metrics are complete even though the script runs at document_idle.

type LcpEntry = PerformanceEntry & { element?: Element | null };
type LayoutShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean };

export const lcp = {
  observed: false,
  element: null as Element | null,
  time: null as number | null,
};

function observe(type: string, callback: (entries: PerformanceEntry[]) => void) {
  try {
    new PerformanceObserver((list) => callback(list.getEntries())).observe({ type, buffered: true });
  } catch {
    // Entry type unsupported in this browser; the metric stays null.
  }
}

observe('largest-contentful-paint', (entries) => {
  const last = entries[entries.length - 1] as LcpEntry | undefined;
  if (!last) return;
  lcp.observed = true;
  lcp.element = last.element ?? null;
  lcp.time = last.startTime;
});

// CLS is the largest "session window" of shifts: shifts less than 1s apart, capped at 5s.
let clsObserved = false;
let clsMax = 0;
let sessionValue = 0;
let sessionStart = 0;
let sessionLast = 0;
observe('layout-shift', (entries) => {
  clsObserved = true;
  for (const entry of entries as LayoutShiftEntry[]) {
    if (entry.hadRecentInput) continue;
    const t = entry.startTime;
    if (sessionValue > 0 && t - sessionLast < 1000 && t - sessionStart < 5000) {
      sessionValue += entry.value;
    } else {
      sessionValue = entry.value;
      sessionStart = t;
    }
    sessionLast = t;
    clsMax = Math.max(clsMax, sessionValue);
  }
});

const round = (n: number | undefined | null) => (n == null || n <= 0 ? null : Math.round(n));

export function performanceMetrics(): PerformanceMetrics {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  return {
    ttfb: round(nav?.responseStart),
    fcp: round(fcp?.startTime),
    lcp: round(lcp.time),
    cls: clsObserved ? Math.round(clsMax * 1000) / 1000 : null,
    domContentLoaded: round(nav?.domContentLoadedEventEnd),
    load: round(nav?.loadEventEnd),
  };
}
