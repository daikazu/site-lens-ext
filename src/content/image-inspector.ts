import type { ImageRole } from '../shared/types';
import {
  altTextIssue,
  findLcpImage,
  highPriorityCount,
  imgRole,
  isAboveFold,
  loadingIssues,
  parseCssUrls,
  svgRole,
} from './image-detector';

let active = false;
let tooltip: HTMLDivElement | null = null;
let styleEl: HTMLStyleElement | null = null;
let current: Target | null = null;
let lastTop: Element | null = null;
let lastPointer = { x: 0, y: 0 };

const TOOLTIP_ID = 'seo-ext-image-tooltip';
const STYLE_ID = 'seo-ext-image-inspector-style';
const OUTLINE_CLASS = 'seo-ext-image-inspected';
const ACTIVE_CLASS = 'seo-ext-image-inspector-active';

// Retina coverage: sizing sources for 2x covers nearly all phones and laptops without shipping 3x pixels.
const TARGET_DENSITY = 2;
// Some slack before calling an image oversized, so a 2x source shown on a 1x screen isn't flagged.
const OVERSIZE_FACTOR = 1.5;

type Target =
  | { kind: 'img'; el: HTMLImageElement; url: string }
  | { kind: 'svg'; el: SVGSVGElement; url: null }
  | { kind: 'poster'; el: HTMLVideoElement; url: string }
  | { kind: 'css-bg'; el: HTMLElement; url: string; layer: number };

type NaturalSize = { w: number; h: number } | 'pending' | 'error';

// Natural sizes of CSS backgrounds and posters, which have no naturalWidth to read.
const naturalCache = new Map<string, NaturalSize>();

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = `
    .${ACTIVE_CLASS}, .${ACTIVE_CLASS} * {
      cursor: crosshair !important;
    }
    .${OUTLINE_CLASS} {
      outline: 2px dashed #4ec9b0 !important;
      outline-offset: 2px !important;
    }
    #${TOOLTIP_ID} {
      position: fixed;
      z-index: 2147483647;
      background: #1e1e1e;
      color: #d4d4d4;
      border: 1px solid #444;
      border-radius: 6px;
      padding: 10px 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      font-size: 12px;
      line-height: 1.6;
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      max-width: 440px;
      white-space: nowrap;
      text-align: left;
    }
    #${TOOLTIP_ID} .seo-ii-title {
      color: #4ec9b0;
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
      border-bottom: 1px solid #333;
      padding-bottom: 4px;
    }
    #${TOOLTIP_ID} .seo-ii-section {
      color: #888;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 6px;
    }
    #${TOOLTIP_ID} .seo-ii-row {
      display: flex;
      gap: 8px;
    }
    #${TOOLTIP_ID} .seo-ii-label {
      color: #888;
      min-width: 90px;
      flex-shrink: 0;
    }
    #${TOOLTIP_ID} .seo-ii-value {
      color: #4fc1ff;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 320px;
    }
    #${TOOLTIP_ID} .seo-ii-good { color: #89d185; }
    #${TOOLTIP_ID} .seo-ii-bad { color: #f48771; }
    #${TOOLTIP_ID} .seo-ii-note {
      color: #777;
      font-size: 10px;
    }
    #${TOOLTIP_ID} .seo-ii-issue {
      color: #cca700;
      white-space: normal;
      max-width: 410px;
    }
    #${TOOLTIP_ID} .seo-ii-footer {
      color: #666;
      font-size: 10px;
      margin-top: 6px;
      border-top: 1px solid #333;
      padding-top: 4px;
    }
  `;
  document.head.appendChild(styleEl);
}

function createTooltip() {
  tooltip = document.createElement('div');
  tooltip.id = TOOLTIP_ID;
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);
}

