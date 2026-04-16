import JSZip from 'jszip';
import type { ImageItem, ImageSource, FetchImageResponse } from '../../shared/types';

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
    try {
      const binary = atob(payload);
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
      return { bytes: arr, contentType };
    } catch {
      return null;
    }
  }
  // utf8 / url-encoded data URI (e.g. inline SVG)
  try {
    const text = decodeURIComponent(payload);
    return { bytes: new TextEncoder().encode(text), contentType };
  } catch {
    return null;
  }
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
