import type { AnalysisResult, PerformanceMetrics } from '../../shared/types';
import type { Severity } from './overview';

// --- Raw HTML vs rendered DOM ---

export interface PageSignals {
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  h1: string | null;
  h1Count: number;
  links: number;
  words: number;
}

const clean = (s: string | null | undefined) => {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v || null;
};

export function rawSignals(html: string, baseUrl: string): PageSignals {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (name: string) => clean(doc.querySelector(`meta[name="${name}" i]`)?.getAttribute('content'));
  const canonicalHref = doc.querySelector('link[rel~="canonical" i]')?.getAttribute('href');
  let canonical: string | null = null;
  if (canonicalHref) {
    try { canonical = new URL(canonicalHref, baseUrl).href; } catch { canonical = canonicalHref; }
  }
  const h1s = doc.querySelectorAll('h1');
  const links = doc.querySelectorAll('a[href]').length;
  doc.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());
  const words = (doc.body?.textContent ?? '').split(/\s+/).filter(Boolean).length;
  return {
    title: clean(doc.querySelector('title')?.textContent),
    description: meta('description'),
    canonical,
    robots: meta('robots'),
    h1: clean(h1s[0]?.textContent),
    h1Count: h1s.length,
    links,
    words,
  };
}

export function renderedSignals(a: AnalysisResult): PageSignals {
  const h1s = a.headings.items.filter((h) => h.level === 1);
  let canonical: string | null = null;
  if (a.overview.canonical.value) {
    try { canonical = new URL(a.overview.canonical.value, a.overview.url).href; } catch { canonical = a.overview.canonical.value; }
  }
  return {
    title: clean(a.overview.title.value),
    description: clean(a.overview.description.value),
    canonical,
    robots: clean(a.overview.robots),
    h1: clean(h1s[0]?.text),
    h1Count: h1s.length,
    links: a.links.totalCount,
    words: a.content.wordCount,
  };
}

export interface SignalComparison {
  label: string;
  raw: string;
  rendered: string;
  severity: Severity | 'neutral';
  note: string;
}

function compareText(label: string, raw: string | null, rendered: string | null, critical: boolean): SignalComparison {
  const base = { label, raw: raw ?? 'Not present', rendered: rendered ?? 'Not present' };
  if (raw === rendered) return { ...base, severity: raw ? 'ok' : 'neutral', note: raw ? 'Same' : 'Missing in both' };
  if (!raw) return { ...base, severity: critical ? 'warning' : 'neutral', note: 'Only added by JavaScript' };
  if (!rendered) return { ...base, severity: 'warning', note: 'Removed by JavaScript' };
  return { ...base, severity: 'warning', note: 'Changed by JavaScript' };
}

function compareCount(label: string, raw: number, rendered: number): SignalComparison {
  const base = { label, raw: raw.toLocaleString(), rendered: rendered.toLocaleString() };
  if (raw === rendered) return { ...base, severity: 'ok', note: 'Same' };
  if (rendered > 0 && raw < rendered * 0.5) return { ...base, severity: 'warning', note: 'Mostly added by JavaScript' };
  if (rendered > 0 && raw < rendered * 0.9) return { ...base, severity: 'neutral', note: `Most are in raw HTML (${base.raw})` };
  // Raw counts include hidden elements (menus, modals, templates) that the rendered count skips.
  if (raw > rendered * 1.2) return { ...base, severity: 'neutral', note: `More in raw HTML (${base.raw}), which includes hidden content` };
  return { ...base, severity: 'ok', note: `Similar in raw HTML (${base.raw})` };
}

export function compareSignals(raw: PageSignals, rendered: PageSignals): SignalComparison[] {
  return [
    compareText('Title', raw.title, rendered.title, true),
    compareText('Meta description', raw.description, rendered.description, true),
    compareText('Canonical', raw.canonical, rendered.canonical, true),
    compareText('Meta robots', raw.robots, rendered.robots, true),
    compareText('H1', raw.h1, rendered.h1, true),
    compareCount('Links', raw.links, rendered.links),
    // Raw text includes hidden elements while rendered text is visible text only, so treat as approximate.
    compareCount('Words', raw.words, rendered.words),
  ];
}

// --- hreflang ---