function abs(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

// Splits a computed background-image list on top-level commas (gradients contain commas of their own).
function splitLayers(value: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      layers.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers;
}

function cssBackground(el: Element): { url: string; layer: number } | null {
  const bg = window.getComputedStyle(el).backgroundImage;
  if (!bg || bg === 'none' || !bg.includes('url(')) return null;
  const layers = splitLayers(bg);
  for (let i = 0; i < layers.length; i++) {
    const url = parseCssUrls(layers[i])[0];
    if (url) return { url: url.startsWith('data:') ? url : abs(url), layer: i };
  }
  return null;
}

// The topmost image under the pointer, looking through overlays (links, gradient scrims, captions).
// The page's own html/body backgrounds are skipped, or every hover would land on them.
function findTarget(x: number, y: number): Target | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (tooltip && (el === tooltip || tooltip.contains(el))) continue;
    if (el instanceof HTMLImageElement) {
      const url = el.currentSrc || el.getAttribute('src') || el.getAttribute('data-src') || '';
      if (url) return { kind: 'img', el, url: abs(url) };
      continue;
    }
    if (el instanceof SVGElement) {
      let svg = el instanceof SVGSVGElement ? el : el.ownerSVGElement;
      while (svg?.parentElement?.closest('svg')) svg = svg.parentElement.closest('svg');
      if (svg) return { kind: 'svg', el: svg, url: null };
      continue;
    }
    if (el instanceof HTMLVideoElement && el.getAttribute('poster')) {
      return { kind: 'poster', el, url: abs(el.getAttribute('poster')!) };
    }
    if (el === document.documentElement || el === document.body) continue;
    const bg = cssBackground(el);
    if (bg && el instanceof HTMLElement) return { kind: 'css-bg', el, ...bg };
  }
  return null;
}

function sameTarget(a: Target | null, b: Target | null): boolean {
  return !!a && !!b && a.el === b.el && a.url === b.url;
}

function naturalSize(t: Target): NaturalSize | null {
  if (t.kind === 'svg') return null;
  if (t.kind === 'img') {
    if (t.el.naturalWidth) return { w: t.el.naturalWidth, h: t.el.naturalHeight };
    return t.el.complete ? 'error' : 'pending';
  }
  const cached = naturalCache.get(t.url);
  if (cached) return cached;
  naturalCache.set(t.url, 'pending');
  const probe = new Image();
  probe.onload = () => {
    naturalCache.set(t.url, { w: probe.naturalWidth, h: probe.naturalHeight });
    if (current?.url === t.url) render(current);
  };
  probe.onerror = () => {
    naturalCache.set(t.url, 'error');
    if (current?.url === t.url) render(current);
  };
  probe.src = t.url;
  return 'pending';
}

// How the image's pixels are fitted into its box: object-fit for <img>/<video>, background-size for CSS.
function fitMode(t: Target): string {
  const cs = window.getComputedStyle(t.el);
  if (t.kind === 'img') return cs.objectFit;
  // Video posters are letterboxed by default even though object-fit computes to "fill".
  if (t.kind === 'poster') return cs.objectFit === 'cover' || cs.objectFit === 'none' ? cs.objectFit : 'contain';
  if (t.kind === 'css-bg') {
    const sizes = splitLayers(cs.backgroundSize);
    return sizes[t.layer] ?? sizes[0] ?? 'auto';
  }
  return 'fill';
}

// The size, in CSS px, the image's pixels are actually drawn at. With cover/contain that differs from the box.
function displayedSize(box: DOMRect, nat: { w: number; h: number }, fit: string): { w: number; h: number } {
  const bw = box.width;
  const bh = box.height;
  const cover = Math.max(bw / nat.w, bh / nat.h);
  const contain = Math.min(bw / nat.w, bh / nat.h);
  switch (fit) {
    case 'fill':
      return { w: bw, h: bh };
    case 'cover':
      return { w: nat.w * cover, h: nat.h * cover };
    case 'contain':
      return { w: nat.w * contain, h: nat.h * contain };
    case 'none':
    case 'auto':
    case 'auto auto':
      return { w: nat.w, h: nat.h };
    case 'scale-down':
      return contain < 1 ? { w: nat.w * contain, h: nat.h * contain } : { w: nat.w, h: nat.h };
  }
  // background-size lengths: "300px", "300px auto", "300px 200px". Percentages and anything else fall back to the box.
  const [wPart, hPart = 'auto'] = fit.split(/\s+/);
  const w = wPart.endsWith('px') ? parseFloat(wPart) : NaN;
  const h = hPart.endsWith('px') ? parseFloat(hPart) : NaN;
  if (!isNaN(w) && !isNaN(h)) return { w, h };
  if (!isNaN(w)) return { w, h: (w * nat.h) / nat.w };
  if (!isNaN(h)) return { w: (h * nat.w) / nat.h, h };
  return { w: bw, h: bh };
}

