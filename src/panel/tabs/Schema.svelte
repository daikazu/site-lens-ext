<script lang="ts">
  import type { SchemaData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import CodeBlock from '../components/CodeBlock.svelte';

  interface Props {
    data: SchemaData;
  }

  let { data }: Props = $props();

  function formatValue(value: unknown, depth: number = 0): string {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function flattenSchema(obj: Record<string, unknown>, prefix: string = ''): { key: string; value: string; isNested: boolean }[] {
    const rows: { key: string; value: string; isNested: boolean }[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (key === '@context') continue;
      const label = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        rows.push({ key: label, value: '', isNested: true });
        rows.push(...flattenSchema(value as Record<string, unknown>, label));
      } else {
        rows.push({ key: label, value: formatValue(value), isNested: false });
      }
    }
    return rows;
  }
</script>

<div class="schema-tab">
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
        {#each flattenSchema(item.parsed) as row}
          {#if row.isNested}
            <div class="prop-row prop-nested">
              <span class="prop-key">{row.key}</span>
            </div>
          {:else}
            <div class="prop-row">
              <span class="prop-key">{row.key}</span>
              <span class="prop-value">{row.value}</span>
            </div>
          {/if}
        {/each}
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
  .prop-nested .prop-key {
    color: var(--text-secondary); font-weight: 600;
    font-size: 11px; padding-top: 6px;
  }
  .json-details { margin-top: 4px; }
  .json-summary {
    color: var(--text-muted); font-size: 11px; cursor: pointer;
    padding: 4px 0; user-select: none;
  }
  .json-summary:hover { color: var(--text-secondary); }
  .empty { color: var(--text-muted); padding: 24px; text-align: center; }
</style>
