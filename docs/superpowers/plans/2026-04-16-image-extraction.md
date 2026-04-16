# Image Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bulk image extraction to the Site Lens DevTools panel — detect all images on a page (across 7 source types), let the user filter and select, then copy URLs/CSV to clipboard or download a ZIP archive.

**Architecture:** Detection runs in the content script as a pure module. The DevTools panel renders thumbnails, source filters, and per-row checkboxes. Cross-origin image bytes are fetched through the service worker (which already has `<all_urls>` host permission) to bypass page CORS. ZIP packing happens in the panel using JSZip and downloads via `chrome.downloads`.

**Tech Stack:** Chrome Extension MV3, TypeScript, Svelte 5, Vite, JSZip (new dependency).

**Verification model:** This repo has no test framework. Each task ends with explicit manual smoke-test steps: build with `npm run build`, reload the unpacked extension at `chrome://extensions`, open DevTools → Site Lens panel, and verify the described behavior on a real page.

**Reference spec:** `docs/superpowers/specs/2026-04-16-image-extraction-design.md`

---

## Task 0: Add JSZip dependency and `downloads` permission

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `public/manifest.json:16`

- [ ] **Step 1: Install JSZip**

Run from project root:

```
npm install --save-dev jszip
npm install --save-dev @types/jszip
```

Expected: `jszip` and `@types/jszip` appear in `package.json` devDependencies.

- [ ] **Step 2: Add `downloads` permission to manifest**

Edit `public/manifest.json` line 16.

Before:
```json
"permissions": ["activeTab", "scripting"],
```

After:
```json
"permissions": ["activeTab", "scripting", "downloads"],
```

- [ ] **Step 3: Build to verify nothing breaks**

Run `npm run build`. Expected: build succeeds, `dist/` populated, no errors.

- [ ] **Step 4: Reload extension and verify permission shown**

Open `chrome://extensions`, click Reload on Site Lens. Click Details → Permissions should now list "Manage your downloads."

- [ ] **Step 5: Commit**

`git add package.json package-lock.json public/manifest.json && git commit -m "deps: add jszip and downloads permission for image extraction"`

---

## Task 1: Extend `ImageItem` type with `source` field

**Files:**
- Modify: `src/shared/types.ts:64-72`

- [ ] **Step 1: Add `ImageSource` union and extend `ImageItem`**

Edit `src/shared/types.ts` lines 63–72.

Before:
```ts
// --- Images ---
export interface ImageItem {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
  loading: string | null;
  fileSize?: number;
  issues: string[];
}
```

After:
```ts
// --- Images ---
export type ImageSource =
  | 'img'
  | 'picture'
  | 'css-bg'
  | 'svg'
  | 'video-poster'
  | 'favicon'
  | 'meta';

export interface ImageItem {
  src: string;            // absolute URL or data: URI
  source: ImageSource;
  alt: string;            // empty string if not applicable
  width: number | null;
  height: number | null;
  loading: string | null;
  fileSize?: number;
  issues: string[];
}
```

- [ ] **Step 2: Build to verify TypeScript compiles**

Run `npm run build`. Expected: build fails with type errors in `src/content/analyzer.ts` inside `analyzeImages` because the existing item literal does not include `source`. This is expected — Task 3 fixes it.

- [ ] **Step 3: Commit**

`git add src/shared/types.ts && git commit -m "types: add ImageSource union and source field to ImageItem"`

---

## Task 2: Create `image-detector.ts` with all 7 detectors

**Files:**
- Create: `src/content/image-detector.ts`

- [ ] **Step 1: Create the detector module**

Create `src/content/image-detector.ts` with this content:

```ts
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
  document.querySelectorAll('svg').forEach((el, i) => {
    // Only top-level SVGs (skip nested SVGs whose parent is also SVG)
    if (el.parentElement?.closest('svg')) return;
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
        alt: el.getAttribute('aria-label') ?? `inline-svg-${i + 1}`,
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
```

- [ ] **Step 2: Build to verify it compiles**

Run `npm run build`. Expected: still fails on `analyzeImages` in `analyzer.ts` (Task 3 fixes). The new file itself compiles cleanly.

- [ ] **Step 3: Commit**

`git add src/content/image-detector.ts && git commit -m "content: add image-detector module covering 7 image source types"`

---

## Task 3: Wire detector into `analyzer.ts`

**Files:**
- Modify: `src/content/analyzer.ts:1-6` (add import)
- Modify: `src/content/analyzer.ts:238-287` (replace `analyzeImages`)

- [ ] **Step 1: Add import for `detectImages`**

Edit `src/content/analyzer.ts`. After line 5, add:

```ts
import { detectImages } from './image-detector';
```

- [ ] **Step 2: Replace `analyzeImages()` to use the detector**

Replace lines 238–287 (the entire current `analyzeImages` function):

