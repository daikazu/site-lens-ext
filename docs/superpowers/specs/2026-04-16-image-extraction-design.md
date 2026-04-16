# Image Extraction Feature — Design

**Date:** 2026-04-16
**Project:** Site Lens (Chrome extension, MV3)
**Status:** Approved design, ready for implementation plan

## Summary

Add bulk image extraction to the existing **Images** tab in the DevTools panel. Users can:

- See thumbnails of every image on the page (not just `<img>` tags).
- Filter by source type (`<img>`, `<picture>`/srcset, CSS `background-image`, inline SVG, `<video poster>`, favicon, og/twitter meta).
- Select individual images via per-row checkboxes.
- Export image **URLs** (plain list or CSV with metadata) to clipboard.
- Download all (or just selected) images as a single **ZIP** archive.

This extends the existing Images tab; it is not a new tab.

## Goals

- Capture meaningfully more "images" than the current `<img>`-only scan.
- Make extraction feel native to the existing tab — same table, same row-click behavior.
- Survive cross-origin images by routing fetches through the service worker.
- Never silently lose an image: failures appear in an in-archive manifest.

## Non-goals

- No image editing or transformation (crop, resize, format conversion).
- No persistent storage of extracted images across sessions.
- No detection of CSS `mask-image`, `border-image`, or images referenced by JS-only state.

## Detection scope (`image-detector.ts`)

A new content-script module enumerates all images on the page, returning a flat array of `ImageItem` records. Each record has a `source` field tagging which detector produced it.

| `source` value | Detector |
|---|---|
| `img` | `document.querySelectorAll('img')` |
| `picture` | `<source srcset>` inside `<picture>` — every URL in srcset becomes its own entry, paired with its descriptor |
| `css-bg` | Walk all elements; read `getComputedStyle(el).backgroundImage`; parse `url(...)` values (handles multiple backgrounds and gradients-with-urls) |
| `svg` | Inline `<svg>` elements — serialized via `XMLSerializer` to a `data:image/svg+xml` URI |
| `video-poster` | `<video poster>` |
| `favicon` | `<link rel="icon">`, `<link rel="shortcut icon">`, `<link rel="apple-touch-icon">` |
| `meta` | `meta[property="og:image"]`, `meta[name="twitter:image"]` |

**URL resolution:** every `src` is resolved to absolute via `new URL(raw, location.href)`. Inline SVGs use a `data:` URI in the `src` field (this is also what powers their thumbnails and ZIP entries).

**De-duplication rules:**
- Same `src` from the same `source` → collapse to one entry.
- Same `src` across different sources → keep both (semantic distinction matters: an `<img>` that is also og:image is two roles).

### Data model (`shared/types.ts`)

Extend the existing `ImageItem` shape:

```ts
export type ImageSource = 'img' | 'picture' | 'css-bg' | 'svg' | 'video-poster' | 'favicon' | 'meta';

export interface ImageItem {
  src: string;                  // absolute URL or data: URI
  source: ImageSource;          // NEW
  alt: string | null;
  width: number | null;
  height: number | null;
  loading: string | null;
  issues: string[];
}
```

The existing `ImagesData.items: ImageItem[]` consumer (the Images tab) gets the richer entries automatically.

## UI changes (`Images.svelte`)

Layout from top to bottom:

### 1. Extract panel (new, collapsible)

```
┌─ Extract ────────────────────────────────────────────┐
│  Sources:  [✓] <img>   [✓] <picture>/srcset          │
│            [ ] CSS bg  [ ] inline SVG                │
│            [ ] video poster  [✓] favicon  [✓] meta   │
│                                                      │
│  Showing 47 of 62 images · 12 selected               │
│                                                      │
│  [ Copy URLs ▾ ]  [ Download ZIP ▾ ]                 │
│     ├ All (47)       ├ All (47)                      │
│     ├ Selected (12)  └ Selected (12)                 │
│     └ as CSV…                                        │
└──────────────────────────────────────────────────────┘
```

**Default-on source filters:** `img`, `picture`, `favicon`, `meta`. Off by default: `css-bg`, `svg`, `video-poster` (these tend to be noisy on real pages — opt-in).

**Counts** in the status line and the buttons reflect the current filter and selection.

