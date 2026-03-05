<script lang="ts">
  import type { LinksData, HighlightMode } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import SortableTable from '../components/SortableTable.svelte';

  interface Props {
    data: LinksData;
    tabId: number;
  }

  let { data, tabId }: Props = $props();

  let activeSection = $state<'internal' | 'external' | 'bad'>('internal');
  let highlightMode = $state<HighlightMode>('none');
  let deepScanning = $state(false);
  let deepScanResults = $state<Record<string, { status: number; redirectUrl?: string }>>({});

  const linkColumns = [
    { key: 'anchorText', label: 'Anchor Text', width: '30%' },
    { key: 'href', label: 'URL', width: '45%' },
    { key: 'rel', label: 'Rel', width: '10%' },
    { key: 'issues', label: 'Issues', width: '15%', render: (v: unknown) => (v as string[]).join(', ') },
  ];

  function toggleHighlight(mode: HighlightMode) {
    highlightMode = highlightMode === mode ? 'none' : mode;
    chrome.tabs.sendMessage(tabId, {
      type: highlightMode === 'none' ? 'CLEAR_HIGHLIGHTS' : 'HIGHLIGHT_LINKS',
      mode: highlightMode,
    });
  }

  async function deepScan() {
    deepScanning = true;
    const allUrls = [...data.internal, ...data.external].map((l) => l.href);
    const response = await chrome.runtime.sendMessage({
      type: 'DEEP_SCAN_LINKS',
      tabId,
      urls: allUrls,
    });
    deepScanResults = response || {};
    deepScanning = false;
  }

  let currentRows = $derived(data[activeSection]);

  function scrollToLink(row: Record<string, unknown>) {
    const href = String(row.href || '');
    const anchorText = String(row.anchorText || '');
    const hrefJson = JSON.stringify(href);
    const textJson = JSON.stringify(anchorText);
    // chrome.devtools.inspectedWindow.eval is the official DevTools API
    chrome.devtools.inspectedWindow.eval(
      `(function() {
        var STYLE_ID = 'seo-ext-scroll-highlight-style';
        if (!document.getElementById(STYLE_ID)) {
          var s = document.createElement('style');
          s.id = STYLE_ID;
          s.textContent = '@keyframes seo-ext-pulse { 0%, 100% { outline-color: #4fc1ff; background-color: rgba(79, 193, 255, 0.25); } 50% { outline-color: #ff6b6b; background-color: rgba(255, 107, 107, 0.25); } }' +
            '.seo-ext-scrolled { outline: 3px solid #4fc1ff !important; outline-offset: 3px !important; background-color: rgba(79, 193, 255, 0.25) !important; animation: seo-ext-pulse 1s ease-in-out 3 !important; position: relative !important; z-index: 999999 !important; box-shadow: 0 0 12px rgba(79, 193, 255, 0.5) !important; }';
          document.head.appendChild(s);
        }
        var prev = document.querySelectorAll('.seo-ext-scrolled');
        prev.forEach(function(p) { p.classList.remove('seo-ext-scrolled'); });
        var target = ${hrefJson};
        var text = ${textJson};
        var rawHref = target;
        var links = document.querySelectorAll('a[href]');
        var found = null;
        var hrefOnlyMatch = null;
        for (var i = 0; i < links.length; i++) {
          var el = links[i];
          var attr = el.getAttribute('href') || '';
          var resolved = '';
          try { resolved = new URL(attr, window.location.href).href; } catch(e) { resolved = attr; }
          var elText = (el.textContent || '').replace(/\\s+/g, ' ').trim();
          var matchText = text.replace(/\\s+/g, ' ').trim();
          var hrefMatch = resolved === target || attr === target;
          if (hrefMatch && elText === matchText) { found = el; break; }
          if (hrefMatch && !hrefOnlyMatch) { hrefOnlyMatch = el; }
        }
        var hit = found || hrefOnlyMatch;
        if (hit) {
          hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
          hit.classList.add('seo-ext-scrolled');
          setTimeout(function() { hit.classList.remove('seo-ext-scrolled'); }, 4000);
        }
      })()`
    );
  }
</script>

<div class="links-tab">
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

  <section class="toolbar">
    <div class="section-tabs">
      <button class:active={activeSection === 'internal'} onclick={() => activeSection = 'internal'}>
        Internal ({data.internal.length})
      </button>
      <button class:active={activeSection === 'external'} onclick={() => activeSection = 'external'}>
        External ({data.external.length})
      </button>
      <button class:active={activeSection === 'bad'} onclick={() => activeSection = 'bad'}>
        Bad ({data.bad.length})
      </button>
    </div>

    <div class="highlight-controls">
      <span class="label">Highlight:</span>
      <button class="hl-btn hl-internal" class:active={highlightMode === 'internal'} onclick={() => toggleHighlight('internal')}>Internal</button>
      <button class="hl-btn hl-external" class:active={highlightMode === 'external'} onclick={() => toggleHighlight('external')}>External</button>
      <button class="hl-btn hl-nofollow" class:active={highlightMode === 'nofollow'} onclick={() => toggleHighlight('nofollow')}>Nofollow</button>
      <button class="hl-btn hl-all" class:active={highlightMode === 'all'} onclick={() => toggleHighlight('all')}>All</button>
    </div>

    <button class="deep-scan-btn" onclick={deepScan} disabled={deepScanning}>
      {deepScanning ? 'Scanning...' : 'Deep Scan'}
    </button>
  </section>

  <section class="section">
    <SortableTable columns={linkColumns} rows={currentRows} maxHeight="500px" onRowClick={scrollToLink} />
  </section>
</div>

<style>
  .links-tab { display: flex; flex-direction: column; gap: 4px; }
  .warnings {
    padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
    border-bottom: 1px solid var(--border-color);
  }
  .warning-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .toolbar {
    display: flex; align-items: center; gap: 12px; padding: 8px 12px;
    border-bottom: 1px solid var(--border-color); flex-wrap: wrap;
  }
  .section-tabs { display: flex; gap: 4px; }
  .section-tabs button {
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    color: var(--text-secondary); font-size: 11px; padding: 3px 10px;
    border-radius: 3px; cursor: pointer;
  }
  .section-tabs button:hover { color: var(--text-primary); }
  .section-tabs button.active {
    background: var(--bg-active); color: var(--accent-color); border-color: var(--accent-color);
  }
  .highlight-controls { display: flex; align-items: center; gap: 4px; margin-left: auto; }
  .label { color: var(--text-muted); font-size: 11px; }
  .hl-btn {
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    color: var(--text-secondary); font-size: 10px; padding: 2px 6px;
    border-radius: 3px; cursor: pointer;
  }
  .hl-btn.active { font-weight: 600; }
  .hl-internal.active { color: #4ec9b0; border-color: #4ec9b0; }
  .hl-external.active { color: #f14c4c; border-color: #f14c4c; }
  .hl-nofollow.active { color: #cca700; border-color: #cca700; }
  .hl-all.active { color: var(--accent-color); border-color: var(--accent-color); }
  .deep-scan-btn {
    background: var(--bg-active); border: 1px solid var(--border-color);
    color: var(--text-primary); font-size: 11px; padding: 3px 10px;
    border-radius: 3px; cursor: pointer;
  }
  .deep-scan-btn:hover { background: var(--bg-hover); }
  .deep-scan-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .section { padding: 0 12px 12px; }
</style>
