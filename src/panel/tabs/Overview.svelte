<script lang="ts">
  import type { AnalysisResult, PageHeadersResult } from '../../shared/types';
  import {
    attentionItems,
    canonicalRelation,
    indexability,
    snippetCheck,
    type Severity,
    type TabName,
  } from '../lib/overview';

  interface Props {
    analysis: AnalysisResult;
    onNavigate: (tab: TabName) => void;
  }

  let { analysis, onNavigate }: Props = $props();

  const data = $derived(analysis.overview);

  let headers = $state<PageHeadersResult | null>(null);
  let headersLoading = $state(false);

  $effect(() => {
    const url = data.url;
    headers = null;
    headersLoading = true;
    chrome.runtime
      .sendMessage({ type: 'FETCH_PAGE_HEADERS', url })
      .then((res: PageHeadersResult) => { headers = res; })
      .catch(() => { headers = { ok: false, status: null, xRobotsTag: null }; })
      .finally(() => { headersLoading = false; });
  });

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

  const verdict = $derived(indexability(data, headers));
  const canonical = $derived(canonicalRelation(data.url, data.canonical.value));
  const title = $derived(snippetCheck(data.title.value, 'title'));
  const description = $derived(snippetCheck(data.description.value, 'description'));
  const attention = $derived(attentionItems(analysis));
  const status = $derived(data.httpStatus ?? headers?.status ?? null);

  const VERDICT_LABEL = {
    indexable: 'Indexable',
    caveat: 'Indexable, with caveats',
    blocked: 'Not indexable',
  } as const;

  const h1s = $derived(analysis.headings.items.filter((h) => h.level === 1));

  // Entity types across all structured data, including each node of an @graph.
  const schemaTypes = $derived.by(() => {
    const types = new Set<string>();
    const addType = (t: unknown) => {
      for (const name of Array.isArray(t) ? t : [t]) if (typeof name === 'string' && name) types.add(name);
    };
    for (const item of analysis.schema.items) {
      const graph = item.parsed['@graph'];
      if (Array.isArray(graph)) graph.forEach((node) => addType((node as Record<string, unknown>)?.['@type']));
      else if (item.parsed['@type']) addType(item.parsed['@type']);
      else if (item.type !== 'Invalid' && item.type !== 'Unknown') addType(item.type.split('/').pop());
    }
    return [...types];
  });

  // Width of the meter scale is 120% of the limit so overflow past the tick stays visible.
  const meterFill = (px: number, max: number) => `${Math.min(px / (max * 1.2), 1) * 100}%`;
  const meterTick = `${(1 / 1.2) * 100}%`;

  const statusTone = (s: number | null): Severity | 'muted' =>
    s === null ? 'muted' : s >= 400 ? 'error' : s >= 300 ? 'warning' : 'ok';
</script>

