import type { ImageItem, ImageSource } from '../shared/types';

function abs(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
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

function detectImg(): ImageItem[] {
  const out: ImageItem[] = [];
  document.querySelectorAll('img').forEach((el) => {
    const raw = el.getAttribute('src') || el.getAttribute('data-src') || '';
    if (!raw) return;
    const issues: string[] = [];
    if ((el.getAttribute('alt') ?? '') === '') issues.push('Missing alt text');
    if (!el.getAttribute('loading')) issues.push('No lazy loading attribute');
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
