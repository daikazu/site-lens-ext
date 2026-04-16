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

  type SortKey = 'src' | 'source' | 'alt' | 'width' | 'height' | 'loading';
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
      const av = (a as Record<string, unknown>)[key];
      const bv = (b as Record<string, unknown>)[key];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });

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

<div class="table-wrapper">
  <table>
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
        <th class="col-thumb">Preview</th>
        <th class="col-source" onclick={() => toggleSort('source')}>
          Source{#if sortKey === 'source'}<span class="sort-arrow">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>{/if}
        </th>
        <th class="col-src" onclick={() => toggleSort('src')}>
          Source URL{#if sortKey === 'src'}<span class="sort-arrow">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>{/if}
        </th>
        <th class="col-alt" onclick={() => toggleSort('alt')}>
          Alt{#if sortKey === 'alt'}<span class="sort-arrow">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>{/if}
        </th>
        <th class="col-num" onclick={() => toggleSort('width')}>W</th>
        <th class="col-num" onclick={() => toggleSort('height')}>H</th>
        <th class="col-loading" onclick={() => toggleSort('loading')}>Loading</th>
        <th class="col-issues">Issues</th>
      </tr>
    </thead>
    <tbody>
      {#each sortedItems as item (item.source + '|' + item.src)}
        <tr>
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
          <td class="col-source"><span class="src-badge src-{item.source}">{SOURCE_LABEL[item.source]}</span></td>
          <td class="col-src clickable" onclick={() => onScrollTo(item)}>
            {item.src.length > 80 ? item.src.slice(0, 80) + '\u2026' : item.src}
          </td>
          <td class="col-alt">{item.alt || ''}</td>
          <td class="col-num">{item.width ?? ''}</td>
          <td class="col-num">{item.height ?? ''}</td>
          <td class="col-loading">{item.loading ?? ''}</td>
          <td class="col-issues">{item.issues.join(', ')}</td>
        </tr>
      {/each}
      {#if sortedItems.length === 0}
        <tr><td colspan="9" class="empty">No images match the current filters</td></tr>
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
    border-collapse: collapse;
    font-size: 12px;
    font-family: var(--font-mono);
  }
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
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-primary);
    word-break: break-all;
    vertical-align: middle;
  }
  td.clickable { cursor: pointer; }
  td.clickable:hover { color: var(--info-color); }
  .col-select { width: 24px; text-align: center; padding: 4px; }
  .col-thumb { width: 64px; padding: 2px; }
  .col-source { width: 80px; }
  .col-num { width: 48px; text-align: right; }
  .col-loading { width: 80px; }
  .col-issues { color: var(--warning-color); }

  .thumb-btn {
    display: block;
    width: 56px;
    height: 56px;
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