{#snippet chevron()}
  <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
{/snippet}

{#snippet meter(check: ReturnType<typeof snippetCheck>, noun: string)}
  <div class="meter-row" title="Google cuts the {noun} off at about {check.maxPx}px on desktop">
    <div class="meter" role="img" aria-label="{check.px} of {check.maxPx} pixels">
      <span class="meter-fill tone-{check.severity}" style:width={meterFill(check.px, check.maxPx)}></span>
      <span class="meter-tick" style:left={meterTick}></span>
    </div>
    <span class="meter-figures">
      <span class="meter-label tone-{check.severity}">{check.label}</span>
      · {check.px} / {check.maxPx}px · {check.chars} chars
    </span>
  </div>
{/snippet}

<div class="overview">
  <section class="verdict state-{verdict.state}" aria-labelledby="verdict-heading">
    <div class="verdict-head">
      <span class="verdict-dot" aria-hidden="true"></span>
      <h2 id="verdict-heading" class="verdict-title">{VERDICT_LABEL[verdict.state]}</h2>
      {#if status !== null}
        <span class="http-status tone-{statusTone(status)}">HTTP {status}{data.redirected ? ' · after redirect' : ''}</span>
      {:else if headersLoading}
        <span class="http-status tone-muted">Checking…</span>
      {/if}
    </div>
    {#if verdict.reasons.length > 0}
      <ul class="verdict-reasons">
        {#each verdict.reasons as reason}
          <li class="reason-{reason.severity}">{reason.text}</li>
        {/each}
      </ul>
    {:else}
      <p class="verdict-reasons">Nothing on this page prevents Google from indexing it.</p>
    {/if}
  </section>

  <div class="columns">
    <div class="col col-side">
      <section class="panel" aria-labelledby="attention-heading">
        <h3 id="attention-heading" class="panel-title">
          Needs attention
          {#if attention.length}<span class="count">{attention.length}</span>{/if}
        </h3>
        {#if attention.length === 0}
          <p class="empty-row tone-ok">No warnings from any tab.</p>
        {:else}
          <ul class="rows">
            {#each attention as item}
              <li>
                <button class="row row-button" onclick={() => onNavigate(item.tab)} disabled={item.tab === 'Overview'}>
                  <span class="row-label">{item.tab === 'Overview' ? 'Page' : item.tab}</span>
                  <span class="row-value">{item.text}</span>
                  {#if item.tab !== 'Overview'}{@render chevron()}{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="panel" aria-labelledby="indexing-heading">
        <h3 id="indexing-heading" class="panel-title">Indexing</h3>
        <dl class="rows">
          <div class="row">
            <dt class="row-label">URL</dt>
            <dd class="row-value mono">{data.url}</dd>
          </div>
          <div class="row">
            <dt class="row-label">Canonical</dt>
            <dd class="row-value">
              {#if canonical.kind === 'missing'}
                <span class="tone-warning">Not set</span>
              {:else}
                <span class="mono">{data.canonical.value}</span>
                {#if canonical.kind === 'self'}
                  <span class="sub tone-ok">{canonical.note}</span>
                {:else if canonical.kind === 'other'}
                  <span class="sub tone-warning">Different page</span>
                {:else}
                  <span class="sub tone-warning">Malformed URL</span>
                {/if}
              {/if}
            </dd>
          </div>
          <div class="row">
            <dt class="row-label">Meta robots</dt>
            <dd class="row-value">
              {#if data.robots}<span class="mono">{data.robots}</span>{:else}<span class="muted">Not set (index, follow)</span>{/if}
              {#if data.googlebot}<span class="sub mono">googlebot: {data.googlebot}</span>{/if}
            </dd>
          </div>
          <div class="row">
            <dt class="row-label">X-Robots-Tag</dt>
            <dd class="row-value">
              {#if headersLoading}
                <span class="muted">Checking…</span>
              {:else if headers?.xRobotsTag}
                <span class="mono">{headers.xRobotsTag}</span>
              {:else if headers && !headers.ok}
                <span class="muted">Could not fetch headers</span>
              {:else}
                <span class="muted">Not set</span>
              {/if}
            </dd>
          </div>
        </dl>
      </section>
    </div>

    <div class="col col-main">
      <section class="panel" aria-labelledby="appearance-heading">
        <h3 id="appearance-heading" class="panel-title">Search appearance</h3>
        <dl class="rows">
          <div class="row">
            <dt class="row-label">Title</dt>
            <dd class="row-value">
              <p class="snippet-title" class:muted={!data.title.value}>{data.title.value || 'No title'}</p>
              {@render meter(title, 'title')}
            </dd>
          </div>
          <div class="row">
            <dt class="row-label">Description</dt>
            <dd class="row-value">
              <p class="snippet-description" class:muted={!data.description.value}>
                {data.description.value || 'No meta description. Google will pull text from the page instead.'}
              </p>
              {@render meter(description, 'description')}
            </dd>
          </div>
        </dl>
      </section>

      <section class="panel" aria-labelledby="facts-heading">
        <h3 id="facts-heading" class="panel-title">Page facts</h3>
        <dl class="rows">
          <div class="row">
            <dt class="row-label">H1</dt>
            <dd class="row-value">
              {#if h1s.length === 0}
                <span class="tone-warning">None</span>
              {:else}
                {h1s[0].text || '(empty)'}
                {#if h1s.length > 1}<span class="aside tone-warning">{h1s.length} H1s</span>{/if}
              {/if}
            </dd>
          </div>
          <div class="row">
            <dt class="row-label">Words</dt>
            <dd class="row-value num">{analysis.content.wordCount.toLocaleString()}</dd>
          </div>
          <div class="row">
            <dt class="row-label">Structured data</dt>
            <dd class="row-value">
              {#if schemaTypes.length}{schemaTypes.join(', ')}{:else}<span class="muted">None</span>{/if}
            </dd>
          </div>
          <div class="row">
            <dt class="row-label">Share image</dt>
            <dd class="row-value">
              {#if analysis.preview.og.image}
                <span class="with-icon">
                  <img
                    class="og-thumb"
                    src={analysis.preview.og.image}
                    alt=""
                    onerror={(e) => ((e.currentTarget as HTMLImageElement).hidden = true)}
                  />
                  og:image set
                </span>
              {:else}
                <span class="tone-warning">Missing</span>
              {/if}
            </dd>
          </div>
          <div class="row">
            <dt class="row-label">hreflang</dt>
            <dd class="row-value">
              {#if analysis.technical.hreflang.length}
                {analysis.technical.hreflang.length} alternate{analysis.technical.hreflang.length === 1 ? '' : 's'}
              {:else}
                <span class="muted">None</span>
              {/if}
            </dd>
          </div>
          <div class="row">
            <dt class="row-label">Language</dt>
            <dd class="row-value">{#if data.lang}{data.lang}{:else}<span class="tone-warning">Missing</span>{/if}</dd>
          </div>
          <div class="row">
            <dt class="row-label">Viewport</dt>
            <dd class="row-value">{#if data.viewport}<span class="mono">{data.viewport}</span>{:else}<span class="tone-error">Missing</span>{/if}</dd>
          </div>
          <div class="row">
            <dt class="row-label">Charset</dt>
            <dd class="row-value">{#if data.charset}{data.charset.toUpperCase()}{:else}<span class="muted">Not declared</span>{/if}</dd>
          </div>
          <div class="row">
            <dt class="row-label">Favicon</dt>
            <dd class="row-value">
              {#if data.favicon}
                <span class="with-icon">
                  {#if faviconUrl}<img src={faviconUrl} alt="" class="favicon-img" />{/if}
                  <span class="mono">{data.favicon}</span>
                </span>
              {:else}
                <span class="tone-warning">Missing</span>
              {/if}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </div>
</div>

<style>
  /* One grammar for the whole tab: panel title, then hairline rows with a shared label column. */
  .overview {
    --label-col: 112px;
    --row-gap-x: 16px;
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 1280px;
    padding-bottom: 8px;
  }

  .tone-ok { color: var(--success-color); }
  .tone-warning { color: var(--warning-color); }
  .tone-error { color: var(--error-color); }
  .tone-muted, .muted { color: var(--text-muted); }
  .mono { font-family: var(--font-mono); font-size: 11.5px; }
  .num { font-variant-numeric: tabular-nums; }

  /* --- Verdict banner: the only tinted surface --- */
  .verdict {
    --state: var(--success-color);
    background: color-mix(in srgb, var(--state) 7%, var(--bg-primary));
    border: 1px solid color-mix(in srgb, var(--state) 30%, transparent);
    border-radius: 6px;
    padding: 12px 14px;
  }
  .verdict.state-caveat { --state: var(--warning-color); }
  .verdict.state-blocked { --state: var(--error-color); }
  .verdict-head { display: flex; align-items: center; gap: 10px; }
  .verdict-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    background: var(--state);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--state) 22%, transparent);
  }
  .verdict-title { font-size: 14px; font-weight: 600; color: var(--state); }
  .http-status {
    margin-left: auto; font-family: var(--font-mono); font-size: 11px; white-space: nowrap;
    padding: 1px 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.05);
    font-variant-numeric: tabular-nums;
  }
  .verdict-reasons {
    list-style: none; margin: 6px 0 0 18px;
    display: flex; flex-direction: column; gap: 2px;
    color: var(--text-secondary); font-size: 12px;
  }
  .verdict-reasons li::before {
    content: ''; display: inline-block; width: 4px; height: 4px; border-radius: 1px;
    margin: 0 8px 2px 0; background: currentColor; vertical-align: middle;
  }
  .verdict-reasons .reason-error { color: var(--text-primary); }
  .verdict-reasons .reason-error::before { background: var(--error-color); }
  .verdict-reasons .reason-warning::before { background: var(--warning-color); }

  /* --- Columns: side (attention, indexing) first in DOM so narrow panels read it first --- */
  .columns { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .col { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
  @container (min-width: 880px) {
    .columns { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); column-gap: 32px; align-items: start; }
    .col-main { order: 1; }
    .col-side { order: 2; }
  }

  .panel-title {
    display: flex; align-items: center; gap: 8px; height: 20px;
    color: var(--text-secondary); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  .count {
    font-size: 10px; letter-spacing: 0; color: var(--text-primary); font-weight: 600;
    background: var(--bg-active); border-radius: 8px; padding: 0 6px; line-height: 16px;
    font-variant-numeric: tabular-nums;
  }

  /* --- Rows --- */
  .rows { list-style: none; border-top: 1px solid var(--border-color); }
  .rows > li, .rows > .row { border-bottom: 1px solid var(--border-color); }
  .row {
    display: grid;
    grid-template-columns: var(--label-col) minmax(0, 1fr);
    column-gap: var(--row-gap-x);
    align-items: baseline;
    padding: 7px 0;
    font-size: 12px;
    line-height: 18px;
  }
  .row-label { color: var(--text-muted); font-size: 11px; }
  .row-value { color: var(--text-primary); min-width: 0; overflow-wrap: anywhere; }
  .sub { display: block; font-size: 11px; }
  .aside { margin-left: 8px; font-size: 11px; white-space: nowrap; }
  .empty-row { padding: 7px 0; font-size: 12px; border-top: 1px solid var(--border-color); }

  .row-button {
    grid-template-columns: var(--label-col) minmax(0, 1fr) 14px;
    width: 100%; text-align: left; font: inherit; font-size: 12px; line-height: 18px;
    background: none; border: none; color: inherit; cursor: pointer;
    padding: 7px 0; border-radius: 0;
    transition: background-color 150ms ease-out;
  }
  .row-button:hover:not(:disabled) { background: var(--bg-hover); }
  .row-button:hover:not(:disabled) .chevron { color: var(--accent-color); transform: translateX(2px); }
  .row-button:focus-visible { outline: 1px solid var(--accent-color); outline-offset: -1px; }
  .row-button:disabled { cursor: default; }
  .chevron {
    width: 14px; height: 14px; color: var(--text-muted); align-self: center;
    transition: transform 150ms ease-out, color 150ms ease-out;
  }

  /* --- Search appearance --- */
  .snippet-title { font-size: 13px; font-weight: 500; }
  .snippet-description { max-width: 72ch; }
  .meter-row { display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap; cursor: help; }
  .meter {
    position: relative; flex: 0 1 160px; min-width: 80px; height: 3px;
    background: var(--bg-active); border-radius: 2px;
  }
  .meter-fill { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: currentColor; }
  .meter-tick { position: absolute; top: -3px; bottom: -3px; width: 1px; background: var(--text-secondary); }
  .meter-figures { flex: 1 1 180px; font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .meter-label { font-size: 11px; font-weight: 600; }

  .with-icon { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  .og-thumb {
    width: 40px; height: 21px; object-fit: cover; border-radius: 2px;
    border: 1px solid var(--border-color); background: var(--bg-secondary); flex-shrink: 0;
  }
  .favicon-img { width: 16px; height: 16px; object-fit: contain; flex-shrink: 0; }

  @container (max-width: 380px) {
    .columns { --label-col: 88px; --row-gap-x: 12px; }
  }
</style>