### 2. Warnings section

Unchanged from current implementation.

### 3. Images table (modified `SortableTable`)

New columns prepended:

| Column | Width | Purpose |
|---|---|---|
| `select` | 24px | Checkbox per row; header has "select all matching filters" |
| `thumbnail` | 64px | ~48×48 preview image, dark bg, `object-fit: contain` |
| `source` | 80px | Colored badge for the `source` value |

Existing columns (src, alt, width, height, loading, issues) follow.

**Interaction:**
- Row click: scrolls page to image (existing behavior, unchanged).
- Checkbox click: toggles selection. Does not trigger row click.
- Thumbnail click: same as row click (scroll-to-image).

**Thumbnail rendering:**
- `<img>`, `<picture>`, `css-bg`, `meta`, `favicon`, `video-poster`: `<img src={resolvedUrl} loading="lazy">`.
- `svg`: `<img src={dataUri}>` from the serialized markup.
- On `error` event: render a small "broken image" placeholder (CSS-only, no network).

## Export actions

### Copy URLs (plain text)

- Join URLs with `\n`.
- Inline SVG entries are skipped (no URL to copy); skipped count surfaces in the toast: `"Copied 47 URLs (3 inline SVGs skipped)"`.
- Write via `navigator.clipboard.writeText()`.

### Copy CSV

- Header row: `url,source,alt,width,height,loading,issues`
- RFC 4180 escaping: fields containing commas, quotes, or newlines are wrapped in `"..."`; internal `"` is doubled to `""`.
- `issues` is joined with `; ` before escaping.
- Inline SVG rows: `url` column contains the `data:` URI value (not skipped here — CSV consumers can decide).

### Download ZIP

**ZIP filename:** `site-lens-images-<hostname>-<YYYYMMDD-HHMMSS>.zip`
Example: `site-lens-images-example.com-20260416-143022.zip`

**Internal structure:**

```
site-lens-images-example.com-20260416-143022.zip
├─ _manifest.txt
├─ img/
│   ├─ hero.jpg
│   ├─ logo.png
│   └─ ...
├─ picture/
├─ css-bg/
├─ svg/
│   └─ inline-svg-1.svg
├─ favicon/
└─ meta/
```

**File naming inside the ZIP:**
- Base name = last segment of the URL pathname (e.g., `/assets/hero.jpg` → `hero.jpg`).
- If the URL has no extension, sniff from the response `Content-Type` header (`image/jpeg` → `.jpg`, `image/webp` → `.webp`, etc.).
- Inline SVGs: `inline-svg-<index>.svg` where `<index>` is the 1-based position among SVGs.
- Collisions within a folder: append `-2`, `-3`, … (e.g., `hero.jpg`, `hero-2.jpg`).

**Manifest (`_manifest.txt`):** plain text, one row per attempted image:

```
[img]      img/hero.jpg               https://example.com/assets/hero.jpg
[img]      img/logo.png               https://example.com/logo.png
[css-bg]   FAILED: HTTP 403           https://cdn.other.com/blocked.jpg
[svg]      svg/inline-svg-1.svg       (inline)
```

**Progress UI:**
- The "Download ZIP" button transforms during build into `Downloading 12 / 47…  [Cancel]`.
- Cancel aborts in-flight fetches via `AbortController` and discards the in-progress ZIP.
- After completion: toast `"Downloaded 45 of 47 (2 failed — see _manifest.txt)"`.

## Technical architecture

### File structure

```
src/
  content/
    analyzer.ts            # MODIFY: analyzeImages() delegates to image-detector
    image-detector.ts      # NEW: pure detection of all 7 image source types
  background/
    service-worker.ts      # MODIFY: add FETCH_IMAGE message handler
  panel/
    tabs/
      Images.svelte        # MODIFY: Extract panel, thumbnails, checkboxes, export wiring
    lib/
      image-export.ts      # NEW: clipboard text/CSV builders + ZIP orchestration
  shared/
    types.ts               # MODIFY: add ImageSource, extend ImageItem
public/
  manifest.json            # MODIFY: add "downloads" permission
```

### Module responsibilities

