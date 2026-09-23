import type { ImageItem, ImageSource } from '../shared/types';

function abs(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

// The browser reports the actual Largest Contentful Paint element; buffered: true includes
// entries recorded before this content script ran.
let lcpElement: Element | null = null;
let lcpObserved = false;
try {
  new PerformanceObserver((list) => {
    const entries = list.getEntries() as (PerformanceEntry & { element?: Element | null })[];
    const last = entries[entries.length - 1];
    if (last) {
      lcpObserved = true;
      lcpElement = last.element ?? null;
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
} catch {
  // LCP entries unsupported; fall back to the size heuristic.
}

export const PRIORITY_ISSUES = {
  addHigh: 'Likely LCP image: add fetchpriority="high"',
  lcpLazy: 'Likely LCP image is lazy-loaded: remove loading="lazy" and add fetchpriority="high"',
  lcpLazyHasHigh: 'Likely LCP image is lazy-loaded: remove loading="lazy"',
  highBelowFold: 'fetchpriority="high" on an image below the fold',
  tooManyHigh: 'Too many fetchpriority="high" images (keep it to the LCP image)',
} as const;

// A couple of high-priority images (e.g. a two-up hero) is reasonable; more dilutes the hint.
const MAX_HIGH_PRIORITY = 2;

function isAboveFold(rect: DOMRect): boolean {
  return rect.top + window.scrollY < window.innerHeight;
}

// The <img> that should get fetchpriority="high": the reported LCP element when it's an image,
// otherwise (no usable LCP data) the largest image visible on page load. Null when the LCP is text or a
// CSS background, since fetchpriority can't be set on those.
function findLcpImage(): HTMLImageElement | null {
  // Soft navigations (SPA route changes) don't produce new LCP entries, so a detached element
  // means the data is stale; fall back to the heuristic.
  if (lcpObserved && lcpElement?.isConnected) {
    if (lcpElement instanceof HTMLImageElement) return lcpElement;
    const img = lcpElement?.tagName === 'PICTURE' ? lcpElement.querySelector('img') : null;
    return img ?? null;
  }
  let best: HTMLImageElement | null = null;
  let bestArea = 0;
  document.querySelectorAll('img').forEach((el) => {
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea && isAboveFold(rect)) {
      best = el;
      bestArea = area;
    }
  });
  return best;
}


function makeItem(partial: Partial<ImageItem> & { src: string; source: ImageSource }): ImageItem {
  return {
    src: partial.src,
    source: partial.source,
    alt: partial.alt ?? '',
    width: partial.width ?? null,
    height: partial.height ?? null,
    loading: partial.loading ?? null,
    issues: partial.issues ?? [],
  };
}

export const ALT_ISSUES = {
  missing: 'Missing alt text',
  hiddenWithoutEmptyAlt: 'Hidden from screen readers but missing alt=""',
  emptyNotHidden: 'Empty alt (OK only if decorative)',
} as const;

// Decorative images are hidden with aria-hidden (on the image or an ancestor) or role="presentation"/"none".
// Those should carry alt="" so browsers and crawlers that ignore ARIA still treat them as decorative.
function altTextIssue(el: HTMLImageElement): string | null {
  const alt = el.getAttribute('alt');
  const role = el.getAttribute('role');
  const decorative = !!el.closest('[aria-hidden="true"]') || role === 'presentation' || role === 'none';

  if (alt === null) return decorative ? ALT_ISSUES.hiddenWithoutEmptyAlt : ALT_ISSUES.missing;
  if (alt.trim() === '' && !decorative) return ALT_ISSUES.emptyNotHidden;
  return null;
}

// Loading and priority advice, which depend on each other:
// - The LCP image should load eagerly with fetchpriority="high".
// - Other images visible on page load should load eagerly (the default), not lazily.
// - Images further down should be lazy, and never high priority.
// Hidden or zero-size images are skipped since their position says nothing about when they're needed.
function loadingIssues(el: HTMLImageElement, lcpImage: HTMLImageElement | null, highCount: number): string[] {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return [];

  const isLazy = el.getAttribute('loading')?.toLowerCase() === 'lazy';
  const isHigh = el.getAttribute('fetchpriority')?.toLowerCase() === 'high';
  const aboveFold = isAboveFold(rect);

  if (el === lcpImage) {
    if (isLazy) return [isHigh ? PRIORITY_ISSUES.lcpLazyHasHigh : PRIORITY_ISSUES.lcpLazy];
    return isHigh ? [] : [PRIORITY_ISSUES.addHigh];
  }

  const issues: string[] = [];
  if (aboveFold && isLazy) issues.push('Lazy-loaded but visible on page load (delays rendering)');
  if (!aboveFold && !isLazy) issues.push('Below the fold without loading="lazy"');
  if (isHigh && !aboveFold) issues.push(PRIORITY_ISSUES.highBelowFold);
  else if (isHigh && highCount > MAX_HIGH_PRIORITY) issues.push(PRIORITY_ISSUES.tooManyHigh);
  return issues;
}

function detectImg(): ImageItem[] {
  const out: ImageItem[] = [];
  const lcpImage = findLcpImage();
  const highCount = document.querySelectorAll('img[fetchpriority="high" i]').length;
  document.querySelectorAll('img').forEach((el) => {
    const raw = el.getAttribute('src') || el.getAttribute('data-src') || '';
    if (!raw) return;
    const issues: string[] = [];
    const altIssue = altTextIssue(el);
    if (altIssue) issues.push(altIssue);
    issues.push(...loadingIssues(el, lcpImage, highCount));
    out.push(
      makeItem({
        src: abs(raw),
        source: 'img',
        alt: el.getAttribute('alt') ?? '',
        width: el.naturalWidth || el.width || null,
        height: el.naturalHeight || el.height || null,
        loading: el.getAttribute('loading'),
        issues,
      })
    );
  });
  return out;
}

function detectPicture(): ImageItem[] {
  const out: ImageItem[] = [];
  document.querySelectorAll('picture > source[srcset]').forEach((el) => {
    const srcset = el.getAttribute('srcset') || '';
    // srcset entries: "url 1x, url2 2x" or "url 320w, url2 640w"
    srcset.split(',').forEach((entry) => {
      const url = entry.trim().split(/\s+/)[0];
      if (!url) return;
      out.push(makeItem({ src: abs(url), source: 'picture' }));
    });
  });
  return out;
}

function parseCssUrls(value: string): string[] {
  const urls: string[] = [];
  const re = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)]+?))\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const url = m[1] || m[2] || m[3];
    if (url) urls.push(url.trim());
  }
  return urls;
}