```ts
function analyzeImages(): AnalysisResult['images'] {
  const items = detectImages();
  const warnings: string[] = [];

  const imgItems = items.filter((i) => i.source === 'img');
  const missingAlt = imgItems.filter((i) => i.issues.includes('Missing alt text')).length;
  if (missingAlt > 0) warnings.push(`${missingAlt} image(s) missing alt text`);

  const ogImage = document.querySelector('meta[property="og:image"]');
  const ogWidth = document.querySelector('meta[property="og:image:width"]');
  const ogHeight = document.querySelector('meta[property="og:image:height"]');
  const ogType = document.querySelector('meta[property="og:image:type"]');
  const ogAlt = document.querySelector('meta[property="og:image:alt"]');

  const og = {
    url: ogImage?.getAttribute('content') || null,
    width: ogWidth?.getAttribute('content') || null,
    height: ogHeight?.getAttribute('content') || null,
    type: ogType?.getAttribute('content') || null,
    alt: ogAlt?.getAttribute('content') || null,
  };

  const twitterCard = document.querySelector('meta[name="twitter:card"]');
  const twitterImage = document.querySelector('meta[name="twitter:image"]');
  const twitterImageAlt = document.querySelector('meta[name="twitter:image:alt"]');

  const twitter = {
    card: twitterCard?.getAttribute('content') || null,
    image: twitterImage?.getAttribute('content') || null,
    imageAlt: twitterImageAlt?.getAttribute('content') || null,
  };

  return { items, og, twitter, warnings };
}
```

- [ ] **Step 3: Build successfully**

Run `npm run build`. Expected: build succeeds with no errors.

- [ ] **Step 4: Reload extension and smoke-test**

1. Open `chrome://extensions`, reload Site Lens.
2. Open DevTools on a content-rich page (e.g., a news article).
3. Open Site Lens → Images tab.
4. Verify the table now shows more than just `<img>` images: favicon, og:image, and (where present) inline SVG / CSS backgrounds / video posters appear.
5. Verify each row's `src` looks like an absolute URL (or `data:image/svg+xml;...` for inline SVG).
6. The `source` field is in the data but not yet shown — that is fine, Task 7 surfaces it.

- [ ] **Step 5: Commit**

`git add src/content/analyzer.ts && git commit -m "content: route analyzeImages through image-detector"`

---

## Task 4: Add `FETCH_IMAGE` handler to service worker

**Files:**
- Modify: `src/background/service-worker.ts` (insert new handler before final `return false`)
- Modify: `src/shared/types.ts:168-174` (extend `MessageType` union and add `FetchImageResponse`)

- [ ] **Step 1: Add message variant and response type to `types.ts`**

Edit `src/shared/types.ts` lines 168–174.

Before:
```ts
export type MessageType =
  | { type: 'ANALYZE_PAGE'; tabId: number }
  | { type: 'DEEP_SCAN_LINKS'; tabId: number; urls: string[] }
  | { type: 'FETCH_ROBOTS'; tabId: number; origin: string }
  | { type: 'FETCH_SITEMAP'; tabId: number; origin: string }
  | { type: 'HIGHLIGHT_LINKS'; tabId: number; mode: HighlightMode }
  | { type: 'CLEAR_HIGHLIGHTS'; tabId: number };
```

After:
```ts
export type MessageType =
  | { type: 'ANALYZE_PAGE'; tabId: number }
  | { type: 'DEEP_SCAN_LINKS'; tabId: number; urls: string[] }
  | { type: 'FETCH_ROBOTS'; tabId: number; origin: string }
  | { type: 'FETCH_SITEMAP'; tabId: number; origin: string }
  | { type: 'FETCH_IMAGE'; url: string }
  | { type: 'HIGHLIGHT_LINKS'; tabId: number; mode: HighlightMode }
  | { type: 'CLEAR_HIGHLIGHTS'; tabId: number };

export type FetchImageResponse =
  | { ok: true; bytes: ArrayBuffer; contentType: string; status: number }
  | { ok: false; error: string; status?: number };
```

- [ ] **Step 2: Add handler in service worker**

Edit `src/background/service-worker.ts`. Insert this block immediately before the final `return false;` (currently line 77):

```ts
  if (message.type === 'FETCH_IMAGE') {
    fetch(message.url)
      .then(async (res) => {
        if (!res.ok) {
          sendResponse({ ok: false, error: `HTTP ${res.status}`, status: res.status });
          return;
        }
        const contentType = res.headers.get('content-type') || 'application/octet-stream';
        const bytes = await res.arrayBuffer();
        sendResponse({ ok: true, bytes, contentType, status: res.status });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error: msg });
      });
    return true;
  }
```

- [ ] **Step 3: Build successfully**

Run `npm run build`. Expected: build succeeds.

- [ ] **Step 4: Smoke-test the handler from a console**

1. Reload extension.
2. Open `chrome://extensions` → click the "service worker" link under Site Lens to open the SW console.
3. From that console:

```js
chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url: 'https://www.google.com/favicon.ico' }, (r) => console.log(r));
```

Expected: console logs `{ ok: true, bytes: ArrayBuffer(...), contentType: 'image/x-icon', status: 200 }`.

4. Then try a known-bad URL:

```js
chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url: 'https://example.com/does-not-exist-xyz.png' }, (r) => console.log(r));
```

Expected: `{ ok: false, error: 'HTTP 404', status: 404 }`.

- [ ] **Step 5: Commit**

`git add src/background/service-worker.ts src/shared/types.ts && git commit -m "background: add FETCH_IMAGE handler for CORS-bypass image fetch"`

---

## Task 5: Create `image-export.ts` with URL list and CSV builders

**Files:**
- Create: `src/panel/lib/image-export.ts`

- [ ] **Step 1: Create directory and module**

Create the directory: `mkdir -p src/panel/lib`

Then create `src/panel/lib/image-export.ts`:

