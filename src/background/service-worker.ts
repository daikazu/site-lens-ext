import type { LinkCheckResult } from '../shared/types';

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
    fetch(`${message.origin}/robots.txt`)
      .then((res) => (res.ok ? res.text() : null))
      .then((content) => sendResponse({ exists: !!content, content }))
      .catch(() => sendResponse({ exists: false, content: null }));
    return true;
  }

  if (message.type === 'FETCH_SITEMAP') {
    // First check robots.txt for a Sitemap: directive
    fetch(`${message.origin}/robots.txt`)
      .then((res) => (res.ok ? res.text() : null))
      .then((robotsContent) => {
        const sitemapUrls: string[] = [];
        if (robotsContent) {
          const lines = robotsContent.split('\n');
          for (const line of lines) {
            const match = line.match(/^\s*Sitemap:\s*(.+)/i);
            if (match) sitemapUrls.push(match[1].trim());
          }
        }

        // If robots.txt declares sitemap(s), trust that
        if (sitemapUrls.length > 0) {
          sendResponse({ exists: true, url: sitemapUrls[0], allUrls: sitemapUrls });
          return;
        }

        // Otherwise fall back to checking /sitemap.xml
        return fetch(`${message.origin}/sitemap.xml`)
          .then((res) => {
            if (res.ok) {
              sendResponse({ exists: true, url: `${message.origin}/sitemap.xml`, allUrls: [] });
            } else {
              sendResponse({ exists: false, url: null, allUrls: [] });
            }
          });
      })
      .catch(() => sendResponse({ exists: false, url: null, allUrls: [] }));
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
