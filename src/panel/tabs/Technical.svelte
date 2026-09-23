<script lang="ts">
  import type { AnalysisResult, PageSourceResult, RobotsTxtResult, SitemapCheck, SitemapsResult } from '../../shared/types';
  import CodeBlock from '../components/CodeBlock.svelte';
  import { robotsVerdict } from '../lib/robots';
  import { getPageSource, getRobots, getSitemaps } from '../lib/site-data';
  import {
    checkHreflang,
    compareSignals,
    domSizeSeverity,
    formatBytes,
    rateMetrics,
    rawSignals,
    renderedSignals,
  } from '../lib/technical';

  interface Props {
    analysis: AnalysisResult;
  }

  let { analysis }: Props = $props();

  const data = $derived(analysis.technical);
  const pageUrl = $derived(analysis.overview.url);
  const origin = $derived.by(() => {
    try { return new URL(pageUrl).origin; } catch { return null; }
  });
  // Sitemaps and hreflang should list the canonical URL; accept the page URL too.
  const pageUrls = $derived.by(() => {
    const urls = [pageUrl];
    const canonical = analysis.overview.canonical.value;
    if (canonical) {
      try { urls.push(new URL(canonical, pageUrl).href); } catch { /* ignore malformed */ }
    }
    return urls;
  });

  let source = $state<PageSourceResult | null>(null);
  let robots = $state<RobotsTxtResult | null>(null);
  let sitemaps = $state<{ declared: boolean; result: SitemapsResult } | null>(null);
  let sitemapError = $state(false);

  $effect(() => {
    const scan = analysis.timestamp;
    const url = pageUrl;
    const urls = pageUrls;
    const o = origin;
    source = null;
    robots = null;
    sitemaps = null;
    sitemapError = false;
    getPageSource(url, scan).then((res) => { source = res; });
    if (!o) return;
    getRobots(o, scan).then((res) => { robots = res; });
    getSitemaps(o, urls, scan)
      .then((res) => { sitemaps = res; })
      .catch(() => { sitemapError = true; });
  });

  const robotsState = $derived(robots ? robotsVerdict(robots, pageUrl) : null);
  const comparison = $derived(
    source?.html ? compareSignals(rawSignals(source.html, pageUrl), renderedSignals(analysis)) : null,
  );
  const hreflang = $derived(checkHreflang(data.hreflang, pageUrls));
  const metrics = $derived(rateMetrics(data.performance));
  const domSeverity = $derived(domSizeSeverity(data.domElements));
  const isHttps = $derived(pageUrl.startsWith('https:'));

  const header = (name: string) => source?.headers[name] ?? null;
  const allHeaders = $derived(
    source ? Object.entries(source.headers).map(([k, v]) => `${k}: ${v}`).sort().join('\n') : '',
  );

  function sitemapSummary(s: SitemapCheck): { text: string; tone: string } {
    switch (s.kind) {
      case 'urlset': return { text: `${s.urlCount.toLocaleString()} URLs`, tone: 'muted' };
      case 'index': return { text: `Sitemap index · ${s.urlCount} sitemaps`, tone: 'muted' };
      case 'invalid': return { text: `Not a sitemap (HTTP ${s.status}, no <urlset> or <sitemapindex>)`, tone: 'tone-error' };
      default: return { text: s.status ? `HTTP ${s.status}` : `Unreachable${s.error ? ` (${s.error})` : ''}`, tone: 'tone-error' };
    }
  }

  function shortUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.host + u.pathname + u.search;
    } catch {
      return url;
    }
  }
</script>

