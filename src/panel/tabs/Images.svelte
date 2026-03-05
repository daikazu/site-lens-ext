<script lang="ts">
  import type { ImagesData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import SortableTable from '../components/SortableTable.svelte';

  interface Props {
    data: ImagesData;
    tabId: number;
  }

  let { data, tabId }: Props = $props();

  const imageColumns = [
    { key: 'src', label: 'Source', width: '40%' },
    { key: 'alt', label: 'Alt Text', width: '25%' },
    { key: 'width', label: 'Width', width: '8%' },
    { key: 'height', label: 'Height', width: '8%' },
    { key: 'loading', label: 'Loading', width: '9%' },
    { key: 'issues', label: 'Issues', width: '10%', render: (v: unknown) => (v as string[]).join(', ') },
  ];

  function scrollToImage(row: Record<string, unknown>) {
    const src = String(row.src || '');
    const srcJson = JSON.stringify(src);
    // chrome.devtools.inspectedWindow.eval is the official Chrome DevTools API
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
        var imgs = document.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
          var el = imgs[i];
          var elSrc = el.getAttribute('src') || el.getAttribute('data-src') || '';
          try { elSrc = new URL(elSrc, window.location.href).href; } catch(e) {}
          var resolvedTarget = target;
          try { resolvedTarget = new URL(target, window.location.href).href; } catch(e) {}
          if (elSrc === resolvedTarget || el.getAttribute('src') === target || el.getAttribute('data-src') === target) {
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

  <section class="section">
    <h3 class="section-title">OG Image</h3>
    {#if data.og.url}
      <div class="image-preview">
        <img src={data.og.url} alt={data.og.alt || 'OG Image'} class="preview-img" />
        <div class="image-meta">
          <div><span class="meta-label">URL:</span> <span class="mono">{data.og.url}</span></div>
          {#if data.og.width}<div><span class="meta-label">Size:</span> {data.og.width} x {data.og.height}</div>{/if}
          {#if data.og.type}<div><span class="meta-label">Type:</span> {data.og.type}</div>{/if}
          {#if data.og.alt}<div><span class="meta-label">Alt:</span> {data.og.alt}</div>{/if}
        </div>
      </div>
    {:else}
      <p class="not-set">Not set</p>
    {/if}
  </section>

  <section class="section">
    <h3 class="section-title">Twitter Card Image</h3>
    {#if data.twitter.image}
      <div class="image-preview">
        <img src={data.twitter.image} alt={data.twitter.imageAlt || 'Twitter Image'} class="preview-img" />
        <div class="image-meta">
          <div><span class="meta-label">Card:</span> {data.twitter.card || '(not set)'}</div>
          <div><span class="meta-label">URL:</span> <span class="mono">{data.twitter.image}</span></div>
          {#if data.twitter.imageAlt}<div><span class="meta-label">Alt:</span> {data.twitter.imageAlt}</div>{/if}
        </div>
      </div>
    {:else}
      <p class="not-set">Not set</p>
    {/if}
  </section>

  <section class="section">
    <h3 class="section-title">Page Images ({data.items.length})</h3>
    <SortableTable columns={imageColumns} rows={data.items} maxHeight="400px" onRowClick={scrollToImage} />
  </section>
</div>

<style>
  .images-tab { display: flex; flex-direction: column; gap: 4px; }
  .warnings { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border-color); }
  .warning-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .section { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
  .section-title { color: var(--text-secondary); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .image-preview { display: flex; gap: 12px; align-items: flex-start; }
  .preview-img { max-width: 200px; max-height: 120px; border: 1px solid var(--border-color); border-radius: 4px; object-fit: contain; background: var(--bg-secondary); }
  .image-meta { font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
  .meta-label { color: var(--text-muted); }
  .mono { font-family: var(--font-mono); }
  .not-set { color: var(--text-muted); font-size: 12px; }
</style>
