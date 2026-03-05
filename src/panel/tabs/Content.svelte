<script lang="ts">
  import type { ContentData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import SortableTable from '../components/SortableTable.svelte';

  interface Props {
    data: ContentData;
    tabId: number;
  }

  let { data, tabId }: Props = $props();

  let activePhrase = $state<string | null>(null);

  function highlightPhrase(row: Record<string, unknown>) {
    const phrase = String(row.word || '');
    if (activePhrase === phrase) {
      clearHighlights();
      return;
    }
    activePhrase = phrase;
    const phraseJson = JSON.stringify(phrase);
    // chrome.devtools.inspectedWindow.eval is the official Chrome DevTools API
    chrome.devtools.inspectedWindow.eval(
      `(function() {
        var STYLE_ID = 'seo-ext-word-highlight-style';
        if (!document.getElementById(STYLE_ID)) {
          var s = document.createElement('style');
          s.id = STYLE_ID;
          s.textContent = '@keyframes seo-ext-word-pulse { 0%, 100% { background-color: rgba(79, 193, 255, 0.35); } 50% { background-color: rgba(255, 107, 107, 0.35); } }' +
            '.seo-ext-word-highlight { background-color: rgba(79, 193, 255, 0.35) !important; outline: 2px solid rgba(79, 193, 255, 0.6) !important; outline-offset: 1px !important; border-radius: 2px !important; animation: seo-ext-word-pulse 1.5s ease-in-out infinite !important; }';
          document.head.appendChild(s);
        }
        var prev = document.querySelectorAll('.seo-ext-word-highlight');
        prev.forEach(function(p) {
          var parent = p.parentNode;
          parent.replaceChild(document.createTextNode(p.textContent), p);
          parent.normalize();
        });
        var phrase = ${phraseJson};
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: function(node) {
            var tag = node.parentElement ? node.parentElement.tagName : '';
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
            if (node.parentElement && node.parentElement.classList.contains('seo-ext-word-highlight')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        var textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        var special = ['\\\\\\\\','.','*','+','?','^','(',')','{','}','|','[',']'];
        var escaped = phrase;
        for (var s = 0; s < special.length; s++) { escaped = escaped.split(special[s]).join('\\\\\\\\' + special[s]); }
        var regex = new RegExp('\\\\b(' + escaped + ')\\\\b', 'gi');
        var firstMatch = null;
        for (var i = 0; i < textNodes.length; i++) {
          var node = textNodes[i];
          var text = node.textContent;
          if (!regex.test(text)) continue;
          regex.lastIndex = 0;
          var frag = document.createDocumentFragment();
          var lastIdx = 0;
          var match;
          while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
            var span = document.createElement('span');
            span.className = 'seo-ext-word-highlight';
            span.textContent = match[0];
            frag.appendChild(span);
            if (!firstMatch) firstMatch = span;
            lastIdx = regex.lastIndex;
          }
          if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
          node.parentNode.replaceChild(frag, node);
        }
        if (firstMatch) firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })()`
    );
  }

  function clearHighlights() {
    activePhrase = null;
    // chrome.devtools.inspectedWindow.eval is the official Chrome DevTools API
    chrome.devtools.inspectedWindow.eval(
      `(function() {
        var prev = document.querySelectorAll('.seo-ext-word-highlight');
        prev.forEach(function(p) {
          var parent = p.parentNode;
          parent.replaceChild(document.createTextNode(p.textContent), p);
          parent.normalize();
        });
      })()`
    );
  }

  let activeDensityTab = $state<'oneWord' | 'twoWord' | 'threeWord'>('oneWord');

  const densityColumns = [
    { key: 'word', label: 'Phrase', width: '50%' },
    { key: 'count', label: 'Count', width: '25%' },
    { key: 'percentage', label: 'Density %', width: '25%' },
  ];

  function readabilityBadge(score: number): { type: 'success' | 'warning' | 'error'; label: string } {
    if (score >= 60) return { type: 'success', label: data.readabilityGrade };
    if (score >= 40) return { type: 'warning', label: data.readabilityGrade };
    return { type: 'error', label: data.readabilityGrade };
  }
</script>

<div class="content-tab">
  <section class="stats-row">
    <div class="stat">
      <span class="stat-label">Word Count</span>
      <span class="stat-value">{data.wordCount.toLocaleString()}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Text / HTML Ratio</span>
      <span class="stat-value">{data.textToHtmlRatio}%</span>
      {#if data.textToHtmlRatio < 10}
        <Badge type="warning" label="Low" />
      {:else}
        <Badge type="success" label="OK" />
      {/if}
    </div>
    <div class="stat">
      <span class="stat-label">Readability</span>
      <span class="stat-value">{data.readabilityScore}</span>
      <Badge {...readabilityBadge(data.readabilityScore)} />
    </div>
  </section>

  <section class="section">
    <h3 class="section-title">Word Density</h3>
    <div class="density-tabs">
      <button class:active={activeDensityTab === 'oneWord'} onclick={() => activeDensityTab = 'oneWord'}>1-Word</button>
      <button class:active={activeDensityTab === 'twoWord'} onclick={() => activeDensityTab = 'twoWord'}>2-Word</button>
      <button class:active={activeDensityTab === 'threeWord'} onclick={() => activeDensityTab = 'threeWord'}>3-Word</button>
    </div>
    <p class="hint">Click a phrase to highlight all instances on the page. Click again to clear.</p>
    <SortableTable columns={densityColumns} rows={data.density[activeDensityTab]} onRowClick={highlightPhrase} />
  </section>
</div>

<style>
  .content-tab { display: flex; flex-direction: column; gap: 4px; }
  .stats-row {
    display: flex; gap: 24px; padding: 12px;
    border-bottom: 1px solid var(--border-color);
  }
  .stat { display: flex; align-items: center; gap: 8px; }
  .stat-label { color: var(--text-muted); font-size: 11px; }
  .stat-value { color: var(--text-primary); font-size: 14px; font-weight: 600; font-family: var(--font-mono); }
  .section { padding: 10px 12px; }
  .section-title {
    color: var(--text-secondary); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
  }
  .hint { color: var(--text-muted); font-size: 11px; margin-bottom: 8px; }
  .density-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
  .density-tabs button {
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    color: var(--text-secondary); font-size: 11px; padding: 3px 10px;
    border-radius: 3px; cursor: pointer;
  }
  .density-tabs button:hover { color: var(--text-primary); }
  .density-tabs button.active {
    background: var(--bg-active); color: var(--accent-color);
    border-color: var(--accent-color);
  }
</style>
