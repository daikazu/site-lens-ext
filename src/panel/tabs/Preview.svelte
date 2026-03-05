<script lang="ts">
  import type { PreviewData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';

  interface Props {
    data: PreviewData;
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

  let serpTitle = $derived(data.title || '');
  let serpDescription = $derived(data.description || '');
  let serpBreadcrumbs = $derived.by(() => {
    try {
      const u = new URL(data.url);
      const parts = [u.hostname, ...u.pathname.split('/').filter(Boolean)];
      return parts.join(' › ');
    } catch { return data.url; }
  });

  let ogTitle = $derived(data.og.title || data.title || '');
  let ogDescription = $derived(data.og.description || data.description || '');
  let ogImage = $derived(data.og.image);
  let ogSiteName = $derived(data.og.siteName || '');

  let twTitle = $derived(data.twitter.title || data.og.title || data.title || '');
  let twDescription = $derived(data.twitter.description || data.og.description || data.description || '');
  let twImage = $derived(data.twitter.image || data.og.image);
  let twCard = $derived(data.twitter.card || 'summary');
  let twSite = $derived(data.twitter.site || '');
</script>

<div class="preview-tab">
  <section class="section">
    <div class="section-header">
      <h3 class="section-title">Google Search Preview</h3>
      <div class="meta-badges">
        {#if !data.title}<Badge type="error" label="No title" />{/if}
        {#if !data.description}<Badge type="error" label="No description" />{/if}
        {#if data.title.length > 60}<Badge type="warning" label="Title may truncate" />{/if}
        {#if data.description.length > 160}<Badge type="warning" label="Desc may truncate" />{/if}
      </div>
    </div>
    <div class="serp-card">
      <div class="serp-breadcrumb-row">
        {#if faviconUrl}
          <img src={faviconUrl} alt="" class="serp-favicon" />
        {:else}
          <div class="serp-favicon-placeholder"></div>
        {/if}
        <div class="serp-site-info">
          <span class="serp-site-name">{serpBreadcrumbs.split(' › ')[0]}</span>
          <span class="serp-breadcrumb">{serpBreadcrumbs}</span>
        </div>
      </div>
      <div class="serp-title">{serpTitle || '(no title)'}</div>
      <div class="serp-description">{serpDescription || '(no description)'}</div>
    </div>
    <div class="char-counts">
      <span>Title: {data.title.length}/60</span>
      <span>Description: {data.description.length}/160</span>
    </div>
  </section>

  <section class="section">
    <div class="section-header">
      <h3 class="section-title">Facebook / Open Graph Preview</h3>
      <div class="meta-badges">
        {#if !data.og.title}<Badge type="warning" label="No og:title" />{/if}
        {#if !data.og.description}<Badge type="warning" label="No og:description" />{/if}
        {#if !data.og.image}<Badge type="error" label="No og:image" />{/if}
      </div>
    </div>
    <div class="og-card">
      {#if ogImage}
        <div class="og-image-container">
          <img src={ogImage} alt="OG Preview" class="og-image" />
        </div>
      {:else}
        <div class="og-image-placeholder">No image set</div>
      {/if}
      <div class="og-body">
        <div class="og-site">{ogSiteName || serpBreadcrumbs.split(' › ')[0]}</div>
        <div class="og-title">{ogTitle || '(no title)'}</div>
        <div class="og-description">{ogDescription || '(no description)'}</div>
      </div>
    </div>
    <div class="meta-details">
      <div class="meta-row"><span class="meta-key">og:title</span><span class="meta-val">{data.og.title || '—'}</span></div>
      <div class="meta-row"><span class="meta-key">og:description</span><span class="meta-val">{data.og.description || '—'}</span></div>
      <div class="meta-row"><span class="meta-key">og:image</span><span class="meta-val mono">{data.og.image || '—'}</span></div>
      <div class="meta-row"><span class="meta-key">og:site_name</span><span class="meta-val">{data.og.siteName || '—'}</span></div>
      <div class="meta-row"><span class="meta-key">og:type</span><span class="meta-val">{data.og.type || '—'}</span></div>
      <div class="meta-row"><span class="meta-key">og:url</span><span class="meta-val mono">{data.og.url || '—'}</span></div>
    </div>
  </section>

  <section class="section">
    <div class="section-header">
      <h3 class="section-title">Twitter / X Card Preview</h3>
      <div class="meta-badges">
        {#if !data.twitter.card}<Badge type="warning" label="No twitter:card" />{/if}
        {#if !twImage}<Badge type="warning" label="No image" />{/if}
      </div>
    </div>
    {#if twCard === 'summary_large_image'}
      <div class="tw-card-large">
        {#if twImage}
          <div class="tw-large-image-container">
            <img src={twImage} alt="Twitter Preview" class="tw-large-image" />
          </div>
        {:else}
          <div class="tw-image-placeholder tw-large-placeholder">No image set</div>
        {/if}
        <div class="tw-body">
          <div class="tw-title">{twTitle || '(no title)'}</div>
          <div class="tw-description">{twDescription || '(no description)'}</div>
          <div class="tw-domain">{twSite || serpBreadcrumbs.split(' › ')[0]}</div>
        </div>
      </div>
    {:else}
      <div class="tw-card-summary">
        {#if twImage}
          <div class="tw-thumb-container">
            <img src={twImage} alt="Twitter Preview" class="tw-thumb" />
          </div>
        {:else}
          <div class="tw-thumb-placeholder">No img</div>
        {/if}
        <div class="tw-body">
          <div class="tw-title">{twTitle || '(no title)'}</div>
          <div class="tw-description">{twDescription || '(no description)'}</div>
          <div class="tw-domain">{twSite || serpBreadcrumbs.split(' › ')[0]}</div>
        </div>
      </div>
    {/if}
    <div class="meta-details">
      <div class="meta-row"><span class="meta-key">twitter:card</span><span class="meta-val">{data.twitter.card || '—'}</span></div>
      <div class="meta-row"><span class="meta-key">twitter:title</span><span class="meta-val">{data.twitter.title || '—'}</span></div>
      <div class="meta-row"><span class="meta-key">twitter:description</span><span class="meta-val">{data.twitter.description || '—'}</span></div>
      <div class="meta-row"><span class="meta-key">twitter:image</span><span class="meta-val mono">{data.twitter.image || '—'}</span></div>
      <div class="meta-row"><span class="meta-key">twitter:site</span><span class="meta-val">{data.twitter.site || '—'}</span></div>
    </div>
  </section>
</div>

<style>
  .preview-tab { display: flex; flex-direction: column; gap: 4px; }
  .section { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
  .section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  .section-title {
    color: var(--text-secondary); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .meta-badges { display: flex; gap: 4px; }

  /* SERP */
  .serp-card {
    background: #1e1e1e; border: 1px solid var(--border-color);
    border-radius: 8px; padding: 12px 16px; max-width: 600px;
  }
  .serp-breadcrumb-row { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .serp-favicon {
    width: 28px; height: 28px; border-radius: 50%;
    object-fit: contain; background: #2a2a2a; border: 1px solid #333;
    padding: 4px;
  }
  .serp-favicon-placeholder {
    width: 28px; height: 28px; border-radius: 50%;
    background: #2a2a2a; border: 1px solid #333;
  }
  .serp-site-info { display: flex; flex-direction: column; }
  .serp-site-name { font-size: 13px; color: #d4d4d4; line-height: 1.3; }
  .serp-breadcrumb { font-size: 11px; color: #888; line-height: 1.3; }
  .serp-title {
    font-size: 18px; color: #8ab4f8; line-height: 1.3;
    cursor: pointer; margin-bottom: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .serp-title:hover { text-decoration: underline; }
  .serp-description {
    font-size: 13px; color: #bdc1c6; line-height: 1.5;
    display: -webkit-box; -webkit-line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden;
  }
  .char-counts {
    display: flex; gap: 16px; margin-top: 8px;
    font-size: 11px; color: var(--text-muted);
  }

  /* OG Card */
  .og-card {
    background: #1e1e1e; border: 1px solid var(--border-color);
    border-radius: 8px; overflow: hidden; max-width: 500px;
  }
  .og-image-container { width: 100%; aspect-ratio: 1.91/1; overflow: hidden; background: #111; }
  .og-image { width: 100%; height: 100%; object-fit: cover; }
  .og-image-placeholder {
    width: 100%; aspect-ratio: 1.91/1;
    background: #2a2a2a; display: flex; align-items: center;
    justify-content: center; color: #555; font-size: 13px;
  }
  .og-body { padding: 10px 12px; }
  .og-site { font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 2px; }
  .og-title { font-size: 14px; color: #d4d4d4; font-weight: 600; line-height: 1.3; margin-bottom: 2px; }
  .og-description { font-size: 12px; color: #888; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  /* Twitter Cards */
  .tw-card-large {
    background: #1e1e1e; border: 1px solid var(--border-color);
    border-radius: 12px; overflow: hidden; max-width: 500px;
  }
  .tw-large-image-container { width: 100%; aspect-ratio: 2/1; overflow: hidden; background: #111; }
  .tw-large-image { width: 100%; height: 100%; object-fit: cover; }
  .tw-large-placeholder { aspect-ratio: 2/1; }
  .tw-card-summary {
    background: #1e1e1e; border: 1px solid var(--border-color);
    border-radius: 12px; overflow: hidden; max-width: 500px;
    display: flex;
  }
  .tw-thumb-container { width: 130px; min-height: 130px; overflow: hidden; background: #111; flex-shrink: 0; }
  .tw-thumb { width: 100%; height: 100%; object-fit: cover; }
  .tw-thumb-placeholder {
    width: 130px; min-height: 130px; flex-shrink: 0;
    background: #2a2a2a; display: flex; align-items: center;
    justify-content: center; color: #555; font-size: 11px;
  }
  .tw-image-placeholder {
    width: 100%; background: #2a2a2a; display: flex;
    align-items: center; justify-content: center; color: #555; font-size: 13px;
  }
  .tw-body { padding: 10px 12px; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
  .tw-title { font-size: 14px; color: #d4d4d4; font-weight: 600; line-height: 1.3; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tw-description { font-size: 12px; color: #888; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .tw-domain { font-size: 11px; color: #888; margin-top: 4px; }

  /* Meta details */
  .meta-details { margin-top: 10px; display: flex; flex-direction: column; gap: 2px; }
  .meta-row { display: flex; gap: 10px; font-size: 11px; padding: 2px 4px; border-radius: 2px; }
  .meta-row:hover { background: var(--bg-hover); }
  .meta-key { color: var(--accent-color); font-family: var(--font-mono); min-width: 130px; flex-shrink: 0; }
  .meta-val { color: var(--text-primary); word-break: break-all; }
  .meta-val.mono { font-family: var(--font-mono); }
</style>
