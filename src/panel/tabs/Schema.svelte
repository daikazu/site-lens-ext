<script lang="ts">
  import type { SchemaData, SchemaItem } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import CodeBlock from '../components/CodeBlock.svelte';

  interface Props {
    data: SchemaData;
  }

  let { data }: Props = $props();

  type SchemaObject = Record<string, unknown>;

  function isObject(value: unknown): value is SchemaObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function formatPrimitive(value: unknown): string {
    if (value === null || value === undefined || value === '') return '(empty)';
    return String(value);
  }

  function typeLabel(obj: SchemaObject): string {
    const type = obj['@type'];
    if (Array.isArray(type)) return type.join(', ');
    return typeof type === 'string' ? type : '';
  }

  // Skip @context everywhere, and @type when it is already shown in the parent's header.
  function entries(obj: SchemaObject, skipType: boolean): [string, unknown][] {
    return Object.entries(obj).filter(([k]) => k !== '@context' && !(skipType && k === '@type'));
  }

  let testStatus = $state<{ target: number | 'all'; message: string } | null>(null);

  function itemCode(item: SchemaItem): string {
    const body = item.issues.length === 0 ? JSON.stringify(item.parsed, null, 2) : item.raw;
    // Split the closing tag so it doesn't terminate this component's <script> block.
    return `<script type="application/ld+json">\n${body}\n<${'/'}script>`;
  }

  const jsonLdItems = $derived(data.items.filter((i) => i.format === 'json-ld'));

  // Copy to the clipboard as a fallback in case Google's editor markup changes and the fill fails.
  async function testInGoogle(items: SchemaItem[], target: number | 'all') {
    const code = items.map(itemCode).join('\n\n');
    try { await navigator.clipboard.writeText(code); } catch { /* clipboard may be unavailable */ }
    testStatus = { target, message: 'Opening…' };
    const res = await chrome.runtime.sendMessage({ type: 'OPEN_RICH_RESULTS_TEST', code });
    testStatus = {
      target,
      message: res?.ok && res.filled ? 'Opened — click "Test code"' : 'Could not auto-fill — code copied, paste it in',
    };
    setTimeout(() => { if (testStatus?.target === target) testStatus = null; }, 4000);
  }

  function graphNodes(parsed: SchemaObject): SchemaObject[] | null {
    const graph = parsed['@graph'];
    return Array.isArray(graph) ? graph.filter(isObject) : null;
  }
</script>

