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
