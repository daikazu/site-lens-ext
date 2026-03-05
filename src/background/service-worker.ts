chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FONT_INSPECTOR_DISABLED' && sender.tab?.id) {
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
    fetch(`${message.origin}/sitemap.xml`)
      .then((res) => (res.ok ? res.text() : null))
      .then((content) => sendResponse({ exists: !!content, content }))
      .catch(() => sendResponse({ exists: false, content: null }));
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

  return false;
});