```ts
import type { ImageItem } from '../../shared/types';

export interface UrlListResult {
  text: string;
  count: number;
  skipped: number;
}

/**
 * Build a plain-text URL list (one per line). data: URI entries (e.g. inline SVGs)
 * are skipped so users get pasteable URLs.
 */
export function buildUrlList(items: ImageItem[]): UrlListResult {
  const urls: string[] = [];
  let skipped = 0;
  for (const item of items) {
    if (item.src.startsWith('data:')) {
      skipped++;
      continue;
    }
    urls.push(item.src);
  }
  return { text: urls.join('\n'), count: urls.length, skipped };
}

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Build a CSV with header: url,source,alt,width,height,loading,issues
 * RFC 4180 quoting. issues are joined with "; " inside the field.
 * data: URI rows keep the data: URI in the url column.
 */
export function buildCsv(items: ImageItem[]): string {
  const header = 'url,source,alt,width,height,loading,issues';
  const rows = items.map((it) =>
    [
      csvEscape(it.src),
      csvEscape(it.source),
      csvEscape(it.alt),
      csvEscape(it.width),
      csvEscape(it.height),
      csvEscape(it.loading),
      csvEscape(it.issues.join('; ')),
    ].join(',')
  );
  return [header, ...rows].join('\n');
}
```

- [ ] **Step 2: Build successfully**

Run `npm run build`. Expected: build succeeds.

- [ ] **Step 3: Commit**

`git add src/panel/lib/image-export.ts && git commit -m "panel: add image-export module with buildUrlList and buildCsv"`

---

## Task 6: Add `buildZip` with JSZip + concurrency runner

**Files:**
- Modify: `src/panel/lib/image-export.ts` (append)

- [ ] **Step 1: Append ZIP builder and helpers**

Add to the end of `src/panel/lib/image-export.ts`:

```ts
import JSZip from 'jszip';
import type { FetchImageResponse, ImageSource } from '../../shared/types';

export interface ZipProgress {
  fetched: number;
  total: number;
  failures: number;
}

export interface ZipResult {
  blob: Blob;
  filename: string;
  succeeded: number;
  failed: number;
}

const SOURCE_FOLDER: Record<ImageSource, string> = {
  img: 'img',
  picture: 'picture',
  'css-bg': 'css-bg',
  svg: 'svg',
  'video-poster': 'video-poster',
  favicon: 'favicon',
  meta: 'meta',
};

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

function basenameFromUrl(url: string): { name: string; ext: string } {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || 'image';
    const dot = last.lastIndexOf('.');
    if (dot > 0 && dot < last.length - 1) {
      return { name: last.slice(0, dot), ext: last.slice(dot + 1).toLowerCase() };
    }
    return { name: last, ext: '' };
  } catch {
    return { name: 'image', ext: '' };
  }
}

function uniqueName(base: string, ext: string, taken: Set<string>): string {
  const extPart = ext ? '.' + ext : '';
  let candidate = base + extPart;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${n}${extPart}`;
    n++;
  }
  taken.add(candidate);
  return candidate;
}

function fetchImageBytes(url: string, signal: AbortSignal): Promise<FetchImageResponse> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ ok: false, error: 'Aborted' });
      return;
    }
    const onAbort = () => resolve({ ok: false, error: 'Aborted' });
    signal.addEventListener('abort', onAbort, { once: true });
    chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url }, (res: FetchImageResponse) => {
      signal.removeEventListener('abort', onAbort);
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message || 'runtime error' });
        return;
      }
      resolve(res);
    });
  });
}

async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
  signal: AbortSignal
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!signal.aborted) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function dataUriToBytes(dataUri: string): { bytes: Uint8Array; contentType: string } | null {
  const match = dataUri.match(/^data:([^;,]+)?(?:;([^,]+))?,(.*)$/);
  if (!match) return null;
  const contentType = match[1] || 'application/octet-stream';
  const meta = match[2] || '';
  const payload = match[3];
  if (meta.includes('base64')) {
    const binary = atob(payload);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return { bytes: arr, contentType };
  }
  // utf8 / url-encoded data URI (e.g. inline SVG)
  const text = decodeURIComponent(payload);
  return { bytes: new TextEncoder().encode(text), contentType };
}