function detectCssBackgrounds(): ImageItem[] {
  const seen = new Set<string>();
  const out: ImageItem[] = [];
  document.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const cs = window.getComputedStyle(el);
    const bg = cs.backgroundImage;
    if (!bg || bg === 'none') return;
    parseCssUrls(bg).forEach((url) => {
      const absolute = url.startsWith('data:') ? url : abs(url);
      if (seen.has(absolute)) return;
      seen.add(absolute);
      out.push(makeItem({ src: absolute, source: 'css-bg' }));
    });
  });
  return out;
}

function detectInlineSvg(): ImageItem[] {
  const out: ImageItem[] = [];
  const serializer = new XMLSerializer();
  let svgCount = 0;
  document.querySelectorAll('svg').forEach((el) => {
    // Only top-level SVGs (skip nested SVGs whose parent is also SVG)
    if (el.parentElement?.closest('svg')) return;
    svgCount++;
    const markup = serializer.serializeToString(el);
    const dataUri = 'data:image/svg+xml;utf8,' + encodeURIComponent(markup);
    const widthAttr = el.getAttribute('width');
    const heightAttr = el.getAttribute('height');
    out.push(
      makeItem({
        src: dataUri,
        source: 'svg',
        width: widthAttr ? parseInt(widthAttr, 10) || null : null,
        height: heightAttr ? parseInt(heightAttr, 10) || null : null,
        alt: el.getAttribute('aria-label') ?? `inline-svg-${svgCount}`,
      })
    );
  });
  return out;
}

function detectVideoPosters(): ImageItem[] {
  const out: ImageItem[] = [];
  document.querySelectorAll<HTMLVideoElement>('video[poster]').forEach((el) => {
    const poster = el.getAttribute('poster');
    if (!poster) return;
    out.push(makeItem({ src: abs(poster), source: 'video-poster' }));
  });
  return out;
}

function detectFavicons(): ImageItem[] {
  const out: ImageItem[] = [];
  document
    .querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
    .forEach((el) => {
      const href = el.getAttribute('href');
      if (!href) return;
      out.push(makeItem({ src: abs(href), source: 'favicon' }));
    });
  return out;
}

function detectMetaImages(): ImageItem[] {
  const out: ImageItem[] = [];
  const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
  const ogAlt = document.querySelector('meta[property="og:image:alt"]')?.getAttribute('content') ?? '';
  if (ogImage) out.push(makeItem({ src: abs(ogImage), source: 'meta', alt: ogAlt }));

  const twitterImage = document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
  const twitterAlt = document.querySelector('meta[name="twitter:image:alt"]')?.getAttribute('content') ?? '';
  if (twitterImage) out.push(makeItem({ src: abs(twitterImage), source: 'meta', alt: twitterAlt }));
  return out;
}

/**
 * Detect every image on the page across all supported source types.
 * De-duplicates same (src, source) pairs. Does NOT de-dup across sources
 * (e.g. an <img> that is also og:image keeps both entries — semantic).
 */
export function detectImages(): ImageItem[] {
  const all: ImageItem[] = [
    ...detectImg(),
    ...detectPicture(),
    ...detectCssBackgrounds(),
    ...detectInlineSvg(),
    ...detectVideoPosters(),
    ...detectFavicons(),
    ...detectMetaImages(),
  ];

  const seen = new Set<string>();
  const out: ImageItem[] = [];
  for (const item of all) {
    const key = `${item.source}|${item.src}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
