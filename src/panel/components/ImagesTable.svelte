<script lang="ts">
  import type { ImageItem, ImageSource } from '../../shared/types';

  interface Props {
    items: ImageItem[];
    selectedSrcs: Set<string>;
    onToggleRow: (item: ImageItem) => void;
    onToggleAll: (allSelected: boolean) => void;
    onScrollTo: (item: ImageItem) => void;
  }

  let { items, selectedSrcs, onToggleRow, onToggleAll, onScrollTo }: Props = $props();

  type SortKey = 'src' | 'alt' | 'size' | 'loading' | 'issues';
  let sortKey = $state<SortKey | null>(null);
  let sortDir = $state<'asc' | 'desc'>('asc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
  }

  let sortedItems = $derived.by(() => {
    if (!sortKey) return items;
    const key = sortKey;
    return [...items].sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });

  function sortValue(item: ImageItem, key: SortKey): string | number | null {
    if (key === 'size') return item.width && item.height ? item.width * item.height : null;
    if (key === 'issues') return item.issues.length;
    return item[key];
  }

  // Split a URL into a readable name (last path segment) and its location (host + directory).
  function splitUrl(src: string): { name: string; location: string } {
    if (src.startsWith('data:')) return { name: src.slice(0, src.indexOf(',') + 1 || 30), location: 'inline data URI' };
    try {
      const url = new URL(src);
      const segments = url.pathname.split('/').filter(Boolean);
      const last = segments.pop() ?? url.hostname;
      let name = last;
      try { name = decodeURIComponent(last); } catch { /* keep raw */ }
      return { name: name + url.search, location: url.hostname + '/' + segments.join('/') };
    } catch {
      return { name: src, location: '' };
    }
  }

  let allSelected = $derived(items.length > 0 && items.every((i) => selectedSrcs.has(i.src)));

  const SOURCE_LABEL: Record<ImageSource, string> = {
    img: 'img',
    picture: 'picture',
    'css-bg': 'css-bg',
    svg: 'svg',
    'video-poster': 'poster',
    favicon: 'favicon',
    meta: 'meta',
  };
</script>