export async function buildZip(
  items: ImageItem[],
  hostname: string,
  onProgress: (p: ZipProgress) => void,
  signal: AbortSignal
): Promise<ZipResult> {
  const zip = new JSZip();
  const folders = new Map<ImageSource, JSZip>();
  const takenByFolder = new Map<ImageSource, Set<string>>();
  const manifestLines: string[] = [];
  let fetched = 0;
  let failures = 0;

  function getFolder(source: ImageSource): JSZip {
    let f = folders.get(source);
    if (!f) {
      f = zip.folder(SOURCE_FOLDER[source])!;
      folders.set(source, f);
      takenByFolder.set(source, new Set());
    }
    return f;
  }

  function recordSuccess(source: ImageSource, fileName: string, url: string) {
    manifestLines.push(`[${source.padEnd(13)}] ${SOURCE_FOLDER[source]}/${fileName.padEnd(40)} ${url}`);
  }
  function recordFailure(source: ImageSource, reason: string, url: string) {
    failures++;
    manifestLines.push(`[${source.padEnd(13)}] FAILED: ${reason.padEnd(32)} ${url}`);
  }

  let svgIndex = 0;

  await withConcurrency(
    items,
    6,
    async (item) => {
      if (signal.aborted) return;

      // Inline SVG / data: URI — no fetch needed
      if (item.src.startsWith('data:')) {
        const decoded = dataUriToBytes(item.src);
        if (!decoded) {
          recordFailure(item.source, 'Invalid data URI', '(inline)');
        } else {
          const folder = getFolder(item.source);
          const taken = takenByFolder.get(item.source)!;
          const ext = CONTENT_TYPE_EXT[decoded.contentType] || 'bin';
          const baseName = item.source === 'svg' ? `inline-svg-${++svgIndex}` : 'inline';
          const fileName = uniqueName(baseName, ext, taken);
          folder.file(fileName, decoded.bytes);
          recordSuccess(item.source, fileName, '(inline)');
        }
        fetched++;
        onProgress({ fetched, total: items.length, failures });
        return;
      }

      const res = await fetchImageBytes(item.src, signal);
      if (!res.ok) {
        recordFailure(item.source, res.error || 'unknown error', item.src);
      } else {
        const folder = getFolder(item.source);
        const taken = takenByFolder.get(item.source)!;
        const { name, ext } = basenameFromUrl(item.src);
        const finalExt = ext || CONTENT_TYPE_EXT[res.contentType.split(';')[0].trim()] || 'bin';
        const fileName = uniqueName(name, finalExt, taken);
        folder.file(fileName, res.bytes);
        recordSuccess(item.source, fileName, item.src);
      }
      fetched++;
      onProgress({ fetched, total: items.length, failures });
    },
    signal
  );

  if (signal.aborted) {
    throw new Error('Aborted');
  }

  zip.file('_manifest.txt', manifestLines.join('\n') + '\n');

  const blob = await zip.generateAsync({ type: 'blob' });
  const ts = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  const safeHost = hostname.replace(/[^a-z0-9.-]/gi, '_');
  const filename = `site-lens-images-${safeHost}-${stamp}.zip`;

  return { blob, filename, succeeded: items.length - failures, failed: failures };
}
```

- [ ] **Step 2: Build successfully**

Run `npm run build`. Expected: build succeeds. JSZip bundles into the panel chunk.

- [ ] **Step 3: Commit**

`git add src/panel/lib/image-export.ts && git commit -m "panel: add buildZip with JSZip, concurrency runner, and manifest"`

---

## Task 7: Create `ImagesTable.svelte` custom table component

**Reason for new component:** the existing `SortableTable` renders cells via text-only `render` strings. Thumbnails, checkboxes, and source badges need real markup. Rather than retrofit `SortableTable` (and risk regressions in other tabs), this task creates a purpose-built table for the Images tab.

**Files:**
- Create: `src/panel/components/ImagesTable.svelte`

- [ ] **Step 1: Create the component**

Create `src/panel/components/ImagesTable.svelte`:

```svelte
<script lang="ts">
  import type { ImageItem, ImageSource } from '../../shared/types';

  interface Props {
    items: ImageItem[];
    selectedSrcs: Set<string>;
    maxHeight?: string;
    onToggleRow: (item: ImageItem) => void;
    onToggleAll: (allSelected: boolean) => void;
    onScrollTo: (item: ImageItem) => void;
  }

  let { items, selectedSrcs, maxHeight = '400px', onToggleRow, onToggleAll, onScrollTo }: Props = $props();

  type SortKey = 'src' | 'source' | 'alt' | 'width' | 'height' | 'loading';
  let sortKey = $state<SortKey | null>(null);
  let sortDir = $state<'asc' | 'desc'>('asc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
  }

  let sortedItems = $derived.by(() => {
    if (!sortKey) return items;
    const key = sortKey;
    return [...items].sort((a, b) => {
      const av = (a as Record<string, unknown>)[key];
      const bv = (b as Record<string, unknown>)[key];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });

  let allSelected = $derived(items.length > 0 && items.every((i) => selectedSrcs.has(i.src)));

  const SOURCE_LABEL: Record<ImageSource, string> = {
    img: 'img',
    picture: 'picture',
    'css-bg': 'css-bg',
    svg: 'svg',
    'video-poster': 'poster',
    favicon: 'favicon',
    meta: 'meta',
  };
</script>

<div class="table-wrapper" style="max-height: {maxHeight}">
  <table>
    <thead>
      <tr>
        <th class="col-select">
          <input
            type="checkbox"
            checked={allSelected}
            onchange={() => onToggleAll(allSelected)}
            aria-label="Select all"
          />
        </th>
        <th class="col-thumb">Preview</th>
        <th class="col-source" onclick={() => toggleSort('source')}>
          Source{#if sortKey === 'source'}<span class="sort-arrow">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>{/if}
        </th>
        <th class="col-src" onclick={() => toggleSort('src')}>
          Source URL{#if sortKey === 'src'}<span class="sort-arrow">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>{/if}
        </th>
        <th class="col-alt" onclick={() => toggleSort('alt')}>
          Alt{#if sortKey === 'alt'}<span class="sort-arrow">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>{/if}
        </th>
        <th class="col-num" onclick={() => toggleSort('width')}>W</th>
        <th class="col-num" onclick={() => toggleSort('height')}>H</th>
        <th class="col-loading" onclick={() => toggleSort('loading')}>Loading</th>
        <th class="col-issues">Issues</th>
      </tr>
    </thead>
    <tbody>
      {#each sortedItems as item (item.source + '|' + item.src)}
        <tr>
          <td class="col-select">
            <input
              type="checkbox"
              checked={selectedSrcs.has(item.src)}
              onchange={() => onToggleRow(item)}
              onclick={(e) => e.stopPropagation()}
              aria-label="Select image"
            />
          </td>
          <td class="col-thumb">
            <button class="thumb-btn" onclick={() => onScrollTo(item)} title="Scroll to image">
              <img
                src={item.src}
                loading="lazy"
                alt=""
                onerror={(e) => { (e.currentTarget as HTMLImageElement).classList.add('broken'); }}
              />
            </button>
          </td>
          <td class="col-source"><span class="src-badge src-{item.source}">{SOURCE_LABEL[item.source]}</span></td>
          <td class="col-src clickable" onclick={() => onScrollTo(item)}>
            {item.src.length > 80 ? item.src.slice(0, 80) + '\u2026' : item.src}
          </td>
          <td class="col-alt">{item.alt || ''}</td>
          <td class="col-num">{item.width ?? ''}</td>
          <td class="col-num">{item.height ?? ''}</td>
          <td class="col-loading">{item.loading ?? ''}</td>
          <td class="col-issues">{item.issues.join(', ')}</td>
        </tr>
      {/each}
      {#if sortedItems.length === 0}
        <tr><td colspan="9" class="empty">No images match the current filters</td></tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .table-wrapper {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    font-family: var(--font-mono);
  }
  thead { position: sticky; top: 0; z-index: 1; }
  th {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-color);
    cursor: pointer;
    user-select: none;
    font-weight: 500;
    white-space: nowrap;
  }
  th.col-select, th.col-thumb { cursor: default; }
  th:hover { color: var(--text-primary); }
  .sort-arrow { font-size: 9px; margin-left: 4px; }
  td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-primary);
    word-break: break-all;
    vertical-align: middle;
  }
  td.clickable { cursor: pointer; }
  td.clickable:hover { color: var(--info-color); }
  .col-select { width: 24px; text-align: center; padding: 4px; }
  .col-thumb { width: 64px; padding: 2px; }
  .col-source { width: 80px; }
  .col-num { width: 48px; text-align: right; }
  .col-loading { width: 80px; }
  .col-issues { color: var(--warning-color); }

  .thumb-btn {
    display: block;
    width: 56px;
    height: 56px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: #1a1a1a;
    cursor: pointer;
    overflow: hidden;
  }
  .thumb-btn img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .thumb-btn img.broken {
    background: repeating-linear-gradient(45deg, #2a2a2a, #2a2a2a 4px, #1a1a1a 4px, #1a1a1a 8px);
  }

  .src-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-family: var(--font-system);
    font-weight: 500;
    background: rgba(255,255,255,0.06);
    color: var(--text-secondary);
  }
  .src-img       { background: rgba(117, 190, 255, 0.18); color: #75beff; }
  .src-picture   { background: rgba(78, 201, 176, 0.18);  color: #4ec9b0; }
  .src-css-bg    { background: rgba(204, 167, 0, 0.18);   color: #cca700; }
  .src-svg       { background: rgba(197, 134, 192, 0.18); color: #c586c0; }
  .src-video-poster { background: rgba(241, 76, 76, 0.18); color: #f14c4c; }
  .src-favicon   { background: rgba(206, 145, 120, 0.18); color: #ce9178; }
  .src-meta      { background: rgba(150, 150, 150, 0.18); color: #aaa; }

  .empty { text-align: center; color: var(--text-muted); padding: 16px; }
</style>
```

- [ ] **Step 2: Build successfully**

Run `npm run build`. Expected: build succeeds.

- [ ] **Step 3: Commit**

`git add src/panel/components/ImagesTable.svelte && git commit -m "panel: add ImagesTable component with thumbnails, checkboxes, source badges"`

---

## Task 8: Replace Images tab body with new table + filter UI

**Files:**
- Modify: `src/panel/tabs/Images.svelte` (full rewrite)

- [ ] **Step 1: Rewrite `Images.svelte`**

Replace the entire contents of `src/panel/tabs/Images.svelte` with:

```svelte
<script lang="ts">
  import type { ImagesData, ImageItem, ImageSource } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import ImagesTable from '../components/ImagesTable.svelte';

  interface Props {
    data: ImagesData;
    tabId: number;
  }

  let { data, tabId }: Props = $props();

  const ALL_SOURCES: ImageSource[] = ['img', 'picture', 'css-bg', 'svg', 'video-poster', 'favicon', 'meta'];
  const DEFAULT_ON: ImageSource[] = ['img', 'picture', 'favicon', 'meta'];

  let activeSources = $state<Set<ImageSource>>(new Set(DEFAULT_ON));
  let selectedSrcs = $state<Set<string>>(new Set());

  let filteredItems = $derived(data.items.filter((it) => activeSources.has(it.source)));
  let selectedItems = $derived(filteredItems.filter((it) => selectedSrcs.has(it.src)));

  function toggleSource(s: ImageSource) {
    const next = new Set(activeSources);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    activeSources = next;
  }

  function toggleRow(item: ImageItem) {
    const next = new Set(selectedSrcs);
    if (next.has(item.src)) next.delete(item.src);
    else next.add(item.src);
    selectedSrcs = next;
  }

  function toggleAll(allSelected: boolean) {
    const next = new Set(selectedSrcs);
    if (allSelected) {
      filteredItems.forEach((i) => next.delete(i.src));
    } else {
      filteredItems.forEach((i) => next.add(i.src));
    }
    selectedSrcs = next;
  }

  function scrollToImage(item: ImageItem) {
    const srcJson = JSON.stringify(item.src);
    chrome.devtools.inspectedWindow.eval(
      `(function() {
        var STYLE_ID = 'seo-ext-img-highlight-style';
        if (!document.getElementById(STYLE_ID)) {
          var s = document.createElement('style');
          s.id = STYLE_ID;
          s.textContent = '@keyframes seo-ext-img-pulse { 0%, 100% { outline-color: #4fc1ff; box-shadow: 0 0 12px rgba(79, 193, 255, 0.5); } 50% { outline-color: #ff6b6b; box-shadow: 0 0 12px rgba(255, 107, 107, 0.5); } }' +
            '.seo-ext-img-scrolled { outline: 3px solid #4fc1ff !important; outline-offset: 3px !important; animation: seo-ext-img-pulse 1s ease-in-out 3 !important; position: relative !important; z-index: 999999 !important; box-shadow: 0 0 12px rgba(79, 193, 255, 0.5) !important; }';
          document.head.appendChild(s);
        }
        var prev = document.querySelectorAll('.seo-ext-img-scrolled');
        prev.forEach(function(p) { p.classList.remove('seo-ext-img-scrolled'); });
        var target = ${srcJson};
        var resolvedTarget = target;
        try { resolvedTarget = new URL(target, window.location.href).href; } catch(e) {}
        var imgs = document.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
          var el = imgs[i];
          var elSrc = el.getAttribute('src') || el.getAttribute('data-src') || '';
          try { elSrc = new URL(elSrc, window.location.href).href; } catch(e) {}
          if (elSrc === resolvedTarget || el.getAttribute('src') === target) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('seo-ext-img-scrolled');
            setTimeout(function() { el.classList.remove('seo-ext-img-scrolled'); }, 4000);
            break;
          }
        }
      })()`
    );
  }
</script>

<div class="images-tab">
  {#if data.warnings.length > 0}
    <section class="warnings">
      {#each data.warnings as warning}
        <div class="warning-row">
          <Badge type="warning" label="Warning" />
          <span>{warning}</span>
        </div>
      {/each}
    </section>
  {/if}

  <section class="extract-panel">
    <div class="panel-title">Extract</div>
    <div class="filter-row">
      <span class="filter-label">Sources:</span>
      {#each ALL_SOURCES as src}
        <label class="filter-chip">
          <input type="checkbox" checked={activeSources.has(src)} onchange={() => toggleSource(src)} />
          <span>{src}</span>
        </label>
      {/each}
    </div>
    <div class="status-line">
      Showing {filteredItems.length} of {data.items.length} images
      {#if selectedSrcs.size > 0} · {selectedItems.length} selected{/if}
    </div>
    <!-- Export buttons wired in Tasks 9 & 10 -->
    <div class="actions" id="extract-actions-placeholder"></div>
  </section>

  <section class="section">
    <h3 class="section-title">Page Images</h3>
    <ImagesTable
      items={filteredItems}
      selectedSrcs={selectedSrcs}
      maxHeight="500px"
      onToggleRow={toggleRow}
      onToggleAll={toggleAll}
      onScrollTo={scrollToImage}
    />
  </section>
</div>

<style>
  .images-tab { display: flex; flex-direction: column; gap: 4px; }
  .warnings { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border-color); }
  .warning-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .extract-panel {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
  }
  .panel-title {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; color: var(--text-secondary); margin-bottom: 8px;
  }
  .filter-row {
    display: flex; flex-wrap: wrap; align-items: center;
    gap: 6px 12px; font-size: 12px;
  }
  .filter-label { color: var(--text-muted); }
  .filter-chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: 12px;
    background: var(--bg-primary); cursor: pointer;
  }
  .filter-chip input { margin: 0; cursor: pointer; }
  .status-line { margin-top: 8px; font-size: 12px; color: var(--text-muted); }
  .actions { margin-top: 8px; display: flex; gap: 8px; }
  .section { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
  .section-title { color: var(--text-secondary); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
</style>
```

- [ ] **Step 2: Build successfully**

Run `npm run build`. Expected: build succeeds. (TypeScript may warn about unused `tabId` — leave it; the spec keeps it for parity with other tabs and Task 10 uses it.)

- [ ] **Step 3: Reload and smoke-test**

1. Reload the extension.
2. Open DevTools → Site Lens → Images tab on a content-rich page.
3. Verify: source filter chips appear at the top with `img`, `picture`, `favicon`, `meta` checked by default.
4. Verify: table shows thumbnails for each row, source badge column, and per-row checkboxes.
5. Toggle a filter chip — table re-filters immediately, status line count updates.
6. Click a checkbox — selection count appears in status line.
7. Click the header checkbox — selects all currently-visible rows; click again deselects.
8. Click a thumbnail or the URL — page scrolls to that image with the existing pulse animation (works for `<img>` rows; CSS-bg / SVG won't find a matching `<img>` and quietly do nothing — known acceptable behavior).

- [ ] **Step 4: Commit**

`git add src/panel/tabs/Images.svelte && git commit -m "panel: rebuild Images tab with extract panel, filters, thumbnails, selection"`

---

## Task 9: Wire Copy URLs and Copy CSV buttons

**Files:**
- Modify: `src/panel/tabs/Images.svelte` (script section + actions block)

- [ ] **Step 1: Add export imports and toast state**

In `src/panel/tabs/Images.svelte`, add this import after the existing imports at the top of `<script lang="ts">`:

```ts
  import { buildUrlList, buildCsv } from '../lib/image-export';
```

Add this state right after `let selectedSrcs = $state<Set<string>>(new Set());`:

```ts
  let toast = $state<string | null>(null);
  let toastTimer: number | null = null;
  function showToast(msg: string) {
    toast = msg;
    if (toastTimer != null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast = null; toastTimer = null; }, 3000);
  }
```

- [ ] **Step 2: Add Copy URLs and Copy CSV handlers**

Add these functions after `scrollToImage`:

```ts
  async function copyUrls(items: ImageItem[]) {
    const result = buildUrlList(items);
    await navigator.clipboard.writeText(result.text);
    const skipNote = result.skipped > 0 ? ` (${result.skipped} inline SVGs skipped)` : '';
    showToast(`Copied ${result.count} URLs${skipNote}`);
  }

  async function copyCsv(items: ImageItem[]) {
    const csv = buildCsv(items);
    await navigator.clipboard.writeText(csv);
    showToast(`Copied ${items.length} rows as CSV`);
  }
```

- [ ] **Step 3: Replace the actions placeholder**

Replace the line `<div class="actions" id="extract-actions-placeholder"></div>` with:

```svelte
    <div class="actions">
      <div class="action-group">
        <span class="action-label">Copy URLs:</span>
        <button class="action-btn" onclick={() => copyUrls(filteredItems)} disabled={filteredItems.length === 0}>
          All ({filteredItems.length})
        </button>
        <button class="action-btn" onclick={() => copyUrls(selectedItems)} disabled={selectedItems.length === 0}>
          Selected ({selectedItems.length})
        </button>
        <button class="action-btn" onclick={() => copyCsv(filteredItems)} disabled={filteredItems.length === 0}>
          As CSV
        </button>
      </div>
    </div>
    {#if toast}
      <div class="toast">{toast}</div>
    {/if}
```

- [ ] **Step 4: Add styles for buttons and toast**

Append to the `<style>` block in `Images.svelte`:

```css
  .action-group { display: inline-flex; align-items: center; gap: 6px; }
  .action-label { color: var(--text-muted); font-size: 11px; margin-right: 2px; }
  .action-btn {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    font-size: 11px; padding: 4px 10px;
    border-radius: 3px; cursor: pointer;
  }
  .action-btn:hover:not(:disabled) {
    border-color: var(--info-color);
    color: var(--info-color);
  }
  .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .toast {
    margin-top: 8px;
    background: rgba(78, 201, 176, 0.15);
    color: var(--success-color);
    padding: 4px 10px;
    border-radius: 3px;
    font-size: 11px;
    display: inline-block;
  }
```

- [ ] **Step 5: Build successfully**

Run `npm run build`. Expected: build succeeds.

- [ ] **Step 6: Reload and smoke-test**

1. Reload extension, open DevTools → Site Lens → Images.
2. Click "All" under Copy URLs. Toast appears: "Copied N URLs". Paste somewhere — verify N URLs, one per line.
3. Select 3 rows via checkbox, click "Selected". Toast: "Copied 3 URLs". Paste verifies.
4. Enable the `svg` filter on a page with inline SVGs, click "All". Toast says "Copied N URLs (M inline SVGs skipped)" — verify M > 0.
5. Click "As CSV". Paste — verify header row + comma-separated values, with `issues` joined by `;`.

- [ ] **Step 7: Commit**

`git add src/panel/tabs/Images.svelte && git commit -m "panel: wire Copy URLs and Copy CSV actions to clipboard"`

---

## Task 10: Wire Download ZIP with progress and cancel

**Files:**
- Modify: `src/panel/tabs/Images.svelte`

- [ ] **Step 1: Extend imports**

Update the existing `image-export` import to also pull `buildZip` and its types:

```ts
  import { buildUrlList, buildCsv, buildZip, type ZipProgress } from '../lib/image-export';
```

- [ ] **Step 2: Add ZIP state and handler**

Add state below the existing toast state:

```ts
  let zipProgress = $state<ZipProgress | null>(null);
  let zipController: AbortController | null = null;

  async function downloadZip(items: ImageItem[]) {
    if (zipProgress) return; // already running
    if (items.length === 0) return;
    zipController = new AbortController();
    zipProgress = { fetched: 0, total: items.length, failures: 0 };
    try {
      const tab = await chrome.tabs.get(tabId);
      let hostname = 'page';
      try { hostname = new URL(tab.url || '').hostname || 'page'; } catch {}

      const result = await buildZip(
        items,
        hostname,
        (p) => { zipProgress = p; },
        zipController.signal
      );
      const url = URL.createObjectURL(result.blob);
      const downloadId = await chrome.downloads.download({
        url,
        filename: result.filename,
        saveAs: false,
      });
      // Revoke object URL once the download finishes
      const listener = (delta: chrome.downloads.DownloadDelta) => {
        if (delta.id === downloadId && delta.state?.current === 'complete') {
          URL.revokeObjectURL(url);
          chrome.downloads.onChanged.removeListener(listener);
        }
      };
      chrome.downloads.onChanged.addListener(listener);
      const failNote = result.failed > 0 ? ` (${result.failed} failed — see _manifest.txt)` : '';
      showToast(`Downloaded ${result.succeeded} of ${items.length}${failNote}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Aborted') {
        showToast('Download cancelled');
      } else {
        showToast(`Download failed: ${msg}`);
      }
    } finally {
      zipProgress = null;
      zipController = null;
    }
  }

  function cancelZip() {
    zipController?.abort();
  }
```

- [ ] **Step 3: Add Download ZIP buttons + progress UI to the actions block**

Add a second `.action-group` inside the existing `.actions` div, immediately after the Copy URLs group:

```svelte
      <div class="action-group">
        <span class="action-label">Download ZIP:</span>
        {#if zipProgress}
          <span class="progress">Downloading {zipProgress.fetched} / {zipProgress.total}{#if zipProgress.failures > 0} · {zipProgress.failures} failed{/if}…</span>
          <button class="action-btn" onclick={cancelZip}>Cancel</button>
        {:else}
          <button class="action-btn" onclick={() => downloadZip(filteredItems)} disabled={filteredItems.length === 0}>
            All ({filteredItems.length})
          </button>
          <button class="action-btn" onclick={() => downloadZip(selectedItems)} disabled={selectedItems.length === 0}>
            Selected ({selectedItems.length})
          </button>
        {/if}
      </div>
```

- [ ] **Step 4: Add progress style**

Append to the `<style>` block:

```css
  .progress {
    font-size: 11px;
    color: var(--info-color);
  }
```

- [ ] **Step 5: Build successfully**

Run `npm run build`. Expected: build succeeds.

- [ ] **Step 6: Reload and smoke-test**

1. Reload extension, open DevTools → Site Lens → Images on a page with mixed image types (try `https://en.wikipedia.org/wiki/Cat`).
2. Click Download ZIP "All". Progress text appears: "Downloading 1 / N…", incrementing.
3. ZIP downloads to your default download folder. Open it:
   - Verify subfolders: `img/`, `picture/`, `favicon/`, `meta/` (others if their filters are enabled).
   - Verify `_manifest.txt` lists every image with its in-archive path or `FAILED:` reason.
   - Verify filename matches `site-lens-images-en.wikipedia.org-YYYYMMDD-HHMMSS.zip`.
4. Test cancel: start a Download ZIP "All", click Cancel mid-flight. Toast shows "Download cancelled", no file downloaded.
5. Test selected-only: select 3 images, click Download ZIP "Selected". Verify the resulting ZIP contains only those 3 (plus `_manifest.txt`).
6. Test on a CORS-restricted CDN page (any large news site): verify most images succeed thanks to the service worker fetch proxy. Any failures are recorded in `_manifest.txt`, not lost silently.

- [ ] **Step 7: Commit**

`git add src/panel/tabs/Images.svelte && git commit -m "panel: wire Download ZIP with progress, cancel, and chrome.downloads"`

---

## Task 11: Final end-to-end smoke test

**Files:** none (verification only)

- [ ] **Step 1: Test on a small static page**

Open a simple page (e.g., `https://example.com`). Open Site Lens → Images.
- Should show ≥ 1 image (favicon at minimum).
- All exports work: Copy URLs (all/selected), Copy CSV, Download ZIP (all/selected).

- [ ] **Step 2: Test on a CSS-heavy page**

Open a page with many CSS background images (e.g., a marketing landing page). Enable the `css-bg` filter.
- Verify CSS background images appear with thumbnails.
- Download a ZIP "All" — verify `css-bg/` folder populated.

- [ ] **Step 3: Test on an SVG-heavy page**

Open a page with inline SVG icons (e.g., GitHub). Enable the `svg` filter.
- Verify each top-level inline `<svg>` becomes a row with an SVG thumbnail.
- Copy URLs: verify "(N inline SVGs skipped)" note in toast.
- Download ZIP: verify `svg/inline-svg-*.svg` entries appear in `_manifest.txt` and are valid SVG files when extracted.

- [ ] **Step 4: Test the cancel + abort path under load**

Open a page with 30+ images. Click Download ZIP "All", then immediately click Cancel.
- Toast: "Download cancelled". No file downloaded. Buttons return to ready state.

- [ ] **Step 5: Test failure handling**

Open a page with at least one cross-origin image hosted somewhere with strict 403/CORS, or temporarily edit a page via DevTools to add `<img src="https://example.com/does-not-exist.png">`.
- Download ZIP "All". Verify the toast notes failures, the `_manifest.txt` records `FAILED: HTTP 404` (or similar) for the bad URL.

- [ ] **Step 6: Verify no regressions in other tabs**

Click through Overview, Preview, Headings, Content, Links, Schema, Technical. All should work unchanged.

- [ ] **Step 7: Done**

If everything passes, no code change needed. The work is complete.

---

## Self-review notes

- **Spec coverage:**
  - All 7 source types → Task 2 (`detectImg`, `detectPicture`, `detectCssBackgrounds`, `detectInlineSvg`, `detectVideoPosters`, `detectFavicons`, `detectMetaImages`).
  - Extract panel UI → Task 8.
  - Per-row + filter-based selection → Task 8.
  - Copy URLs (plain + CSV) → Tasks 5 & 9.
  - Download ZIP with progress, cancel, manifest, subfolder structure → Tasks 6 & 10.
  - CORS via service worker → Task 4.
  - JSZip + downloads permission → Task 0.
  - ZIP filename format `site-lens-images-<hostname>-<YYYYMMDD-HHMMSS>.zip` → Task 6.
  - Subfolders for all 7 sources → `SOURCE_FOLDER` map in Task 6.
  - Default-on filters (`img`, `picture`, `favicon`, `meta`) → Task 8 `DEFAULT_ON`.
- **Type consistency:** `ImageSource`, `ImageItem`, `FetchImageResponse`, `ZipProgress`, `ZipResult`, `UrlListResult` are defined once and used consistently. `SOURCE_FOLDER` (Task 6) and `SOURCE_LABEL` (Task 7) and `ALL_SOURCES`/`DEFAULT_ON` (Task 8) all key off the same `ImageSource` union.
- **No placeholders, no TBDs.** Every code block is complete.
