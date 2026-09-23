import type { LinkCheckResult, PageSourceResult, RobotsTxtResult, SitemapCheck, SitemapsResult } from '../shared/types';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FONT_INSPECTOR_DISABLED' && sender.tab?.id) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: '' });
    return false;
  }

  if (message.type === 'ELEMENT_COPIER_DISABLED' && sender.tab?.id) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: '' });
    return false;
  }

  if (message.type === 'ANALYZE_PAGE') {
    analyzeTab(message.tabId).then(sendResponse);
    return true;
  }

  if (message.type === 'FETCH_ROBOTS') {
    fetchRobotsTxt(message.origin).then(sendResponse);
    return true;
  }

  if (message.type === 'CHECK_SITEMAPS') {
    checkSitemaps(message.urls, message.pageUrls).then(sendResponse);
    return true;
  }

  if (message.type === 'DEEP_SCAN_LINKS') {
    checkLinks(message.urls).then(sendResponse);
    return true;
  }

  if (message.type === 'FETCH_IMAGE') {
    fetch(message.url)
      .then(async (res) => {
        if (!res.ok) {
          sendResponse({ ok: false, error: `HTTP ${res.status}`, status: res.status });
          return;
        }
        const contentType = res.headers.get('content-type') || 'application/octet-stream';
        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(
            null,
            Array.from(bytes.subarray(i, i + CHUNK))
          );
        }
        const bytesB64 = btoa(binary);
        sendResponse({ ok: true, bytesB64, contentType, status: res.status });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error: msg });
      });
    return true;
  }

  if (message.type === 'FETCH_PAGE_SOURCE') {
    fetchPageSource(message.url).then(sendResponse);
    return true;
  }

  if (message.type === 'OPEN_RICH_RESULTS_TEST') {
    openRichResultsTest(message.code)
      .then((filled) => sendResponse({ ok: true, filled }))
      .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  return false;
});

const RICH_RESULTS_URL = 'https://search.google.com/test/rich-results';

async function openRichResultsTest(code: string): Promise<boolean> {
  const tab = await chrome.tabs.create({ url: RICH_RESULTS_URL });
  if (!tab.id) return false;
  await waitForTabLoad(tab.id);

  // The editor is CodeMirror 5; its instance lives on the page's own JS objects, so run in the MAIN world.
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    args: [code],
    func: async (code: string) => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      type CMElement = HTMLElement & { CodeMirror?: { setValue(v: string): void; focus(): void } };

      for (let i = 0; i < 50; i++) {
        const codeTab = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
          // Label is prefixed with an icon-font glyph (e.g. "\ue86fcode"), so match the suffix.
          .find((t) => t.textContent?.trim().toLowerCase().endsWith('code'));
        if (codeTab && codeTab.getAttribute('aria-selected') !== 'true') codeTab.click();

        const editor = Array.from(document.querySelectorAll<CMElement>('.CodeMirror'))
          .find((el) => el.offsetParent !== null && el.CodeMirror);
        if (editor?.CodeMirror) {
          editor.CodeMirror.setValue(code);
          editor.CodeMirror.focus();
          return true;
        }
        await sleep(200);
      }
      return false;
    },
  });
  return result?.result === true;
}

function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const listener = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Tabs opened before the extension was (re)loaded have no content script, so inject it on demand.
async function analyzeTab(tabId: number): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'ANALYZE_PAGE' });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(tabId, { type: 'ANALYZE_PAGE' });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { error: `Could not analyze this page (${reason}). Try reloading the page.` };
    }
  }
}

const LINK_CHECK_CONCURRENCY = 6;
const LINK_CHECK_TIMEOUT_MS = 10_000;

async function checkLinks(urls: string[]): Promise<Record<string, LinkCheckResult>> {
  const queue = [...new Set(urls)].filter((u) => /^https?:/i.test(u));
  const results: Record<string, LinkCheckResult> = {};
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      results[url] = await checkLink(url);
    }
  };
  await Promise.all(Array.from({ length: LINK_CHECK_CONCURRENCY }, worker));
  return results;
}