{#snippet sortHeader(key: SortKey, label: string, cls: string)}
  <th class={cls} onclick={() => toggleSort(key)}>
    {label}{#if sortKey === key}<span class="sort-arrow">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>{/if}
  </th>
{/snippet}

<div class="table-wrapper">
  <table>
    <colgroup>
      <col class="w-select" />
      <col class="w-thumb" />
      <col class="w-image" />
      <col class="w-alt" />
      <col class="w-size" />
      <col class="w-loading" />
      <col class="w-issues" />
    </colgroup>
    <thead>
      <tr>
        <th class="col-select">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={items.length === 0}
            onchange={() => onToggleAll(allSelected)}
            aria-label="Select all"
          />
        </th>
        <th class="col-thumb"></th>
        {@render sortHeader('src', 'Image', '')}
        {@render sortHeader('alt', 'Alt text', '')}
        {@render sortHeader('size', 'Size', 'col-size')}
        {@render sortHeader('loading', 'Loading', '')}
        {@render sortHeader('issues', 'Issues', '')}
      </tr>
    </thead>
    <tbody>
      {#each sortedItems as item (item.source + '|' + item.src)}
        {@const url = splitUrl(item.src)}
        <tr class:has-issues={item.issues.length > 0}>
          <td class="col-select">
            <input
              type="checkbox"
              checked={selectedSrcs.has(item.src)}
              onchange={() => onToggleRow(item)}
              onclick={(e) => e.stopPropagation()}
              aria-label="Select image"
            />
          </td>
          <td class="col-thumb">
            <button class="thumb-btn" onclick={() => onScrollTo(item)} title="Scroll to image">
              <img
                src={item.src}
                loading="lazy"
                alt=""
                onerror={(e) => { (e.currentTarget as HTMLImageElement).classList.add('broken'); }}
              />
            </button>
          </td>
          <td class="col-image" title={item.src}>
            <button class="image-name" onclick={() => onScrollTo(item)}>
              <span class="src-badge src-{item.source}">{SOURCE_LABEL[item.source]}</span>
              <span class="truncate">{url.name}</span>
            </button>
            {#if url.location}<div class="image-location truncate">{url.location}</div>{/if}
          </td>
          <td class="col-alt">
            {#if item.alt}{item.alt}{:else}<span class="muted">—</span>{/if}
          </td>
          <td class="col-size">
            {#if item.width && item.height}{item.width} × {item.height}{:else}<span class="muted">—</span>{/if}
          </td>
          <td class="col-loading">
            {#if item.loading}{item.loading}{:else}<span class="muted">default</span>{/if}
          </td>
          <td class="col-issues">
            {#if item.issues.length > 0}
              <div class="issue-list">
                {#each item.issues as issue}
                  <span class="issue-pill">{issue}</span>
                {/each}
              </div>
            {/if}
          </td>
        </tr>
      {/each}
      {#if sortedItems.length === 0}
        <tr><td colspan="7" class="empty">No images match the current filters</td></tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .table-wrapper {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: 4px;
  }
  table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 12px;
    font-family: var(--font-system);
  }
  .w-select { width: 32px; }
  .w-thumb { width: 56px; }
  .w-image { width: 30%; }
  .w-alt { width: 25%; }
  .w-size { width: 96px; }
  .w-loading { width: 72px; }
  .w-issues { width: 28%; }
  thead { position: sticky; top: 0; z-index: 1; }
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
  th.col-select, th.col-thumb { cursor: default; }
  th:hover { color: var(--text-primary); }
  .sort-arrow { font-size: 9px; margin-left: 4px; }
  td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-primary);
    vertical-align: middle;
    overflow-wrap: anywhere;
  }
  tbody tr:hover { background: var(--bg-hover); }
  .col-select { text-align: center; padding: 4px; }
  .col-thumb { padding: 4px; }
  .col-size { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .col-loading { white-space: nowrap; }
  .muted { color: var(--text-muted); }

  .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .image-name {
    display: flex; align-items: center; gap: 6px; width: 100%;
    background: none; border: none; padding: 0; cursor: pointer;
    color: var(--text-primary); font: inherit; text-align: left;
  }
  .image-name:hover .truncate { color: var(--info-color); }
  .image-location {
    color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; margin-top: 2px;
  }

  .issue-list { display: flex; flex-wrap: wrap; gap: 4px; }
  .issue-pill {
    padding: 2px 6px;
    line-height: 1.3;
    border-radius: 3px;
    font-size: 11px;
    color: var(--warning-color);
    background: rgba(204, 167, 0, 0.12);
    border: 1px solid rgba(204, 167, 0, 0.3);
    overflow-wrap: normal;
  }

  .thumb-btn {
    display: block;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: #1a1a1a;
    cursor: pointer;
    overflow: hidden;
  }
  .thumb-btn img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .thumb-btn img.broken {
    background: repeating-linear-gradient(45deg, #2a2a2a, #2a2a2a 4px, #1a1a1a 4px, #1a1a1a 8px);
  }

  .src-badge {
    display: inline-block;
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-family: var(--font-system);
    font-weight: 500;
    background: rgba(255,255,255,0.06);
    color: var(--text-secondary);
  }
  .src-img       { background: rgba(117, 190, 255, 0.18); color: #75beff; }
  .src-picture   { background: rgba(78, 201, 176, 0.18);  color: #4ec9b0; }
  .src-css-bg    { background: rgba(204, 167, 0, 0.18);   color: #cca700; }
  .src-svg       { background: rgba(197, 134, 192, 0.18); color: #c586c0; }
  .src-video-poster { background: rgba(241, 76, 76, 0.18); color: #f14c4c; }
  .src-favicon   { background: rgba(206, 145, 120, 0.18); color: #ce9178; }
  .src-meta      { background: rgba(150, 150, 150, 0.18); color: #aaa; }

  .empty { text-align: center; color: var(--text-muted); padding: 16px; }
</style>
