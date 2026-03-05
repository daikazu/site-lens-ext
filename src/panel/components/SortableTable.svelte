<script lang="ts">
  interface Column {
    key: string;
    label: string;
    width?: string;
    render?: (value: unknown, row: Record<string, unknown>) => string;
  }

  interface Props {
    columns: Column[];
    rows: Record<string, unknown>[];
    maxHeight?: string;
    onRowClick?: (row: Record<string, unknown>) => void;
  }

  let { columns, rows, maxHeight = '400px', onRowClick }: Props = $props();

  let sortKey = $state<string | null>(null);
  let sortDir = $state<'asc' | 'desc'>('asc');

  function toggleSort(key: string) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
  }

  let sortedRows = $derived.by(() => {
    if (!sortKey) return rows;
    const key = sortKey;
    return [...rows].sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });
</script>

<div class="table-wrapper" style="max-height: {maxHeight}">
  <table>
    <thead>
      <tr>
        {#each columns as col}
          <th
            style={col.width ? `width: ${col.width}` : ''}
            onclick={() => toggleSort(col.key)}
          >
            {col.label}
            {#if sortKey === col.key}
              <span class="sort-arrow">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
            {/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each sortedRows as row}
        <tr class:clickable={!!onRowClick} onclick={() => onRowClick?.(row)}>
          {#each columns as col}
            <td>{col.render ? col.render(row[col.key], row) : row[col.key] ?? ''}</td>
          {/each}
        </tr>
      {/each}
      {#if sortedRows.length === 0}
        <tr><td colspan={columns.length} class="empty">No data</td></tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .table-wrapper {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    font-family: var(--font-mono);
  }
  thead {
    position: sticky;
    top: 0;
    z-index: 1;
  }
  th {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-color);
    cursor: pointer;
    user-select: none;
    font-weight: 500;
    white-space: nowrap;
  }
  th:hover { color: var(--text-primary); }
  .sort-arrow { font-size: 9px; margin-left: 4px; }
  td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-primary);
    word-break: break-all;
  }
  tr:hover td { background: var(--bg-hover); }
  tr.clickable { cursor: pointer; }
  .empty { text-align: center; color: var(--text-muted); padding: 16px; }
</style>
