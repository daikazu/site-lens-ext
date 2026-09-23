import type { PageSourceResult, RobotsTxtResult, SitemapCheck, SitemapsResult } from '../../shared/types';
import { parseRobots } from './robots';

// Network checks shared by the Overview and Technical tabs. Each is requested once per scan
// (keyed by the analysis timestamp), so switching tabs doesn't refetch and Re-scan does.

const cache = new Map<string, Promise<unknown>>();

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  let pending = cache.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = load();
    cache.set(key, pending);
  }
  return pending;
}

export function getPageSource(url: string, scan: number): Promise<PageSourceResult> {
  return once(`source|${scan}|${url}`, () =>
    chrome.runtime.sendMessage({ type: 'FETCH_PAGE_SOURCE', url }).catch(
      (err: unknown): PageSourceResult => ({
        ok: false, status: null, finalUrl: null, redirected: false, headers: {}, html: null, truncated: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    ),
  );
}

export function getRobots(origin: string, scan: number): Promise<RobotsTxtResult> {
  return once(`robots|${scan}|${origin}`, () =>
    chrome.runtime.sendMessage({ type: 'FETCH_ROBOTS', origin }).catch(
      (err: unknown): RobotsTxtResult => ({
        url: `${origin}/robots.txt`, status: null, contentType: null, content: null,
        error: err instanceof Error ? err.message : String(err),
      }),
    ),
  );
}

// Sitemaps declared in robots.txt, or the conventional locations when none are declared.
export async function getSitemaps(origin: string, pageUrls: string[], scan: number): Promise<{ declared: boolean; result: SitemapsResult }> {
  const robots = await getRobots(origin, scan);
  const declared = robots.content ? parseRobots(robots.content).sitemaps : [];
  const urls = declared.length ? declared : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const result = await once(`sitemaps|${scan}|${urls.join(' ')}|${pageUrls.join(' ')}`, () =>
    chrome.runtime.sendMessage({ type: 'CHECK_SITEMAPS', urls, pageUrls }) as Promise<SitemapsResult>,
  );
  if (!declared.length) {
    // Undeclared fallbacks that are missing (or an HTML page) are expected, not failures.
    const found = result.sitemaps.filter((s) => s.kind !== 'unreachable' && s.kind !== 'invalid');
    const fullyChecked = (s: SitemapCheck) =>
      s.kind === 'urlset' || (s.kind === 'index' && !!s.children?.every((c) => c.kind === 'urlset'));
    const containsPage = found.some((s) => s.containsPage)
      ? true
      : found.length && !result.checkedLimitReached && found.every(fullyChecked) ? false : null;
    return { declared: false, result: { ...result, sitemaps: found, containsPage } };
  }
  return { declared: true, result };
}