<div class="technical">
  <div class="columns">
    <div class="col">
      <section aria-labelledby="crawl-heading">
        <h3 id="crawl-heading" class="kv-title">Crawling</h3>
        <dl class="kv-rows">
          <div class="kv-row">
            <dt class="kv-label">robots.txt</dt>
            <dd class="kv-value">
              {#if !robots || !robotsState}
                <span class="muted">Checking…</span>
              {:else}
                <span class:tone-error={robotsState.state === 'blocked'} class:tone-ok={robotsState.state === 'allowed'} class:tone-warning={robotsState.state === 'unknown'}>
                  {robotsState.state === 'blocked' ? 'This page is blocked' : robotsState.state === 'allowed' ? 'This page is allowed' : 'Unknown'}
                </span>
                <span class="kv-sub muted">{robotsState.detail}</span>
                {#if robots.content}
                  <details class="kv-details">
                    <summary>View robots.txt</summary>
                    <CodeBlock code={robots.content} language="txt" />
                  </details>
                {/if}
              {/if}
            </dd>
          </div>

          <div class="kv-row">
            <dt class="kv-label">Sitemaps</dt>
            <dd class="kv-value">
              {#if sitemapError}
                <span class="tone-warning">Could not check sitemaps</span>
              {:else if !sitemaps}
                <span class="muted">Checking…</span>
              {:else if sitemaps.result.sitemaps.length === 0}
                <span class="tone-warning">None found</span>
                <span class="kv-sub muted">Not declared in robots.txt, and nothing at /sitemap.xml or /sitemap_index.xml</span>
              {:else}
                <ul class="plain-list">
                  {#each sitemaps.result.sitemaps as s}
                    {@const summary = sitemapSummary(s)}
                    <li>
                      <span class="mono">{shortUrl(s.url)}</span>
                      <span class="kv-sub {summary.tone}">{summary.text}</span>
                    </li>
                  {/each}
                </ul>
                <span class="kv-sub muted">
                  {sitemaps.declared ? 'Declared in robots.txt' : 'Found at the default location, but not declared in robots.txt'}
                </span>
              {/if}
            </dd>
          </div>

          <div class="kv-row">
            <dt class="kv-label">In sitemap</dt>
            <dd class="kv-value">
              {#if !sitemaps}
                <span class="muted">{sitemapError ? '—' : 'Checking…'}</span>
              {:else if sitemaps.result.containsPage === true}
                <span class="tone-ok">This page is listed</span>
              {:else if sitemaps.result.containsPage === false}
                <span class="tone-warning">This page isn't listed</span>
                <span class="kv-sub muted">Checked every URL in the sitemaps above</span>
              {:else if sitemaps.result.sitemaps.length === 0}
                <span class="muted">No sitemap to check</span>
              {:else}
                <span class="muted">Not found in the sitemaps that could be checked</span>
                {#if sitemaps.result.checkedLimitReached}
                  <span class="kv-sub muted">Stopped after 25 child sitemaps</span>
                {/if}
              {/if}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="render-heading">
        <h3 id="render-heading" class="kv-title">Raw HTML vs rendered</h3>
        {#if !source}
          <p class="kv-note kv-rows">Fetching the page without JavaScript…</p>
        {:else if !source.ok}
          <p class="kv-note kv-rows">Could not fetch the page{source.error ? `: ${source.error}` : ''}.</p>
        {:else if !source.html}
          <p class="kv-note kv-rows">The server didn't return HTML ({source.headers['content-type'] ?? 'no content type'}).</p>
        {:else if comparison}
          <dl class="kv-rows">
            {#each comparison as row}
              <div class="kv-row">
                <dt class="kv-label">{row.label}</dt>
                <dd class="kv-value">
                  {#if row.severity !== 'warning'}
                    <span class="clamp">{row.rendered}</span>
                    <span class="kv-sub" class:tone-ok={row.severity === 'ok'} class:muted={row.severity !== 'ok'}>
                      {row.note === 'Same' ? 'Same in raw HTML' : row.note}
                    </span>
                  {:else}
                    <span class:tone-warning={row.severity === 'warning'}>{row.note}</span>
                    <span class="compare">
                      <span class="compare-label">Raw</span><span class="clamp" class:muted={row.raw === 'Not present'}>{row.raw}</span>
                      <span class="compare-label">Rendered</span><span class="clamp" class:muted={row.rendered === 'Not present'}>{row.rendered}</span>
                    </span>
                  {/if}
                </dd>
              </div>
            {/each}
          </dl>
          <p class="kv-note">
            Raw HTML is what the server sends before any JavaScript runs. Google renders JavaScript, but later
            and not always, so key tags belong in the raw HTML.{source.truncated ? ' The page was over 5 MB, so only the start was compared.' : ''}
          </p>
        {/if}
      </section>

      <section aria-labelledby="hreflang-heading">
        <h3 id="hreflang-heading" class="kv-title">
          hreflang
          {#if data.hreflang.length}<span class="kv-count">{data.hreflang.length}</span>{/if}
        </h3>
        {#if data.hreflang.length === 0}
          <p class="kv-note kv-rows">No hreflang tags. Only needed when the page has translated or regional versions.</p>
        {:else}
          <dl class="kv-rows">
            {#each hreflang.pageIssues as issue}
              <div class="kv-row">
                <dt class="kv-label">Page</dt>
                <dd class="kv-value tone-{issue.severity}">{issue.text}</dd>
              </div>
            {/each}
            {#each hreflang.entries as entry}
              <div class="kv-row">
                <dt class="kv-label mono">{entry.lang}</dt>
                <dd class="kv-value">
                  <span class="mono">{entry.url}</span>
                  {#each entry.issues as issue}<span class="kv-sub tone-warning">{issue}</span>{/each}
                </dd>
              </div>
            {/each}
          </dl>
          <p class="kv-note">Return links (each alternate pointing back here) aren't checked.</p>
        {/if}
      </section>

      {#if data.renderBlocking.length}
        <section aria-labelledby="blocking-heading">
          <h3 id="blocking-heading" class="kv-title">
            Render-blocking resources <span class="kv-count">{data.renderBlocking.length}</span>
          </h3>
          <ul class="kv-rows">
            {#each data.renderBlocking as url}
              <li class="kv-row single"><span class="kv-value mono ellipsis" title={url}>{shortUrl(url)}</span></li>
            {/each}
          </ul>
          <p class="kv-note">These delay the first paint. Defer scripts and inline critical CSS where you can.</p>
        </section>
      {/if}
    </div>

    <div class="col">
      <section aria-labelledby="perf-heading">
        <h3 id="perf-heading" class="kv-title">Page load</h3>
        <dl class="kv-rows">
          {#each metrics as metric}
            <div class="kv-row">
              <dt class="kv-label">{metric.label}</dt>
              <dd class="kv-value metric">
                <span class="num tone-{metric.severity === 'neutral' ? 'muted' : metric.severity}" class:plain-value={metric.severity === 'neutral' && metric.value !== null}>{metric.display}</span>
                {#if metric.target}<span class="muted target">{metric.target}</span>{/if}
              </dd>
            </div>
          {/each}
          <div class="kv-row">
            <dt class="kv-label">DOM elements</dt>
            <dd class="kv-value metric">
              <span class="num tone-{domSeverity}">{data.domElements.toLocaleString()}</span>
              <span class="muted target">Good ≤ 800</span>
            </dd>
          </div>
        </dl>
        <p class="kv-note">
          Measured during this page load in your browser, so it varies between loads and isn't Google's field data.
          Interaction to Next Paint needs real clicks and isn't measured.
        </p>
      </section>

      <section aria-labelledby="headers-heading">
        <h3 id="headers-heading" class="kv-title">Response</h3>
        <dl class="kv-rows">
          <div class="kv-row">
            <dt class="kv-label">Status</dt>
            <dd class="kv-value">
              {#if !source}
                <span class="muted">Checking…</span>
              {:else if source.status}
                <span class="num" class:tone-error={source.status >= 400}>HTTP {source.status}</span>
                {#if source.redirected && source.finalUrl}<span class="kv-sub muted">Redirected to <span class="mono">{source.finalUrl}</span></span>{/if}
              {:else}
                <span class="muted">Unknown</span>
              {/if}
            </dd>
          </div>
          <div class="kv-row">
            <dt class="kv-label">Protocol</dt>
            <dd class="kv-value">{data.documentProtocol ?? 'Unknown'}</dd>
          </div>
          {#if source?.ok}
            <div class="kv-row">
              <dt class="kv-label">Content-Type</dt>
              <dd class="kv-value mono">{header('content-type') ?? '—'}</dd>
            </div>
            <div class="kv-row">
              <dt class="kv-label">Compression</dt>
              <dd class="kv-value">
                {#if header('content-encoding')}<span class="mono">{header('content-encoding')}</span>{:else}<span class="tone-warning">None</span><span class="kv-sub muted">HTML isn't gzip, Brotli, or zstd compressed</span>{/if}
              </dd>
            </div>
            <div class="kv-row">
              <dt class="kv-label">Cache-Control</dt>
              <dd class="kv-value">{#if header('cache-control')}<span class="mono">{header('cache-control')}</span>{:else}<span class="muted">Not set</span>{/if}</dd>
            </div>
            <div class="kv-row">
              <dt class="kv-label">X-Robots-Tag</dt>
              <dd class="kv-value">{#if header('x-robots-tag')}<span class="mono">{header('x-robots-tag')}</span>{:else}<span class="muted">Not set</span>{/if}</dd>
            </div>
            {#if header('link')}
              <div class="kv-row">
                <dt class="kv-label">Link</dt>
                <dd class="kv-value mono">{header('link')}</dd>
              </div>
            {/if}
            {#if isHttps}
              <div class="kv-row">
                <dt class="kv-label">HSTS</dt>
                <dd class="kv-value">{#if header('strict-transport-security')}<span class="mono">{header('strict-transport-security')}</span>{:else}<span class="tone-warning">Not set</span>{/if}</dd>
              </div>
            {/if}
          {/if}
          <div class="kv-row">
            <dt class="kv-label">Mixed content</dt>
            <dd class="kv-value">
              {#if !isHttps}
                <span class="tone-warning">Page isn't served over HTTPS</span>
              {:else if data.mixedContent.length === 0}
                <span class="tone-ok">None</span>
              {:else}
                <span class="tone-error">{data.mixedContent.length} insecure http:// resource{data.mixedContent.length === 1 ? '' : 's'}</span>
                {#each data.mixedContent as url}<span class="kv-sub mono ellipsis" title={url}>{url}</span>{/each}
              {/if}
            </dd>
          </div>
        </dl>
        {#if allHeaders}
          <details class="kv-details">
            <summary>All response headers</summary>
            <CodeBlock code={allHeaders} language="http" />
          </details>
        {/if}
      </section>

      <section aria-labelledby="weight-heading">
        <h3 id="weight-heading" class="kv-title">Page weight</h3>
        <dl class="kv-rows">
          {#each data.pageWeight.categories as c}
            <div class="kv-row">
              <dt class="kv-label">{c.name}</dt>
              <dd class="kv-value weight">
                <span class="num">{formatBytes(c.bytes)}</span>
                <span class="muted num">{c.requests} request{c.requests === 1 ? '' : 's'}{c.unmeasured ? ` · ${c.unmeasured} unmeasured` : ''}</span>
              </dd>
            </div>
          {/each}
          <div class="kv-row total">
            <dt class="kv-label">Total</dt>
            <dd class="kv-value weight">
              <span class="num">{data.pageWeight.unmeasured ? 'at least ' : ''}{formatBytes(data.pageWeight.totalBytes)}</span>
              <span class="muted num">{data.pageWeight.totalRequests} requests</span>
            </dd>
          </div>
        </dl>
        <p class="kv-note">
          Compressed sizes, including files served from cache.
          {#if data.pageWeight.unmeasured}
            {data.pageWeight.unmeasured} request{data.pageWeight.unmeasured === 1 ? '' : 's'} from other domains
            don't report a size unless the server sends Timing-Allow-Origin, so the total is a lower bound.
          {/if}
          {#if data.protocols.length}
            Protocols: {data.protocols.map((p) => `${p.protocol === 'unknown' ? 'not reported' : p.protocol} (${p.requests})`).join(', ')}.
          {/if}
        </p>
      </section>

      {#if data.domains.length}
        <section aria-labelledby="domains-heading">
          <h3 id="domains-heading" class="kv-title">
            Requests by domain <span class="kv-count">{data.domains.length}</span>
          </h3>
          <dl class="kv-rows">
            {#each data.domains.slice(0, 10) as d}
              <div class="kv-row">
                <dt class="kv-label num">{d.requests} request{d.requests === 1 ? '' : 's'}</dt>
                <dd class="kv-value weight">
                  <span class="mono ellipsis" title={d.host}>{d.host}</span>
                  <span class="muted">{d.sameSite ? 'Same site' : 'Other site'}</span>
                </dd>
              </div>
            {/each}
          </dl>
          {#if data.domains.length > 10}
            <p class="kv-note">And {data.domains.length - 10} more.</p>
          {/if}
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .technical { --label-col: 128px; container-type: inline-size; max-width: 1280px; padding-bottom: 8px; }
  .columns { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .col { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
  @container (min-width: 880px) {
    .columns { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); column-gap: 32px; align-items: start; }
  }
  @container (max-width: 380px) {
    .columns { --label-col: 96px; --row-gap-x: 12px; }
  }

  .plain-list { list-style: none; display: flex; flex-direction: column; gap: 4px; }
  .ellipsis { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kv-row.single { grid-template-columns: minmax(0, 1fr); }
  .clamp { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  .compare {
    display: grid; grid-template-columns: max-content minmax(0, 1fr);
    column-gap: 10px; row-gap: 2px; margin-top: 4px;
  }
  .compare-label { color: var(--text-muted); font-size: 11px; }

  .metric, .weight { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .weight > :first-child { min-width: 0; }
  .target { font-size: 11px; white-space: nowrap; }
  .plain-value { color: var(--text-primary); }
  .total { font-weight: 600; }
  .total .kv-label { color: var(--text-secondary); }
</style>
