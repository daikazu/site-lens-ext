<script lang="ts">
  import type { AnalysisResult } from '../shared/types';
  import Overview from './tabs/Overview.svelte';
  import Headings from './tabs/Headings.svelte';
  import Content from './tabs/Content.svelte';
  import Links from './tabs/Links.svelte';
  import Images from './tabs/Images.svelte';
  import Schema from './tabs/Schema.svelte';
  import Technical from './tabs/Technical.svelte';
  import Preview from './tabs/Preview.svelte';

  const tabs = ['Overview', 'Preview', 'Headings', 'Content', 'Links', 'Images', 'Schema', 'Technical'] as const;
  let activeTab = $state<typeof tabs[number]>('Overview');
  let analysisData = $state<AnalysisResult | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function analyze() {
    loading = true;
    error = null;
    try {
      const tabId = chrome.devtools.inspectedWindow.tabId;
      const response = await chrome.runtime.sendMessage({
        type: 'ANALYZE_PAGE',
        tabId,
      });
      if (response?.error) {
        error = response.error;
      } else {
        analysisData = response;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Analysis failed';
    } finally {
      loading = false;
    }
  }

  let issueCounts = $derived.by(() => {
    if (!analysisData) return {} as Record<string, number>;
    return {
      Overview: 0,
      Preview: (!analysisData.preview.og.image ? 1 : 0) + (!analysisData.preview.twitter.card ? 1 : 0),
      Headings: analysisData.headings.warnings.length,
      Content: 0,
      Links: analysisData.links.warnings.length,
      Images: analysisData.images.warnings.length,
      Schema: 0,
      Technical: 0,
    };
  });

  $effect(() => {
    analyze();
  });
</script>

<div class="seo-panel">
  <header class="tab-bar">
    {#each tabs as tab}
      <button
        class="tab"
        class:active={activeTab === tab}
        onclick={() => activeTab = tab}
      >
        {tab}
        {#if issueCounts[tab]}
          <span class="tab-badge">{issueCounts[tab]}</span>
        {/if}
      </button>
    {/each}
    <button class="rescan-btn" onclick={analyze} disabled={loading}>
      {loading ? 'Scanning...' : 'Re-scan'}
    </button>
  </header>

  <main class="tab-content">
    {#if error}
      <div class="error-message">{error}</div>
    {:else if loading}
      <div class="loading">Analyzing page...</div>
    {:else if analysisData}
      {#if activeTab === 'Overview'}
        <Overview data={analysisData.overview} tabId={chrome.devtools.inspectedWindow.tabId} />
      {:else if activeTab === 'Preview'}
        <Preview data={analysisData.preview} tabId={chrome.devtools.inspectedWindow.tabId} />
      {:else if activeTab === 'Headings'}
        <Headings data={analysisData.headings} tabId={chrome.devtools.inspectedWindow.tabId} />
      {:else if activeTab === 'Content'}
        <Content data={analysisData.content} tabId={chrome.devtools.inspectedWindow.tabId} />
      {:else if activeTab === 'Links'}
        <Links data={analysisData.links} tabId={chrome.devtools.inspectedWindow.tabId} />
      {:else if activeTab === 'Images'}
        <Images data={analysisData.images} tabId={chrome.devtools.inspectedWindow.tabId} />
      {:else if activeTab === 'Schema'}
        <Schema data={analysisData.schema} />
      {:else if activeTab === 'Technical'}
        <Technical data={analysisData.technical} tabId={chrome.devtools.inspectedWindow.tabId} />
      {:else}
        <p class="placeholder">Tab: {activeTab} - content coming soon</p>
      {/if}
    {:else}
      <p class="placeholder">Open a page to analyze</p>
    {/if}
  </main>
  <footer class="copyright">© 2026 Mike Wall. All rights reserved.</footer>
</div>
