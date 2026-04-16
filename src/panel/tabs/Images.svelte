<script lang="ts">
  import type { ImagesData, ImageItem, ImageSource } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import ImagesTable from '../components/ImagesTable.svelte';
  import { buildUrlList, buildCsv, buildZip, type ZipProgress } from '../lib/image-export';

  interface Props {
    data: ImagesData;
    tabId: number;
  }

  let { data, tabId }: Props = $props();

  const ALL_SOURCES: ImageSource[] = ['img', 'picture', 'css-bg', 'svg', 'video-poster', 'favicon', 'meta'];
  const DEFAULT_ON: ImageSource[] = ['img', 'picture', 'favicon', 'meta'];

  let activeSources = $state<Set<ImageSource>>(new Set(DEFAULT_ON));
  let selectedSrcs = $state<Set<string>>(new Set());
  let toast = $state<string | null>(null);
  let toastTimer: number | null = null;
  function showToast(msg: string) {
    toast = msg;
    if (toastTimer != null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast = null; toastTimer = null; }, 3000);
  }

  let zipProgress = $state<ZipProgress | null>(null);
  let zipController: AbortController | null = null;
  let pendingDownloadListener: ((delta: chrome.downloads.DownloadDelta) => void) | null = null;

  $effect(() => {
    return () => {
      // Tab switched away or component destroyed — abort in-flight work and clean up listeners
      zipController?.abort();
      if (pendingDownloadListener) {
        chrome.downloads.onChanged.removeListener(pendingDownloadListener);
        pendingDownloadListener = null;
      }
      if (toastTimer != null) {
        window.clearTimeout(toastTimer);
        toastTimer = null;
      }
    };
  });

  async function downloadZip(items: ImageItem[]) {
    if (zipProgress) return; // already running
    if (items.length === 0) return;
    const controller = new AbortController();
    zipController = controller;
    zipProgress = { fetched: 0, total: items.length, failures: 0 };
    try {
      const tab = await chrome.tabs.get(tabId);
      let hostname = 'page';
      try { hostname = new URL(tab.url || '').hostname || 'page'; } catch {}

      const result = await buildZip(
        items,
        hostname,
        (p) => { zipProgress = p; },
        controller.signal
      );

      const url = URL.createObjectURL(result.blob);
      try {
        const downloadId = await chrome.downloads.download({
          url,
          filename: result.filename,
          saveAs: false,
        });
        const listener = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id !== downloadId) return;
          const state = delta.state?.current;
          if (state === 'complete' || state === 'interrupted') {
            URL.revokeObjectURL(url);
            chrome.downloads.onChanged.removeListener(listener);
            if (pendingDownloadListener === listener) pendingDownloadListener = null;
          }
        };
        pendingDownloadListener = listener;
        chrome.downloads.onChanged.addListener(listener);
      } catch (downloadErr) {
        URL.revokeObjectURL(url);
        throw downloadErr;
      }

      const failNote = result.failed > 0 ? ` (${result.failed} failed — see _manifest.txt)` : '';
      showToast(`Downloaded ${result.succeeded} of ${items.length}${failNote}`);
    } catch (err) {
      if (controller.signal.aborted) {
        showToast('Download cancelled');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Download failed: ${msg}`);
      }
    } finally {
      zipProgress = null;
      if (zipController === controller) zipController = null;
    }
  }

  function cancelZip() {
    zipController?.abort();
  }

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

  async function copyUrls(items: ImageItem[]) {
    const result = buildUrlList(items);
    const skipNote = result.skipped > 0 ? ` (${result.skipped} inline SVGs skipped)` : '';
    try {
      await navigator.clipboard.writeText(result.text);
      showToast(`Copied ${result.count} URLs${skipNote}`);
    } catch {
      showToast('Copy failed — click inside the panel first');
    }
  }

  async function copyCsv(items: ImageItem[]) {
    const csv = buildCsv(items);
    try {
      await navigator.clipboard.writeText(csv);
      showToast(`Copied ${items.length} rows as CSV`);
    } catch {
      showToast('Copy failed — click inside the panel first');
    }
  }

  function scrollToImage(item: ImageItem) {
    const srcJson = JSON.stringify(item.src).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
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
      {#if selectedItems.length > 0} · {selectedItems.length} selected{/if}
    </div>
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
    </div>
    {#if toast}
      <div class="toast">{toast}</div>
    {/if}
  </section>

  <section class="section table-section">
    <h3 class="section-title">Page Images</h3>
    <ImagesTable
      items={filteredItems}
      selectedSrcs={selectedSrcs}
      onToggleRow={toggleRow}
      onToggleAll={toggleAll}
      onScrollTo={scrollToImage}
    />
  </section>
</div>

<style>
  .images-tab { display: flex; flex-direction: column; gap: 4px; height: 100%; min-height: 0; }
  .table-section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .table-section .section-title { flex-shrink: 0; }
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
  .section { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
  .section-title { color: var(--text-secondary); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .progress {
    font-size: 11px;
    color: var(--info-color);
  }
</style>