async function checkLink(url: string): Promise<LinkCheckResult> {
  const request = async (method: 'HEAD' | 'GET') => {
    const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS) });
    if (method === 'GET') res.body?.cancel().catch(() => {});
    return res;
  };
  try {
    let res = await request('HEAD');
    // Some servers reject or mishandle HEAD; confirm with GET before calling the link broken.
    if (res.status >= 400) res = await request('GET');
    return {
      status: res.status,
      redirected: res.redirected,
      finalUrl: res.redirected ? res.url : undefined,
    };
  } catch (err) {
    return { status: 0, redirected: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const MAX_HTML_CHARS = 5_000_000;

// The page as the server sends it: headers page scripts can't see, and the HTML before JavaScript runs.
async function fetchPageSource(url: string): Promise<PageSourceResult> {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; });
    const isHtml = (headers['content-type'] ?? '').includes('html');
    let html: string | null = null;
    if (isHtml) html = await res.text();
    else res.body?.cancel().catch(() => {});
    const truncated = !!html && html.length > MAX_HTML_CHARS;
    return {
      ok: true,
      status: res.status,
      finalUrl: res.url,
      redirected: res.redirected,
      headers,
      html: truncated ? html!.slice(0, MAX_HTML_CHARS) : html,
      truncated,
    };
  } catch (err) {
    return { ok: false, status: null, finalUrl: null, redirected: false, headers: {}, html: null, truncated: false, error: errorMessage(err) };
  }
}

// Servers often answer unknown paths with an HTML page (SPA fallbacks, soft 404s); that isn't a robots.txt.
const looksLikeHtml = (text: string) => /^\s*<(!doctype|html|head|body)\b/i.test(text);

async function fetchRobotsTxt(origin: string): Promise<RobotsTxtResult> {
  const url = `${origin}/robots.txt`;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS) });
    const contentType = res.headers.get('content-type');
    const text = await res.text();
    const isText = res.ok && !(contentType ?? '').includes('html') && !looksLikeHtml(text);
    return { url, status: res.status, contentType, content: isText ? text : null };
  } catch (err) {
    return { url, status: null, contentType: null, content: null, error: errorMessage(err) };
  }
}

const SITEMAP_CHILD_LIMIT = 25;
const SITEMAP_CONCURRENCY = 4;

async function readSitemap(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return { status: res.status, text: '' };
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // .xml.gz files are served as application/gzip rather than with Content-Encoding.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return { status: res.status, text: await new Response(stream).text() };
  }
  return { status: res.status, text: new TextDecoder().decode(bytes) };
}

const decodeXml = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

function sitemapLocs(xml: string): string[] {
  const locs: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?\s*<\/loc>/gi)) locs.push(decodeXml(m[1]));
  return locs;
}

// Compare URLs ignoring the fragment and a trailing slash.
const urlKey = (u: string) => {
  try {
    const url = new URL(u);
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return u;
  }
};

async function checkOneSitemap(url: string, pageKeys: Set<string>): Promise<SitemapCheck & { childUrls: string[] }> {
  try {
    const { status, text } = await readSitemap(url);
    if (!text) return { url, status, kind: 'unreachable', urlCount: 0, containsPage: false, childUrls: [] };
    const locs = sitemapLocs(text);
    if (/<sitemapindex[\s>]/i.test(text)) return { url, status, kind: 'index', urlCount: locs.length, containsPage: false, childUrls: locs };
    if (/<urlset[\s>]/i.test(text)) {
      return { url, status, kind: 'urlset', urlCount: locs.length, containsPage: locs.some((l) => pageKeys.has(urlKey(l))), childUrls: [] };
    }
    return { url, status, kind: 'invalid', urlCount: 0, containsPage: false, childUrls: [] };
  } catch (err) {
    return { url, status: null, kind: 'unreachable', urlCount: 0, containsPage: false, childUrls: [], error: errorMessage(err) };
  }
}

async function checkSitemaps(urls: string[], pageUrls: string[]): Promise<SitemapsResult> {
  const pageKeys = new Set(pageUrls.map(urlKey));
  const sitemaps: SitemapCheck[] = [];
  let found = false;
  let incomplete = false;
  let budget = SITEMAP_CHILD_LIMIT;
  let limitReached = false;

  for (const url of [...new Set(urls)]) {
    const { childUrls, ...top } = await checkOneSitemap(url, pageKeys);
    if (top.kind === 'unreachable' || top.kind === 'invalid') incomplete = true;
    if (top.containsPage) found = true;

    if (top.kind === 'index') {
      top.children = [];
      const queue = childUrls.slice();
      const worker = async () => {
        for (let child = queue.shift(); child && !found; child = queue.shift()) {
          if (budget <= 0) { limitReached = true; return; }
          budget--;
          const { childUrls: _nested, ...result } = await checkOneSitemap(child, pageKeys);
          top.children!.push(result);
          if (result.containsPage) found = true;
          if (result.kind !== 'urlset') incomplete = true;
        }
      };
      await Promise.all(Array.from({ length: SITEMAP_CONCURRENCY }, worker));
      if (queue.length > 0 && !found) limitReached = true;
      top.containsPage = top.children.some((c) => c.containsPage);
    }
    sitemaps.push(top);
  }

  return {
    sitemaps,
    containsPage: found ? true : incomplete || limitReached ? null : false,
    checkedLimitReached: limitReached,
  };
}