// Common country codes used where a language code belongs (and "uk" as a region for Britain).
const LANGUAGE_FIXES: Record<string, string> = { jp: 'ja', cn: 'zh', kr: 'ko', gr: 'el', dk: 'da', se: 'sv', cz: 'cs', ua: 'uk', iw: 'he' };
const REGION_FIXES: Record<string, string> = { uk: 'GB', la: '419', eu: 'a specific country' };

export interface HreflangEntryCheck {
  lang: string;
  url: string;
  issues: string[];
}

export interface HreflangCheck {
  entries: HreflangEntryCheck[];
  pageIssues: { severity: Severity; text: string }[];
}

const hrefKey = (u: string) => {
  try {
    const url = new URL(u);
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return u;
  }
};

export function checkHreflang(entries: { lang: string; url: string }[], pageUrls: string[]): HreflangCheck {
  const seen = new Map<string, string>();
  const checked = entries.map(({ lang, url }) => {
    const issues: string[] = [];
    const code = lang.trim();
    const lower = code.toLowerCase();
    if (lower !== 'x-default') {
      const m = lower.match(/^([a-z]{2,3})(?:-([a-z]{4}))?(?:-([a-z]{2}|\d{3}))?$/);
      if (!m) {
        issues.push(`"${code}" isn't a valid language(-region) code`);
      } else {
        if (LANGUAGE_FIXES[m[1]]) issues.push(`"${m[1]}" is a country code; the language code is "${LANGUAGE_FIXES[m[1]]}"`);
        if (m[3] && REGION_FIXES[m[3]]) issues.push(`Region "${m[3]}" should be ${REGION_FIXES[m[3]]}`);
      }
    }
    if (!/^https?:\/\//i.test(url)) issues.push('URL must be absolute (https://…)');
    const previous = seen.get(lower);
    if (previous !== undefined && hrefKey(previous) !== hrefKey(url)) issues.push(`"${code}" is also mapped to another URL`);
    seen.set(lower, url);
    return { lang: code, url, issues };
  });

  const pageIssues: HreflangCheck['pageIssues'] = [];
  if (entries.length) {
    const pageKeys = new Set(pageUrls.map(hrefKey));
    if (!entries.some((e) => pageKeys.has(hrefKey(e.url)))) {
      pageIssues.push({ severity: 'warning', text: 'No entry points back to this page; each page must include itself' });
    }
    if (!seen.has('x-default')) {
      pageIssues.push({ severity: 'warning', text: 'No x-default entry for visitors whose language isn’t listed' });
    }
  }
  return { entries: checked, pageIssues };
}

// --- Performance thresholds (web.dev Core Web Vitals; Lighthouse for DOM size) ---

export interface MetricRating {
  key: keyof PerformanceMetrics;
  label: string;
  value: number | null;
  display: string;
  severity: Severity | 'neutral';
  target: string;
}

const THRESHOLDS: Partial<Record<keyof PerformanceMetrics, [number, number]>> = {
  ttfb: [800, 1800],
  fcp: [1800, 3000],
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
};

const LABELS: Record<keyof PerformanceMetrics, string> = {
  ttfb: 'Time to first byte',
  fcp: 'First contentful paint',
  lcp: 'Largest contentful paint',
  cls: 'Cumulative layout shift',
  domContentLoaded: 'DOM content loaded',
  load: 'Load event',
};

const formatMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

export function rateMetrics(m: PerformanceMetrics): MetricRating[] {
  return (Object.keys(LABELS) as (keyof PerformanceMetrics)[]).map((key) => {
    const value = m[key];
    const limits = THRESHOLDS[key];
    const display = value === null ? 'Not measured' : key === 'cls' ? value.toFixed(3) : formatMs(value);
    const severity: MetricRating['severity'] =
      value === null || !limits ? 'neutral' : value <= limits[0] ? 'ok' : value <= limits[1] ? 'warning' : 'error';
    const target = limits ? `Good ≤ ${key === 'cls' ? limits[0] : formatMs(limits[0])}` : '';
    return { key, label: LABELS[key], value, display, severity, target };
  });
}

export function domSizeSeverity(count: number): Severity {
  return count > 1400 ? 'error' : count > 800 ? 'warning' : 'ok';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}
