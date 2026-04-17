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
    chrome.tabs.sendMessage(message.tabId, { type: 'ANALYZE_PAGE' }, (response) => {
      sendResponse(response || { error: 'No response from content script' });
    });
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
    const results: Record<string, { status: number; redirectUrl?: string }> = {};
    Promise.all(
      message.urls.map((url: string) =>
        fetch(url, { method: 'HEAD', redirect: 'follow' })
          .then((res) => {
            results[url] = { status: res.status, redirectUrl: res.url !== url ? res.url : undefined };
          })
          .catch(() => {
            results[url] = { status: 0 };
          })
      )
    ).then(() => sendResponse(results));
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

  return false;
});