- **`image-detector.ts`** — pure function `detectImages(): ImageItem[]`. No side effects. Exports one function per source type internally for clarity and testability.
- **`analyzer.ts`** — `analyzeImages()` calls `detectImages()`, then attaches the existing SEO `issues` and `warnings` logic.
- **`service-worker.ts`** — handles `FETCH_IMAGE` messages. Returns `{ ok: boolean, bytes?: ArrayBuffer, contentType?: string, status?: number, error?: string }`.
- **`image-export.ts`** — three exported functions:
  - `buildUrlList(items: ImageItem[]): { text: string; skipped: number }`
  - `buildCsv(items: ImageItem[]): string`
  - `buildZip(items: ImageItem[], onProgress, signal): Promise<Blob>`
- **`Images.svelte`** — pure UI. Holds `selectedSources: Set<ImageSource>`, `selectedSrcs: Set<string>`. Calls into `image-export.ts`.

### CORS / fetch strategy

`fetch()` from the DevTools panel is subject to the panel's origin and triggers CORS for cross-origin images. The service worker, in contrast, runs in extension context and has `host_permissions: ["<all_urls>"]` already declared in `manifest.json`. Its `fetch()` calls bypass page CORS entirely.

Flow per image:

1. Panel sends `chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url })`.
2. Service worker calls `fetch(url)`, then `response.arrayBuffer()`.
3. Service worker returns `{ ok: true, bytes: ArrayBuffer, contentType: string }`. (`ArrayBuffer` is structured-cloneable across `chrome.runtime` in MV3.)
4. Panel receives bytes and adds them to the JSZip instance.

**Inline SVGs** skip this round-trip — they're already serialized in `ImageItem.src` as a `data:` URI.

### ZIP library

Add `jszip` (~95KB minified) to `devDependencies`. No native deps. Bundled into the panel chunk by Vite — no separate worker file needed.

```
npm install --save-dev jszip
```

### Download mechanic

In the panel:

```ts
const blob = await zip.generateAsync({ type: 'blob' });
const url = URL.createObjectURL(blob);
chrome.downloads.download({ url, filename, saveAs: false });
// revokeObjectURL on download complete via onChanged listener
```

This requires adding `"downloads"` to `manifest.json` `permissions`.

### Concurrency

Fetch images with a concurrency cap of **6** in flight. Use a small batched runner (no need for a library):

```ts
async function withConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, signal?: AbortSignal): Promise<R[]> { ... }
```

### Cancellation

The panel creates an `AbortController` per ZIP build. Cancel button calls `controller.abort()`, which:
- Aborts any pending `chrome.runtime.sendMessage` resolutions (via `signal.addEventListener('abort', ...)` rejecting them).
- Stops the loop from queuing new fetches.
- Discards the partially-built JSZip instance.

### Manifest changes (`public/manifest.json`)

```diff
- "permissions": ["activeTab", "scripting"],
+ "permissions": ["activeTab", "scripting", "downloads"],
```

Host permissions (`<all_urls>`) already cover cross-origin fetches in the service worker. No change needed there.

### Failure handling

Per-image failures (CORS even with proxy, 404, network errors, abort) are captured in `_manifest.txt` with the reason. ZIP completes with whatever succeeded. The post-completion toast surfaces the failure count.

## Open questions / explicit decisions

- **Row click vs. checkbox:** decided — checkbox-only toggles selection; row/thumbnail click stays as scroll-to-image.
- **CSV vs plain text:** decided — both, via dropdown.
- **Subset selection:** decided — both filter-based AND per-row, with separate "All" and "Selected" buttons.
- **Default source filters:** decided — `img`, `picture`, `favicon`, `meta` on; `css-bg`, `svg`, `video-poster` off.
- **CORS:** decided — service worker fetch proxy.
- **ZIP library:** decided — JSZip.

## Implementation sequencing (high-level — detailed plan to follow)

1. Type and detector: extend `ImageItem`, write `image-detector.ts`, swap `analyzeImages()` to use it.
2. Service worker `FETCH_IMAGE` handler.
3. `image-export.ts` (URL list + CSV first; ZIP last since it depends on #2).
4. Manifest permission update.
5. `Images.svelte` UI: source filter checkboxes → table thumbnail/checkbox columns → export buttons → progress/cancel state.
6. End-to-end smoke test on real pages (small site, large site, CORS-restricted CDN).
