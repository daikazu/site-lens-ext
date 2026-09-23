import type { AnalysisResult, PageHeadersResult } from '../../shared/types';

export type TabName = 'Overview' | 'Preview' | 'Headings' | 'Content' | 'Links' | 'Images' | 'Schema' | 'Technical';
export type Severity = 'error' | 'warning' | 'ok';

// --- Robots directives ---

// Directives from a meta robots/googlebot tag, lowercased.
function metaDirectives(content: string | null): string[] {
  return (content ?? '').toLowerCase().split(',').map((d) => d.trim()).filter(Boolean);
}

// X-Robots-Tag directives that apply to Google. The header may scope directives to a crawler
// ("otherbot: noindex, nofollow"); a scope lasts until the next one.
function headerDirectives(header: string | null): string[] {
  const out: string[] = [];
  let agent: string | null = null;
  for (const raw of (header ?? '').toLowerCase().split(',')) {
    let directive = raw.trim();
    const scoped = directive.match(/^([a-z0-9_-]+)\s*:\s*(.*)$/);
    if (scoped && scoped[1] !== 'unavailable_after') {
      agent = scoped[1];
      directive = scoped[2].trim();
    }
    if (directive && (agent === null || agent === 'googlebot')) out.push(directive);
  }
  return out;
}

const blocksIndexing = (directives: string[]) => directives.includes('noindex') || directives.includes('none');
const blocksFollowing = (directives: string[]) => directives.includes('nofollow') || directives.includes('none');

// --- Canonical ---

export type CanonicalRelation =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'self'; note: string }
  | { kind: 'other'; href: string };

function samePage(a: URL, b: URL): boolean {
  const path = (u: URL) => u.pathname.replace(/\/+$/, '') || '/';
  return a.origin === b.origin && path(a) === path(b);
}

export function canonicalRelation(pageUrl: string, canonical: string | null): CanonicalRelation {
  if (!canonical) return { kind: 'missing' };
  let page: URL;
  let target: URL;
  try {
    page = new URL(pageUrl);
    target = new URL(canonical, pageUrl);
  } catch {
    return { kind: 'invalid' };
  }
  page.hash = '';
  target.hash = '';
  if (page.href === target.href) return { kind: 'self', note: 'Points to this URL' };
  if (samePage(page, target)) {
    if (page.search !== target.search) return { kind: 'self', note: 'Same page without URL parameters' };
    return { kind: 'self', note: 'Same page (trailing slash differs)' };
  }
  return { kind: 'other', href: target.href };
}

// --- Indexability verdict ---

export interface Reason {
  severity: Severity;
  text: string;
}

export interface Indexability {
  state: 'indexable' | 'caveat' | 'blocked';
  reasons: Reason[];
}

export function indexability(
  overview: AnalysisResult['overview'],
  headers: PageHeadersResult | null,
): Indexability {
  const reasons: Reason[] = [];
  const robots = metaDirectives(overview.robots);
  const googlebot = metaDirectives(overview.googlebot);
  const header = headerDirectives(headers?.xRobotsTag ?? null);
  const status = overview.httpStatus ?? headers?.status ?? null;

  if (blocksIndexing(robots)) reasons.push({ severity: 'error', text: 'noindex in the meta robots tag' });
  if (blocksIndexing(googlebot)) reasons.push({ severity: 'error', text: 'noindex in the meta googlebot tag' });
  if (blocksIndexing(header)) reasons.push({ severity: 'error', text: 'noindex in the X-Robots-Tag header' });
  if (status !== null && status >= 400) reasons.push({ severity: 'error', text: `Page responds with HTTP ${status}` });

  const canonical = canonicalRelation(overview.url, overview.canonical.value);
  if (canonical.kind === 'other') {
    reasons.push({ severity: 'warning', text: 'Canonical points to a different URL, so Google will likely index that one instead' });
  } else if (canonical.kind === 'invalid') {
    reasons.push({ severity: 'warning', text: 'Canonical URL is malformed and will be ignored' });
  } else if (canonical.kind === 'missing') {
    reasons.push({ severity: 'warning', text: 'No canonical tag, so Google picks the canonical URL itself' });
  }
  if (blocksFollowing(robots) || blocksFollowing(googlebot) || blocksFollowing(header)) {
    reasons.push({ severity: 'warning', text: 'nofollow: links on this page pass no signals' });
  }

  const state = reasons.some((r) => r.severity === 'error')
    ? 'blocked'
    : reasons.some((r) => r.severity === 'warning')
      ? 'caveat'
      : 'indexable';
  return { state, reasons };
}

// --- Snippet length ---

// Google renders desktop titles in 20px Arial and descriptions in 14px Arial, and truncates
// by rendered width rather than character count.
export const SNIPPET_LIMITS = {
  title: { font: '20px Arial, sans-serif', maxPx: 580, minChars: 30 },
  description: { font: '14px Arial, sans-serif', maxPx: 920, minChars: 70 },
} as const;

let measureCtx: CanvasRenderingContext2D | null = null;
export function textWidth(text: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 0;
  measureCtx.font = font;
  return Math.round(measureCtx.measureText(text).width);
}

export interface SnippetCheck {
  severity: Severity;
  label: string;
  chars: number;
  px: number;
  maxPx: number;
}

export function snippetCheck(text: string, kind: keyof typeof SNIPPET_LIMITS): SnippetCheck {
  const limits = SNIPPET_LIMITS[kind];
  const chars = text.length;
  const px = textWidth(text, limits.font);
  const base = { chars, px, maxPx: limits.maxPx };
  if (chars === 0) return { ...base, severity: 'error', label: 'Missing' };
  if (px > limits.maxPx) return { ...base, severity: 'warning', label: 'Truncated in results' };
  if (chars < limits.minChars) return { ...base, severity: 'warning', label: 'Short' };
  return { ...base, severity: 'ok', label: 'Fits' };
}

// --- Issues from every tab ---

export interface AttentionItem {
  tab: TabName;
  text: string;
}

export function attentionItems(a: AnalysisResult): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (tab: TabName, texts: string[]) => texts.forEach((text) => items.push({ tab, text }));

  if (!a.overview.lang) add('Overview', ['No lang attribute on <html>']);
  if (!a.overview.viewport) add('Overview', ['No viewport meta tag (page will not scale on mobile)']);
  if (!a.overview.favicon) add('Overview', ['No favicon link tag']);
  if (!a.preview.og.image) add('Preview', ['No Open Graph image (og:image) for social shares']);
  if (!a.preview.twitter.card) add('Preview', ['No Twitter card (twitter:card)']);
  add('Headings', a.headings.warnings);
  add('Links', a.links.warnings);
  add('Images', a.images.warnings);
  add('Schema', a.schema.warnings);
  return items;
}
