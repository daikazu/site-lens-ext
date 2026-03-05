<script lang="ts">
  import type { TechnicalData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import CodeBlock from '../components/CodeBlock.svelte';

  interface Props {
    data: TechnicalData;
    tabId: number;
  }

  let { data, tabId }: Props = $props();

  let robotsTxt = $state(data.robotsTxt);
  let sitemap = $state(data.sitemap);
  let fetchingRobots = $state(true);
  let fetchingSitemap = $state(true);

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function lcpBadge(ms: number | null): { type: 'success' | 'warning' | 'error' | 'info'; label: string } {
    if (ms === null) return { type: 'info', label: 'N/A' };
    if (ms <= 2500) return { type: 'success', label: 'Good' };
    if (ms <= 4000) return { type: 'warning', label: 'Needs Improvement' };
    return { type: 'error', label: 'Poor' };
  }

  $effect(() => {
    chrome.devtools.inspectedWindow.eval(
      'window.location.origin',
      (origin: unknown) => {
        if (typeof origin !== 'string') return;

        chrome.runtime.sendMessage(
          { type: 'FETCH_ROBOTS', tabId, origin },
          (response: any) => {
            if (response) robotsTxt = response;
            fetchingRobots = false;
          }
        );

        chrome.runtime.sendMessage(
          { type: 'FETCH_SITEMAP', tabId, origin },
          (response: any) => {
            if (response) {
              sitemap = { exists: response.exists, url: origin + '/sitemap.xml', urls: [] };
            }
            fetchingSitemap = false;
          }
        );
      }
    );
  });
</script>

<div class="technical-tab">
  <section class="section">
    <h3 class="section-title">robots.txt</h3>
    {#if fetchingRobots}
      <p class="loading-text">Fetching...</p>
    {:else if robotsTxt?.exists}
      <Badge type="success" label="Found" />
      <CodeBlock code={robotsTxt.content || ''} language="txt" />
    {:else}
      <Badge type="error" label="Not Found" />
    {/if}
  </section>

  <section class="section">
    <h3 class="section-title">sitemap.xml</h3>
    {#if fetchingSitemap}
      <p class="loading-text">Fetching...</p>
    {:else if sitemap?.exists}
      <Badge type="success" label="Found" />
      {#if sitemap.url}<p class="mono">{sitemap.url}</p>{/if}
    {:else}
      <Badge type="error" label="Not Found" />
    {/if}
  </section>

  {#if data.hreflang.length > 0}
    <section class="section">
      <h3 class="section-title">Hreflang Tags</h3>
      {#each data.hreflang as hl}
        <div class="hreflang-row">
          <span class="hl-lang">{hl.lang}</span>
          <span class="mono">{hl.url}</span>
        </div>
      {/each}
    </section>
  {/if}

  <section class="section">
    <h3 class="section-title">Core Web Vitals</h3>
    <div class="vitals-grid">
      <div class="vital">
        <span class="vital-label">LCP</span>
        <span class="vital-value">{data.coreWebVitals.lcp !== null ? data.coreWebVitals.lcp + 'ms' : 'N/A'}</span>
        <Badge {...lcpBadge(data.coreWebVitals.lcp)} />
      </div>
      <div class="vital">
        <span class="vital-label">CLS</span>
        <span class="vital-value">{data.coreWebVitals.cls !== null ? data.coreWebVitals.cls : 'N/A'}</span>
      </div>
      <div class="vital">
        <span class="vital-label">FID</span>
        <span class="vital-value">{data.coreWebVitals.fid !== null ? data.coreWebVitals.fid + 'ms' : 'N/A'}</span>
      </div>
    </div>
  </section>

  <section class="section">
    <h3 class="section-title">Page Weight</h3>
    <div class="weight-grid">
      <div class="weight-item"><span class="weight-label">Total</span><span class="weight-value">{formatBytes(data.pageWeight.total)}</span></div>
      <div class="weight-item"><span class="weight-label">JavaScript</span><span class="weight-value">{formatBytes(data.pageWeight.js)}</span></div>
      <div class="weight-item"><span class="weight-label">CSS</span><span class="weight-value">{formatBytes(data.pageWeight.css)}</span></div>
      <div class="weight-item"><span class="weight-label">Images</span><span class="weight-value">{formatBytes(data.pageWeight.images)}</span></div>
      <div class="weight-item"><span class="weight-label">Fonts</span><span class="weight-value">{formatBytes(data.pageWeight.fonts)}</span></div>
      <div class="weight-item"><span class="weight-label">Other</span><span class="weight-value">{formatBytes(data.pageWeight.other)}</span></div>
    </div>
  </section>

  {#if data.renderBlocking.length > 0}
    <section class="section">
      <h3 class="section-title">Render-Blocking Resources ({data.renderBlocking.length})</h3>
      {#each data.renderBlocking as resource}
        <div class="blocking-resource mono">{resource}</div>
      {/each}
    </section>
  {/if}

  <section class="section">
    <h3 class="section-title">JS Rendering</h3>
    <div class="weight-grid">
      <div class="weight-item"><span class="weight-label">DOM Elements</span><span class="weight-value">{data.jsRendering.renderedElementCount}</span></div>
    </div>
  </section>
</div>

<style>
  .technical-tab { display: flex; flex-direction: column; gap: 4px; }
  .section { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
  .section-title { color: var(--text-secondary); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .loading-text { color: var(--text-muted); font-size: 12px; }
  .mono { font-family: var(--font-mono); font-size: 12px; }
  .hreflang-row { display: flex; gap: 12px; padding: 3px 0; font-size: 12px; }
  .hl-lang { background: var(--bg-active); color: var(--accent-color); padding: 0 4px; border-radius: 2px; font-size: 11px; font-family: var(--font-mono); }
  .vitals-grid { display: flex; gap: 24px; }
  .vital { display: flex; align-items: center; gap: 8px; }
  .vital-label { color: var(--text-muted); font-size: 11px; font-weight: 600; }
  .vital-value { color: var(--text-primary); font-size: 14px; font-weight: 600; font-family: var(--font-mono); }
  .weight-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .weight-item { display: flex; flex-direction: column; gap: 2px; }
  .weight-label { color: var(--text-muted); font-size: 11px; }
  .weight-value { color: var(--text-primary); font-size: 13px; font-family: var(--font-mono); }
  .blocking-resource { padding: 3px 0; font-size: 11px; color: var(--warning-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
