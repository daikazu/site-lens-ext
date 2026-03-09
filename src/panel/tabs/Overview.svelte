<script lang="ts">
  import type { OverviewData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';

  interface Props {
    data: OverviewData;
    tabId: number;
  }

  let { data, tabId }: Props = $props();

  let faviconUrl = $state<string | null>(null);

  $effect(() => {
    if (!data.favicon) {
      faviconUrl = null;
      return;
    }
    const faviconJson = JSON.stringify(data.favicon);
    // chrome.devtools.inspectedWindow.eval is the official Chrome DevTools API
    chrome.devtools.inspectedWindow.eval(
      `(function() { try { return new URL(${faviconJson}, window.location.href).href; } catch(e) { return ${faviconJson}; } })()`,
      (result: unknown) => {
        if (typeof result === 'string') {
          const sep = result.includes('?') ? '&' : '?';
          faviconUrl = result + sep + '_nocache=' + Date.now();
        }
      }
    );
  });

  function titleStatus(len: number): { type: 'success' | 'warning' | 'error'; label: string } {
    if (len === 0) return { type: 'error', label: 'Missing' };
    if (len < 30) return { type: 'warning', label: 'Too short' };
    if (len > 60) return { type: 'warning', label: 'Too long' };
    return { type: 'success', label: 'Good' };
  }

  function descStatus(len: number): { type: 'success' | 'warning' | 'error'; label: string } {
    if (len === 0) return { type: 'error', label: 'Missing' };
    if (len < 70) return { type: 'warning', label: 'Too short' };
    if (len > 160) return { type: 'warning', label: 'Too long' };
    return { type: 'success', label: 'Good' };
  }
</script>

<div class="overview">
  <section class="section">
    <h3 class="section-title">Page Title</h3>
    <div class="field-row">
      <span class="field-value">{data.title.value || '(empty)'}</span>
      <Badge {...titleStatus(data.title.length)} />
      <span class="field-meta">{data.title.length} characters</span>
    </div>
  </section>

  <section class="section">
    <h3 class="section-title">Meta Description</h3>
    <div class="field-row">
      <span class="field-value">{data.description.value || '(empty)'}</span>
      <Badge {...descStatus(data.description.length)} />
      <span class="field-meta">{data.description.length} characters</span>
    </div>
  </section>

<section class="section">
    <h3 class="section-title">URL</h3>
    <div class="field-value mono">{data.url}</div>
  </section>

  <section class="section">
    <h3 class="section-title">Canonical</h3>
    <div class="field-row">
      <span class="field-value mono">{data.canonical.value || '(not set)'}</span>
      {#if data.canonical.value}
        <Badge
          type={data.canonical.matches ? 'success' : 'warning'}
          label={data.canonical.matches ? 'Matches URL' : 'Mismatch'}
        />
      {:else}
        <Badge type="warning" label="Missing" />
      {/if}
    </div>
  </section>

  <section class="section">
    <h3 class="section-title">Meta Robots</h3>
    <div class="field-value">{data.robots || '(not set)'}</div>
  </section>

  <section class="section">
    <h3 class="section-title">Page Meta</h3>
    <div class="meta-grid">
      <div class="meta-item">
        <span class="meta-label">Viewport</span>
        <span class="meta-value">{data.viewport || '(not set)'}</span>
        {#if !data.viewport}<Badge type="error" label="Missing" />{/if}
      </div>
      <div class="meta-item">
        <span class="meta-label">Charset</span>
        <span class="meta-value">{data.charset || '(not set)'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Language</span>
        <span class="meta-value">{data.lang || '(not set)'}</span>
        {#if !data.lang}<Badge type="warning" label="Missing" />{/if}
      </div>
      <div class="meta-item">
        <span class="meta-label">Favicon</span>
        <div class="favicon-row">
          {#if faviconUrl}
            <img src={faviconUrl} alt="Favicon" class="favicon-img" />
          {/if}
          <span class="meta-value">{data.favicon || '(not set)'}</span>
        </div>
      </div>
    </div>
  </section>

  {#if data.redirectChain.length > 0}
    <section class="section">
      <h3 class="section-title">Redirect Chain</h3>
      {#each data.redirectChain as url, i}
        <div class="redirect-step">
          <span class="redirect-num">{i + 1}.</span>
          <span class="field-value mono">{url}</span>
        </div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .overview { display: flex; flex-direction: column; gap: 4px; }
  .section {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-color);
  }
  .section-title {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  .field-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .field-value { color: var(--text-primary); font-size: 12px; }
  .field-value.mono { font-family: var(--font-mono); }
  .field-meta { color: var(--text-muted); font-size: 11px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .meta-label { color: var(--text-muted); font-size: 11px; }
  .meta-value { color: var(--text-primary); font-size: 12px; font-family: var(--font-mono); }
  .favicon-row { display: flex; align-items: center; gap: 8px; }
  .favicon-img { width: 32px; height: 32px; object-fit: contain; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-secondary); }
  .redirect-step { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
  .redirect-num { color: var(--text-muted); font-size: 11px; }
</style>