function formatOf(url: string): string | null {
  if (url.startsWith('data:')) {
    const mime = /^data:image\/([^;,]+)/i.exec(url)?.[1];
    return mime ? mime.replace('+xml', '').replace('jpeg', 'jpg').toUpperCase().replace('JPG', 'JPEG') : null;
  }
  const ext = /\.([a-z0-9]{3,4})(?:$|[?#])/i.exec(url)?.[1]?.toLowerCase();
  const names: Record<string, string> = {
    jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', webp: 'WebP', avif: 'AVIF', gif: 'GIF', svg: 'SVG', ico: 'ICO', bmp: 'BMP',
  };
  return ext ? names[ext] ?? null : null;
}

type FileSize = { transfer: number; decoded: number } | 'cross-origin' | 'unknown' | 'inline';

function fileSize(url: string): FileSize {
  if (url.startsWith('data:')) return 'inline';
  const entry = performance.getEntriesByName(url, 'resource')[0] as PerformanceResourceTiming | undefined;
  if (!entry) return 'unknown';
  // Cross-origin responses without Timing-Allow-Origin report 0 for every size.
  if (!entry.encodedBodySize) return 'cross-origin';
  return { transfer: entry.encodedBodySize, decoded: entry.decodedBodySize };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dims(w: number, h: number): string {
  return `${Math.round(w)}×${Math.round(h)}`;
}

function shortUrl(url: string): string {
  if (url.startsWith('data:')) return `${url.slice(0, 30)}…`;
  try {
    const u = new URL(url);
    const file = u.pathname.split('/').filter(Boolean).pop() || u.pathname;
    return u.origin === location.origin ? file : `${u.host}/…/${file}`;
  } catch {
    return url;
  }
}

const TITLES: Record<Target['kind'], string> = {
  img: '<img>',
  svg: '<svg>',
  poster: 'video poster',
  'css-bg': 'CSS background',
};

const ROLE_LABELS: Record<ImageRole, string> = {
  content: 'Content',
  functional: 'Functional (link/button)',
  decorative: 'Decorative',
  missing: 'Missing accessible name',
};

type Tone = 'good' | 'bad' | undefined;
type Row = { label: string; value: string; tone?: Tone };
type Section = { title: string; rows: Row[]; note?: string };

interface Report {
  title: string;
  url: string | null;
  sections: Section[];
  issues: string[];
  summary: string[];
}

function inspect(t: Target): Report {
  const box = t.el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const nat = naturalSize(t);
  const known = nat && typeof nat === 'object' ? nat : null;
  const fit = fitMode(t);
  const issues: string[] = [];
  const sections: Section[] = [];
  const summary: string[] = [];

  let title = TITLES[t.kind];
  if (t.kind === 'img' && t.el.parentElement instanceof HTMLPictureElement) title = '<picture> <img>';

  // --- Size ---
  const size: Row[] = [{ label: 'Box:', value: `${dims(box.width, box.height)} px` }];
  let shown: { w: number; h: number } | null = null;
  if (t.kind === 'svg') {
    size.push({ label: 'Natural:', value: 'Vector (scales freely)' });
  } else if (known) {
    shown = displayedSize(box, known, fit);
    size.push({ label: 'Natural:', value: `${dims(known.w, known.h)} px` });
    if (fit !== 'fill' && fit !== 'auto') size.push({ label: 'Fit:', value: fit });
    if (Math.round(shown.w) !== Math.round(box.width) || Math.round(shown.h) !== Math.round(box.height)) {
      size.push({ label: 'Drawn at:', value: `${dims(shown.w, shown.h)} px` });
    }
  } else {
    size.push({ label: 'Natural:', value: nat === 'pending' ? 'Loading…' : 'Unavailable' });
  }
  size.push({ label: 'Density:', value: `${+dpr.toFixed(2)}× DPR` });

  const visible = box.width > 0 && box.height > 0;
  let rec: { w: number; h: number } | null = null;
  if (known && shown && visible) {
    rec = { w: Math.ceil(shown.w * TARGET_DENSITY), h: Math.ceil(shown.w * TARGET_DENSITY * (known.h / known.w)) };
    if (known.w < shown.w * dpr * 0.95) {
      size.push({ label: 'Verdict:', value: `Blurry: needs ≥ ${Math.ceil(shown.w * dpr)}px wide`, tone: 'bad' });
      issues.push(`Too small for this screen: ${known.w}px wide, drawn at ${Math.round(shown.w)}px on a ${+dpr.toFixed(2)}× display`);
    } else if (known.w > rec.w * OVERSIZE_FACTOR) {
      const ratio = (known.w / rec.w).toFixed(1);
      size.push({ label: 'Verdict:', value: `Oversized: ${ratio}× larger than needed`, tone: 'bad' });
      issues.push(`Oversized: ${known.w}px wide but only needs ${rec.w}px`);
    } else {
      size.push({ label: 'Verdict:', value: 'Well sized', tone: 'good' });
    }
    if (fit === 'fill') {
      const natRatio = known.w / known.h;
      const boxRatio = box.width / box.height;
      if (Math.abs(boxRatio - natRatio) / natRatio > 0.02) {
        issues.push(`Stretched: shown at ${boxRatio.toFixed(2)}:1 but the image is ${natRatio.toFixed(2)}:1 (use object-fit or fix the dimensions)`);
      }
    }
  }
  sections.push({ title: 'Size', rows: size });

  // --- File ---
  const file: Row[] = [];
  const format = t.url ? formatOf(t.url) : 'Inline SVG';
  const bytes = t.url ? fileSize(t.url) : null;
  file.push({ label: 'Format:', value: format ?? 'Unknown' });
  if (bytes === 'inline') file.push({ label: 'Weight:', value: `Inline data URI (${formatBytes(t.url!.length)})` });
  else if (bytes === 'cross-origin') file.push({ label: 'Weight:', value: 'Unknown (cross-origin, no Timing-Allow-Origin)' });
  else if (bytes === 'unknown') file.push({ label: 'Weight:', value: 'Unknown (not in resource timing)' });
  else if (bytes) file.push({ label: 'Weight:', value: `${formatBytes(bytes.transfer)} transfer · ${formatBytes(bytes.decoded)} decoded` });
  if (t.url) file.push({ label: 'URL:', value: shortUrl(t.url) });
  if (t.kind === 'img') {
    const srcset = t.el.getAttribute('srcset') ?? t.el.parentElement?.querySelector('source[srcset]')?.getAttribute('srcset');
    if (srcset) {
      const count = srcset.split(',').filter((s) => s.trim()).length;
      file.push({ label: 'srcset:', value: `${count} candidate${count === 1 ? '' : 's'}; browser picked ${shortUrl(t.url)}` });
      const sizes = t.el.getAttribute('sizes');
      file.push({ label: 'sizes:', value: sizes || 'not set (defaults to 100vw)', tone: sizes ? undefined : 'bad' });
    }
  }
  sections.push({ title: 'File', rows: file });

  // --- Recommendation ---
  if (t.kind === 'svg') {
    sections.push({ title: 'Recommended', rows: [{ label: 'Size:', value: 'Vector, no resize needed', tone: 'good' }] });
  } else if (rec && shown && known) {
    const recRows: Row[] = [
      { label: 'Size:', value: `${dims(rec.w, rec.h)} px`, tone: 'good' },
      { label: 'srcset:', value: `${Math.ceil(shown.w)}w, ${rec.w}w` },
    ];
    if (typeof bytes === 'object' && bytes && known.w > rec.w) {
      const saved = bytes.transfer * (1 - (rec.w * rec.h) / (known.w * known.h));
      if (saved > 1024) recRows.push({ label: 'Est. saving:', value: `~${formatBytes(saved)} by resizing` });
    }
    if (format === 'JPEG' || format === 'PNG' || format === 'GIF') {
      recRows.push({ label: 'Format:', value: 'WebP or AVIF (typically 25–50% smaller)' });
    }
    sections.push({
      title: 'Recommended',
      rows: recRows,
      note: `Measured at a ${window.innerWidth}px viewport, sized for ${TARGET_DENSITY}× screens`,
    });
    summary.push(
      `Recommended: ${dims(rec.w, rec.h)} px (srcset ${Math.ceil(shown.w)}w, ${rec.w}w) at a ${window.innerWidth}px viewport`
    );
  }

  // --- Accessibility ---
  if (t.kind === 'img' || t.kind === 'svg') {
    const role = t.kind === 'img' ? imgRole(t.el) : svgRole(t.el);
    const alt =
      t.kind === 'img'
        ? t.el.getAttribute('alt')
        : (t.el.getAttribute('aria-label') ?? t.el.querySelector(':scope > title')?.textContent?.trim() ?? null);
    const a11y: Row[] = [
      { label: 'Role:', value: ROLE_LABELS[role], tone: role === 'missing' ? 'bad' : undefined },
      { label: t.kind === 'img' ? 'Alt:' : 'Name:', value: alt === null ? '(none)' : alt.trim() === '' ? '(empty)' : `“${alt}”` },
    ];
    sections.push({ title: 'Accessibility', rows: a11y });
    if (t.kind === 'img') {
      const altIssue = altTextIssue(t.el);
      if (altIssue) issues.push(altIssue);
    } else if (role === 'missing') {
      issues.push('No accessible name (add aria-label, or aria-hidden="true" if decorative)');
    }
  }

  // --- Loading ---
  if (t.kind === 'img') {
    const el = t.el;
    const lcpImage = findLcpImage();
    const rows: Row[] = [
      { label: 'loading:', value: el.getAttribute('loading') ?? 'eager (default)' },
      { label: 'fetchpriority:', value: el.getAttribute('fetchpriority') ?? 'auto (default)' },
      { label: 'decoding:', value: el.getAttribute('decoding') ?? 'auto (default)' },
      {
        label: 'Position:',
        value: `${isAboveFold(box) ? 'Above' : 'Below'} the fold${el === lcpImage ? ' · likely LCP image' : ''}`,
      },
    ];
    const hasDims = el.hasAttribute('width') && el.hasAttribute('height');
    const hasRatio = window.getComputedStyle(el).aspectRatio !== 'auto';
    rows.push({
      label: 'Dimensions:',
      value: hasDims ? 'width/height set' : hasRatio ? 'CSS aspect-ratio set' : 'width/height missing',
      tone: hasDims || hasRatio ? 'good' : 'bad',
    });
    if (!hasDims && !hasRatio) issues.push('Missing width/height attributes (can cause layout shift)');
    issues.push(...loadingIssues(el, lcpImage, highPriorityCount()));
    sections.push({ title: 'Loading', rows });
  }

  summary.unshift(
    `Image: ${t.url ?? 'inline <svg>'}`,
    `Type: ${title} · ${format ?? 'unknown format'}${typeof bytes === 'object' && bytes ? ` · ${formatBytes(bytes.transfer)}` : ''}`,
    `Box: ${dims(box.width, box.height)} px (DPR ${+dpr.toFixed(2)})`,
    ...(known ? [`Natural: ${dims(known.w, known.h)} px`] : [])
  );
  if (issues.length) summary.push('Issues:', ...issues.map((i) => `- ${i}`));

  return { title, url: t.url, sections, issues, summary };
}

function render(t: Target) {
  if (!tooltip) return;
  const report = inspect(t);
  tooltip.textContent = '';

  const title = document.createElement('div');
  title.className = 'seo-ii-title';
  title.textContent = `Image Inspector — ${report.title}`;
  tooltip.appendChild(title);

  for (const section of report.sections) {
    const heading = document.createElement('div');
    heading.className = 'seo-ii-section';
    heading.textContent = section.title;
    tooltip.appendChild(heading);

    for (const { label, value, tone } of section.rows) {
      const row = document.createElement('div');
      row.className = 'seo-ii-row';
      const labelSpan = document.createElement('span');
      labelSpan.className = 'seo-ii-label';
      labelSpan.textContent = label;
      const valueSpan = document.createElement('span');
      valueSpan.className = tone ? `seo-ii-value seo-ii-${tone}` : 'seo-ii-value';
      valueSpan.textContent = value;
      row.append(labelSpan, valueSpan);
      tooltip.appendChild(row);
    }
    if (section.note) {
      const note = document.createElement('div');
      note.className = 'seo-ii-note';
      note.textContent = section.note;
      tooltip.appendChild(note);
    }
  }

  if (report.issues.length) {
    const heading = document.createElement('div');
    heading.className = 'seo-ii-section';
    heading.textContent = 'Issues';
    tooltip.appendChild(heading);
    for (const issue of report.issues) {
      const div = document.createElement('div');
      div.className = 'seo-ii-issue';
      div.textContent = `⚠ ${issue}`;
      tooltip.appendChild(div);
    }
  }

  const footer = document.createElement('div');
  footer.className = 'seo-ii-footer';
  footer.textContent = 'Click to copy summary · Esc to exit';
  tooltip.appendChild(footer);
  position();
}

function position() {
  if (!tooltip) return;
  tooltip.style.display = 'block';
  const pad = 16;
  const { x: cx, y: cy } = lastPointer;
  let x = cx + pad;
  let y = cy + pad;
  const rect = tooltip.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = cx - rect.width - pad;
  if (y + rect.height > window.innerHeight) y = cy - rect.height - pad;
  tooltip.style.left = `${Math.max(0, x)}px`;
  tooltip.style.top = `${Math.max(0, y)}px`;
}

function setCurrent(t: Target | null) {
  if (current) current.el.classList.remove(OUTLINE_CLASS);
  current = t;
  if (t) t.el.classList.add(OUTLINE_CLASS);
}

function handleMouseMove(e: MouseEvent) {
  if (!active || !tooltip) return;
  lastPointer = { x: e.clientX, y: e.clientY };

  // Scanning the element stack is the expensive part; skip it while the pointer stays on the same element.
  const top = document.elementFromPoint(e.clientX, e.clientY);
  if (top === lastTop && current) return position();
  lastTop = top;

  const t = findTarget(e.clientX, e.clientY);
  if (!t) {
    setCurrent(null);
    tooltip.style.display = 'none';
    return;
  }
  if (!sameTarget(t, current)) {
    setCurrent(t);
    render(t);
  } else {
    position();
  }
}

function handleClick(e: MouseEvent) {
  if (!active || !current || !tooltip) return;
  // Only swallow clicks on an image, so the page stays usable elsewhere.
  e.preventDefault();
  e.stopPropagation();
  const text = inspect(current).summary.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const title = tooltip?.querySelector('.seo-ii-title');
    if (!title) return;
    const original = title.textContent;
    title.textContent = 'Copied summary to clipboard';
    setTimeout(() => {
      if (title.isConnected) title.textContent = original;
    }, 1200);
  });
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    disableImageInspector();
    chrome.runtime.sendMessage({ type: 'IMAGE_INSPECTOR_DISABLED' });
  }
}

function handleMouseLeave() {
  setCurrent(null);
  lastTop = null;
  if (tooltip) tooltip.style.display = 'none';
}

export function enableImageInspector() {
  if (active) return;
  active = true;
  ensureStyles();
  document.documentElement.classList.add(ACTIVE_CLASS);
  if (!tooltip) createTooltip();
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('mouseleave', handleMouseLeave, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);
}

export function disableImageInspector() {
  if (!active) return;
  active = false;
  document.documentElement.classList.remove(ACTIVE_CLASS);
  document.removeEventListener('mousemove', handleMouseMove, true);
  document.removeEventListener('mouseleave', handleMouseLeave, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  setCurrent(null);
  lastTop = null;
  if (tooltip) {
    tooltip.remove();
    tooltip = null;
  }
}

export function toggleImageInspector(): boolean {
  if (active) {
    disableImageInspector();
  } else {
    enableImageInspector();
  }
  return active;
}