{#snippet property(key: string, value: unknown)}
  {#if isObject(value)}
    <details class="node" open>
      <summary class="node-summary">
        <span class="prop-key">{key}</span>
        {#if typeLabel(value)}<span class="node-type">{typeLabel(value)}</span>{/if}
      </summary>
      <div class="node-children">
        {#each entries(value, true) as [k, v]}
          {@render property(k, v)}
        {/each}
      </div>
    </details>
  {:else if Array.isArray(value) && value.some(isObject)}
    <details class="node" open>
      <summary class="node-summary">
        <span class="prop-key">{key}</span>
        <span class="node-count">{value.length} items</span>
      </summary>
      <div class="node-children">
        {#each value as v, i}
          {@render property(`[${i}]`, v)}
        {/each}
      </div>
    </details>
  {:else if Array.isArray(value)}
    <div class="prop-row">
      <span class="prop-key">{key}</span>
      <span class="prop-value prop-list">
        {#each value as v}<span>{formatPrimitive(v)}</span>{/each}
        {#if value.length === 0}<span>(empty)</span>{/if}
      </span>
    </div>
  {:else}
    <div class="prop-row">
      <span class="prop-key">{key}</span>
      <span class="prop-value">{formatPrimitive(value)}</span>
    </div>
  {/if}
{/snippet}

<div class="schema-tab">
  {#if jsonLdItems.length > 0}
    <div class="toolbar">
      <button class="test-btn" onclick={() => testInGoogle(jsonLdItems, 'all')}>
        Test all JSON-LD in Rich Results Test ↗
      </button>
      {#if testStatus?.target === 'all'}<span class="test-status">{testStatus.message}</span>{/if}
    </div>
  {/if}

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

  {#each data.items as item, i}
    <section class="schema-item">
      <div class="schema-header">
        <span class="schema-type">{item.type}</span>
        <Badge type="info" label={item.format} />
        {#if item.issues.length > 0}
          <Badge type="error" label="{item.issues.length} issue(s)" />
        {:else}
          <Badge type="success" label="Valid" />
        {/if}
        {#if item.format === 'json-ld'}
          <span class="header-actions">
            {#if testStatus?.target === i}<span class="test-status">{testStatus.message}</span>{/if}
            <button class="test-btn" onclick={() => testInGoogle([item], i)}>Test in Google ↗</button>
          </span>
        {/if}
      </div>

      {#if item.issues.length > 0}
        <div class="issues">
          {#each item.issues as issue}
            <div class="issue-row">
              <Badge type="error" label="Error" />
              <span>{issue}</span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="property-list">
        {#if graphNodes(item.parsed)}
          {#each graphNodes(item.parsed) ?? [] as node}
            <details class="entity" open>
              <summary class="entity-summary">
                <span class="entity-type">{typeLabel(node) || 'Thing'}</span>
                {#if typeof node['@id'] === 'string'}<span class="entity-id">{node['@id']}</span>{/if}
              </summary>
              <div class="node-children">
                {#each entries(node, true) as [key, value]}
                  {@render property(key, value)}
                {/each}
              </div>
            </details>
          {/each}
        {:else}
          {#each entries(item.parsed, item.format === 'json-ld') as [key, value]}
            {@render property(key, value)}
          {/each}
        {/if}
      </div>

      <details class="json-details">
        <summary class="json-summary">View JSON</summary>
        <CodeBlock code={JSON.stringify(item.parsed, null, 2)} language="json" />
      </details>
    </section>
  {/each}

  {#if data.items.length === 0}
    <p class="empty">No structured data found</p>
  {/if}
</div>

<style>
  .schema-tab { display: flex; flex-direction: column; gap: 4px; }
  .warnings { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border-color); }
  .warning-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .schema-item { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
  .schema-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .toolbar {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; border-bottom: 1px solid var(--border-color);
  }
  .header-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .test-btn {
    background: none; border: 1px solid var(--border-color); color: var(--text-secondary);
    font-size: 11px; padding: 2px 8px; border-radius: 3px; cursor: pointer;
  }
  .test-btn:hover { color: var(--text-primary); border-color: var(--text-secondary); }
  .test-status { color: var(--text-muted); font-size: 11px; }
  .schema-type { color: var(--text-primary); font-weight: 600; font-size: 13px; }
  .issues { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
  .issue-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .property-list { display: flex; flex-direction: column; gap: 1px; margin-bottom: 8px; }
  .prop-row {
    display: flex; gap: 12px; padding: 3px 8px; font-size: 12px;
    border-radius: 2px;
  }
  .prop-row:hover { background: var(--bg-hover); }
  .prop-key {
    color: var(--accent-color); font-family: var(--font-mono);
    min-width: 160px; flex-shrink: 0; font-size: 11px;
  }
  .prop-value {
    color: var(--text-primary); word-break: break-word;
  }
  .prop-list { display: flex; flex-direction: column; }
  .node-summary, .entity-summary {
    display: flex; align-items: center; gap: 8px; padding: 3px 8px;
    font-size: 12px; cursor: pointer; border-radius: 2px; user-select: none;
  }
  .node-summary:hover, .entity-summary:hover { background: var(--bg-hover); }
  .node-summary .prop-key { min-width: 0; }
  .node-type {
    color: var(--text-secondary); font-size: 11px; font-weight: 600;
  }
  .node-count { color: var(--text-muted); font-size: 11px; }
  .node-children {
    margin-left: 12px; padding-left: 8px;
    border-left: 1px solid var(--border-color);
    display: flex; flex-direction: column; gap: 1px;
  }
  .entity {
    border: 1px solid var(--border-color); border-radius: 4px;
    padding: 4px 0; margin-bottom: 6px;
  }
  .entity-type { color: var(--text-primary); font-weight: 600; }
  .entity-id {
    color: var(--text-muted); font-family: var(--font-mono); font-size: 11px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .json-details { margin-top: 4px; }
  .json-summary {
    color: var(--text-muted); font-size: 11px; cursor: pointer;
    padding: 4px 0; user-select: none;
  }
  .json-summary:hover { color: var(--text-secondary); }
  .empty { color: var(--text-muted); padding: 24px; text-align: center; }
</style>
