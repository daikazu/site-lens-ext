<script lang="ts">
  import type { HeadingsData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import TreeView from '../components/TreeView.svelte';

  interface Props {
    data: HeadingsData;
    tabId: number;
  }

  let { data, tabId }: Props = $props();

  const headingColors: Record<string, string> = {
    H1: '#f14c4c',
    H2: '#cca700',
    H3: '#4ec9b0',
    H4: '#4fc1ff',
    H5: '#c586c0',
    H6: '#9cdcfe',
  };

  function buildHeadingTree(items: HeadingsData['items']) {
    type TreeNode = { label: string; tag: string; tagColor?: string; children: TreeNode[] };
    const root: TreeNode[] = [];
    const stack: { level: number; node: TreeNode }[] = [];

    for (const h of items) {
      const level = parseInt(h.tag.replace(/\D/g, ''), 10) || 1;
      const tag = h.tag.toUpperCase();
      const node: TreeNode = { label: h.text || '(empty)', tag, tagColor: headingColors[tag], children: [] };

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(node);
      } else {
        stack[stack.length - 1].node.children.push(node);
      }
      stack.push({ level, node });
    }
    return root;
  }

  let treeNodes = $derived(buildHeadingTree(data.items));

  function scrollToHeading(node: { label: string; tag?: string }) {
    if (!node.tag) return;
    const tag = node.tag.toLowerCase();
    const text = node.label;
    // chrome.devtools.inspectedWindow.eval is the official Chrome DevTools API
    // for executing code in the context of the inspected page - not regular eval()
    const textJson = JSON.stringify(text);
    chrome.devtools.inspectedWindow.eval(
      `(function() {
        var STYLE_ID = 'seo-ext-heading-highlight-style';
        if (!document.getElementById(STYLE_ID)) {
          var s = document.createElement('style');
          s.id = STYLE_ID;
          s.textContent = '@keyframes seo-ext-heading-pulse { 0%, 100% { outline-color: #4fc1ff; background-color: rgba(79, 193, 255, 0.25); } 50% { outline-color: #ff6b6b; background-color: rgba(255, 107, 107, 0.25); } }' +
            '.seo-ext-heading-scrolled { outline: 3px solid #4fc1ff !important; outline-offset: 3px !important; background-color: rgba(79, 193, 255, 0.25) !important; animation: seo-ext-heading-pulse 1s ease-in-out 3 !important; position: relative !important; z-index: 999999 !important; box-shadow: 0 0 12px rgba(79, 193, 255, 0.5) !important; }';
          document.head.appendChild(s);
        }
        var prev = document.querySelectorAll('.seo-ext-heading-scrolled');
        prev.forEach(function(p) { p.classList.remove('seo-ext-heading-scrolled'); });
        var target = ${textJson};
        var headings = document.querySelectorAll('${tag}');
        var normalTarget = target.replace(/\\s+/g, ' ').trim();
        for (var i = 0; i < headings.length; i++) {
          var elText = (headings[i].textContent || '').replace(/\\s+/g, ' ').trim();
          if (elText === normalTarget) {
            headings[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
            headings[i].classList.add('seo-ext-heading-scrolled');
            setTimeout(function() { headings[i].classList.remove('seo-ext-heading-scrolled'); }, 4000);
            break;
          }
        }
      })()`
    );
  }
</script>

<div class="headings">
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
    <h3 class="section-title">Heading Counts</h3>
    <div class="counts">
      {#each Object.entries(data.counts) as [tag, count]}
        <div class="count-item">
          <span class="count-tag" style="background: {headingColors[tag.toUpperCase()] || 'var(--accent-color)'}22; color: {headingColors[tag.toUpperCase()] || 'var(--accent-color)'}; border: 1px solid {headingColors[tag.toUpperCase()] || 'var(--accent-color)'}44">{tag.toUpperCase()}</span>
          <span class="count-value">{count}</span>
        </div>
      {/each}
    </div>
  </section>

  <section class="section">
    <h3 class="section-title">Heading Hierarchy</h3>
    <p class="hint">Click a heading to scroll to it on the page</p>
    <TreeView nodes={treeNodes} onNodeClick={scrollToHeading} />
  </section>
</div>

<style>
  .headings { display: flex; flex-direction: column; gap: 4px; }
  .warnings {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-bottom: 1px solid var(--border-color);
  }
  .warning-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .section { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
  .section-title {
    color: var(--text-secondary); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;
  }
  .hint { color: var(--text-muted); font-size: 11px; margin-bottom: 8px; }
  .counts { display: flex; gap: 16px; }
  .count-item { display: flex; align-items: center; gap: 4px; }
  .count-tag {
    background: var(--bg-active); color: var(--accent-color);
    padding: 0 4px; border-radius: 2px; font-size: 11px; font-weight: 600;
    font-family: var(--font-mono);
  }
  .count-value { color: var(--text-primary); font-size: 12px; }
</style>
