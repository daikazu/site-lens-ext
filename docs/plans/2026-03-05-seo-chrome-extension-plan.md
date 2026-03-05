# SEO Chrome DevTools Extension - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome DevTools extension that provides comprehensive on-page SEO analysis with a dark-themed tabbed UI.

**Architecture:** Svelte 5 panel app communicates with a content script via Chrome messaging. The content script analyzes the DOM and returns structured data. A service worker handles network requests (deep scan, robots.txt/sitemap fetching) to avoid CORS. The panel renders results in 7 tabs: Overview, Headings, Content, Links, Images, Schema, Technical.

**Tech Stack:** Svelte 5, Vite, TypeScript, Chrome Extensions Manifest V3

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `manifest.json`
- Create: `src/devtools/devtools.html`
- Create: `src/devtools/devtools.ts`
- Create: `src/panel/panel.html`
- Create: `src/panel/main.ts`
- Create: `src/panel/App.svelte`
- Create: `src/panel/styles/devtools-theme.css`
- Create: `src/content/analyzer.ts`
- Create: `src/background/service-worker.ts`
- Create: `src/shared/types.ts`
- Create: `public/icons/icon16.png`
- Create: `public/icons/icon48.png`
- Create: `public/icons/icon128.png`

**Step 1: Initialize the project**

```bash
cd /Users/mikewall/Code/seo-tools
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install -D svelte @sveltejs/vite-plugin-svelte vite typescript @tsconfig/svelte
```

**Step 3: Create `tsconfig.json`**

```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["chrome"]
  },
  "include": ["src/**/*", "src/**/*.svelte"]
}
```

Then install chrome types:

```bash
npm install -D @types/chrome
```

**Step 4: Create `vite.config.ts`**

Chrome extensions need multiple entry points built separately. We use a custom Vite config that builds the panel as an app, and the content script + service worker as plain scripts.

```typescript
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: resolve(__dirname, 'src/panel/panel.html'),
        devtools: resolve(__dirname, 'src/devtools/devtools.html'),
        content: resolve(__dirname, 'src/content/analyzer.ts'),
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
```

**Step 5: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "SEO Analyzer",
  "version": "1.0.0",
  "description": "On-page SEO analysis in Chrome DevTools",
  "devtools_page": "src/devtools/devtools.html",
  "permissions": ["activeTab", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**Step 6: Create `src/devtools/devtools.html`**

```html
<!DOCTYPE html>
<html>
  <head></head>
  <body>
    <script src="devtools.ts" type="module"></script>
  </body>
</html>
```

**Step 7: Create `src/devtools/devtools.ts`**

```typescript
chrome.devtools.panels.create(
  'SEO',
  'icons/icon16.png',
  'src/panel/panel.html',
  (panel) => {
    console.log('SEO panel created');
  }
);
```

**Step 8: Create `src/panel/panel.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SEO Panel</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="main.ts"></script>
  </body>
</html>
```

**Step 9: Create `src/panel/main.ts`**

```typescript
import { mount } from 'svelte';
import App from './App.svelte';
import './styles/devtools-theme.css';

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
```

**Step 10: Create `src/panel/App.svelte`**

Minimal shell with tab bar. Tabs will be wired up in later tasks.

```svelte
<script lang="ts">
  import type { AnalysisResult } from '../shared/types';

  const tabs = ['Overview', 'Headings', 'Content', 'Links', 'Images', 'Schema', 'Technical'] as const;
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

  // Auto-analyze on load
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
      <p class="placeholder">Tab: {activeTab} - content coming soon</p>
    {:else}
      <p class="placeholder">Open a page to analyze</p>
    {/if}
  </main>
</div>
```

**Step 11: Create `src/panel/styles/devtools-theme.css`**

```css
:root {
  --bg-primary: #1e1e1e;
  --bg-secondary: #252526;
  --bg-hover: #2a2d2e;
  --bg-active: #37373d;
  --text-primary: #e8e8e8;
  --text-secondary: #a0a0a0;
  --text-muted: #6a6a6a;
  --border-color: #3c3c3c;
  --accent-color: #4fc1ff;
  --success-color: #4ec9b0;
  --warning-color: #cca700;
  --error-color: #f14c4c;
  --info-color: #75beff;
  --font-mono: 'Menlo', 'Consolas', 'Courier New', monospace;
  --font-system: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-system);
  font-size: 12px;
  line-height: 1.4;
}

#app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.seo-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tab-bar {
  display: flex;
  align-items: center;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  padding: 0 4px;
  flex-shrink: 0;
}

.tab {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-family: var(--font-system);
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}

.tab:hover {
  color: var(--text-primary);
}

.tab.active {
  color: var(--accent-color);
  border-bottom-color: var(--accent-color);
}

.rescan-btn {
  margin-left: auto;
  background: var(--bg-active);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-family: var(--font-system);
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 3px;
  cursor: pointer;
}

.rescan-btn:hover {
  background: var(--bg-hover);
}

.rescan-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.error-message {
  color: var(--error-color);
  padding: 12px;
  background: rgba(241, 76, 76, 0.1);
  border: 1px solid var(--error-color);
  border-radius: 4px;
}

.loading {
  color: var(--text-secondary);
  padding: 24px;
  text-align: center;
}

.placeholder {
  color: var(--text-muted);
  padding: 24px;
  text-align: center;
}
```

**Step 12: Create `src/shared/types.ts`**

```typescript
// --- Overview ---
export interface OverviewData {
  title: { value: string; length: number };
  description: { value: string; length: number };
  keywords: string;
  url: string;
  canonical: { value: string | null; matches: boolean };
  robots: string | null;
  viewport: string | null;
  charset: string | null;
  lang: string | null;
  favicon: string | null;
  redirectChain: string[];
}

// --- Headings ---
export interface HeadingItem {
  tag: string;
  text: string;
  level: number;
}

export interface HeadingsData {
  items: HeadingItem[];
  counts: Record<string, number>;
  warnings: string[];
}

// --- Content ---
export interface ContentData {
  wordCount: number;
  textToHtmlRatio: number;
  readabilityScore: number;
  readabilityGrade: string;
  density: {
    oneWord: { word: string; count: number; percentage: number }[];
    twoWord: { word: string; count: number; percentage: number }[];
    threeWord: { word: string; count: number; percentage: number }[];
  };
}

// --- Links ---
export interface LinkItem {
  href: string;
  anchorText: string;
  rel: string;
  isInternal: boolean;
  isExternal: boolean;
  hasNofollow: boolean;
  statusCode?: number;
  redirectUrl?: string;
  issues: string[];
}

export interface LinksData {
  internal: LinkItem[];
  external: LinkItem[];
  bad: LinkItem[];
  warnings: string[];
  totalCount: number;
}

// --- Images ---
export interface ImageItem {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
  loading: string | null;
  fileSize?: number;
  issues: string[];
}

export interface OgImageData {
  url: string | null;
  width: string | null;
  height: string | null;
  type: string | null;
  alt: string | null;
}

export interface TwitterImageData {
  card: string | null;
  image: string | null;
  imageAlt: string | null;
}

export interface ImagesData {
  items: ImageItem[];
  og: OgImageData;
  twitter: TwitterImageData;
  warnings: string[];
}

// --- Schema ---
export interface SchemaItem {
  type: string;
  format: 'json-ld' | 'microdata' | 'rdfa';
  raw: string;
  parsed: Record<string, unknown>;
  issues: string[];
}

export interface SchemaData {
  items: SchemaItem[];
  warnings: string[];
}

// --- Technical ---
export interface TechnicalData {
  robotsTxt: { exists: boolean; content: string | null };
  sitemap: { exists: boolean; url: string | null; urls: string[] };
  hreflang: { lang: string; url: string }[];
  coreWebVitals: {
    lcp: number | null;
    cls: number | null;
    fid: number | null;
  };
  pageWeight: {
    total: number;
    js: number;
    css: number;
    images: number;
    fonts: number;
    other: number;
  };
  renderBlocking: string[];
  jsRendering: {
    initialElementCount: number;
    renderedElementCount: number;
    diff: number;
  };
}

// --- Combined ---
export interface AnalysisResult {
  overview: OverviewData;
  headings: HeadingsData;
  content: ContentData;
  links: LinksData;
  images: ImagesData;
  schema: SchemaData;
  technical: TechnicalData;
  timestamp: number;
  url: string;
}

// --- Messages ---
export type MessageType =
  | { type: 'ANALYZE_PAGE'; tabId: number }
  | { type: 'DEEP_SCAN_LINKS'; tabId: number; urls: string[] }
  | { type: 'FETCH_ROBOTS'; tabId: number; origin: string }
  | { type: 'FETCH_SITEMAP'; tabId: number; origin: string }
  | { type: 'HIGHLIGHT_LINKS'; tabId: number; mode: HighlightMode }
  | { type: 'CLEAR_HIGHLIGHTS'; tabId: number };

export type HighlightMode = 'internal' | 'external' | 'nofollow' | 'broken' | 'all' | 'none';
```

**Step 13: Create stub `src/content/analyzer.ts`**

```typescript
import type { AnalysisResult } from '../shared/types';

function analyzeOverview(): AnalysisResult['overview'] {
  // Stub - will be implemented in Task 3
  return {} as AnalysisResult['overview'];
}

function analyzePage(): AnalysisResult {
  return {
    overview: analyzeOverview(),
    headings: { items: [], counts: {}, warnings: [] },
    content: { wordCount: 0, textToHtmlRatio: 0, readabilityScore: 0, readabilityGrade: '', density: { oneWord: [], twoWord: [], threeWord: [] } },
    links: { internal: [], external: [], bad: [], warnings: [], totalCount: 0 },
    images: { items: [], og: { url: null, width: null, height: null, type: null, alt: null }, twitter: { card: null, image: null, imageAlt: null }, warnings: [] },
    schema: { items: [], warnings: [] },
    technical: { robotsTxt: { exists: false, content: null }, sitemap: { exists: false, url: null, urls: [] }, hreflang: [], coreWebVitals: { lcp: null, cls: null, fid: null }, pageWeight: { total: 0, js: 0, css: 0, images: 0, fonts: 0, other: 0 }, renderBlocking: [], jsRendering: { initialElementCount: 0, renderedElementCount: 0, diff: 0 } },
    timestamp: Date.now(),
    url: window.location.href,
  };
}

// Listen for analysis requests
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ANALYZE_PAGE') {
    const result = analyzePage();
    sendResponse(result);
  }
  return true;
});
```

**Step 14: Create stub `src/background/service-worker.ts`**

```typescript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_PAGE') {
    // Forward to content script
    chrome.tabs.sendMessage(message.tabId, { type: 'ANALYZE_PAGE' }, (response) => {
      sendResponse(response || { error: 'No response from content script' });
    });
    return true; // async response
  }

  if (message.type === 'FETCH_ROBOTS') {
    fetch(`${message.origin}/robots.txt`)
      .then((res) => (res.ok ? res.text() : null))
      .then((content) => sendResponse({ exists: !!content, content }))
      .catch(() => sendResponse({ exists: false, content: null }));
    return true;
  }

  if (message.type === 'FETCH_SITEMAP') {
    fetch(`${message.origin}/sitemap.xml`)
      .then((res) => (res.ok ? res.text() : null))
      .then((content) => sendResponse({ exists: !!content, content }))
      .catch(() => sendResponse({ exists: false, content: null }));
    return true;
  }

  if (message.type === 'DEEP_SCAN_LINKS') {
    const results: Record<string, { status: number; redirectUrl?: string }> = {};
    Promise.all(
      message.urls.map((url: string) =>
        fetch(url, { method: 'HEAD', redirect: 'follow' })
          .then((res) => {
            results[url] = { status: res.status, redirectUrl: res.url !== url ? res.url : undefined };
          })
          .catch(() => {
            results[url] = { status: 0 };
          })
      )
    ).then(() => sendResponse(results));
    return true;
  }
});
```

**Step 15: Create placeholder icons**

Generate simple colored square PNGs. Use a node script with sharp, or create minimal placeholder files. For development, any small PNG files work.

```bash
mkdir -p public/icons
```

**Step 16: Build and test loading in Chrome**

```bash
npx vite build
```

Go to `chrome://extensions`, enable Developer mode, click "Load unpacked", select the `dist` folder. Open DevTools on any page and verify the "SEO" tab appears with the tab bar UI.

**Step 17: Commit**

```bash
git add -A
git commit -m "feat: scaffold Chrome extension with Svelte 5 + Vite + Manifest V3"
```

---

### Task 2: Shared UI Components

**Files:**
- Create: `src/panel/components/Badge.svelte`
- Create: `src/panel/components/SortableTable.svelte`
- Create: `src/panel/components/TreeView.svelte`
- Create: `src/panel/components/CodeBlock.svelte`

**Step 1: Create `Badge.svelte`**

```svelte
<script lang="ts">
  type BadgeType = 'success' | 'warning' | 'error' | 'info';

  interface Props {
    type: BadgeType;
    label: string;
  }

  let { type, label }: Props = $props();
</script>

<span class="badge badge--{type}">{label}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-family: var(--font-system);
    font-weight: 500;
    line-height: 1.4;
  }
  .badge--success { background: rgba(78, 201, 176, 0.15); color: var(--success-color); }
  .badge--warning { background: rgba(204, 167, 0, 0.15); color: var(--warning-color); }
  .badge--error { background: rgba(241, 76, 76, 0.15); color: var(--error-color); }
  .badge--info { background: rgba(117, 190, 255, 0.15); color: var(--info-color); }
</style>
```

**Step 2: Create `SortableTable.svelte`**

```svelte
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
  }

  let { columns, rows, maxHeight = '400px' }: Props = $props();

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
        <tr>
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
  .empty { text-align: center; color: var(--text-muted); padding: 16px; }
</style>
```

**Step 3: Create `TreeView.svelte`**

```svelte
<script lang="ts">
  interface TreeNode {
    label: string;
    tag?: string;
    children?: TreeNode[];
    data?: Record<string, unknown>;
  }

  interface Props {
    nodes: TreeNode[];
    onNodeClick?: (node: TreeNode) => void;
  }

  let { nodes, onNodeClick }: Props = $props();
</script>

{#snippet nodeSnippet(node: TreeNode, depth: number)}
  <div
    class="tree-node"
    style="padding-left: {depth * 16}px"
    onclick={() => onNodeClick?.(node)}
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === 'Enter' && onNodeClick?.(node)}
  >
    {#if node.tag}
      <span class="tree-tag">{node.tag}</span>
    {/if}
    <span class="tree-label">{node.label}</span>
  </div>
  {#if node.children}
    {#each node.children as child}
      {@render nodeSnippet(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<div class="tree-view">
  {#each nodes as node}
    {@render nodeSnippet(node, 0)}
  {/each}
</div>

<style>
  .tree-view {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .tree-node {
    padding: 3px 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tree-node:hover { background: var(--bg-hover); }
  .tree-tag {
    background: var(--bg-active);
    color: var(--accent-color);
    padding: 0 4px;
    border-radius: 2px;
    font-size: 11px;
    font-weight: 600;
  }
  .tree-label { color: var(--text-primary); }
</style>
```

**Step 4: Create `CodeBlock.svelte`**

```svelte
<script lang="ts">
  interface Props {
    code: string;
    language?: string;
  }

  let { code, language = '' }: Props = $props();

  let copied = $state(false);

  async function copyToClipboard() {
    await navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="code-block">
  <div class="code-header">
    {#if language}<span class="code-lang">{language}</span>{/if}
    <button class="copy-btn" onclick={copyToClipboard}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  </div>
  <pre><code>{code}</code></pre>
</div>

<style>
  .code-block {
    border: 1px solid var(--border-color);
    border-radius: 4px;
    overflow: hidden;
  }
  .code-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--bg-secondary);
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-color);
  }
  .code-lang { color: var(--text-muted); font-size: 11px; }
  .copy-btn {
    background: none;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .copy-btn:hover { color: var(--text-primary); border-color: var(--text-secondary); }
  pre {
    margin: 0;
    padding: 12px;
    overflow-x: auto;
    background: var(--bg-primary);
  }
  code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
```

**Step 5: Build and verify components render**

```bash
npx vite build
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add shared UI components (Badge, SortableTable, TreeView, CodeBlock)"
```

---

### Task 3: Overview Tab - Content Script Analyzer + Panel UI

**Files:**
- Modify: `src/content/analyzer.ts` (implement `analyzeOverview`)
- Create: `src/panel/tabs/Overview.svelte`
- Modify: `src/panel/App.svelte` (wire up Overview tab)

**Step 1: Implement `analyzeOverview` in `src/content/analyzer.ts`**

Replace the stub `analyzeOverview` function:

```typescript
function analyzeOverview(): AnalysisResult['overview'] {
  const title = document.title || '';
  const descMeta = document.querySelector('meta[name="description"]');
  const description = descMeta?.getAttribute('content') || '';
  const keywordsMeta = document.querySelector('meta[name="keywords"]');
  const keywords = keywordsMeta?.getAttribute('content') || '';

  const canonicalLink = document.querySelector('link[rel="canonical"]');
  const canonicalValue = canonicalLink?.getAttribute('href') || null;

  const robotsMeta = document.querySelector('meta[name="robots"]');
  const robots = robotsMeta?.getAttribute('content') || null;

  const viewportMeta = document.querySelector('meta[name="viewport"]');
  const viewport = viewportMeta?.getAttribute('content') || null;

  const charsetMeta = document.querySelector('meta[charset]') || document.querySelector('meta[http-equiv="Content-Type"]');
  const charset = charsetMeta?.getAttribute('charset') || charsetMeta?.getAttribute('content')?.match(/charset=([^\s;]+)/)?.[1] || null;

  const lang = document.documentElement.getAttribute('lang') || null;

  const faviconLink = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
  const favicon = faviconLink?.getAttribute('href') || null;

  return {
    title: { value: title, length: title.length },
    description: { value: description, length: description.length },
    keywords,
    url: window.location.href,
    canonical: {
      value: canonicalValue,
      matches: canonicalValue ? new URL(canonicalValue, window.location.href).href === window.location.href : false,
    },
    robots,
    viewport,
    charset,
    lang,
    favicon,
    redirectChain: [],
  };
}
```

**Step 2: Create `src/panel/tabs/Overview.svelte`**

```svelte
<script lang="ts">
  import type { OverviewData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';

  interface Props {
    data: OverviewData;
  }

  let { data }: Props = $props();

  function titleStatus(len: number): { type: 'success' | 'warning' | 'error'; label: string } {
    if (len === 0) return { type: 'error', label: 'Missing' };
    if (len < 30) return { type: 'warning', label: 'Too short' };
    if (len > 60) return { type: 'warning', label: 'Too long' };
    return { type: 'success', label: 'Good' };
  }

  function descStatus(len: number): { type: 'success' | 'warning' | 'error'; label: string } {
    if (len === 0) return { type: 'error', label: 'Missing' };
    if (len < 70) return { type: 'warning', label: 'Too short' };
    if (len > 160) return { type: 'warning', label: 'Too long' };
    return { type: 'success', label: 'Good' };
  }
</script>

<div class="overview">
  <section class="section">
    <h3 class="section-title">Page Title</h3>
    <div class="field-row">
      <span class="field-value">{data.title.value || '(empty)'}</span>
      <Badge {...titleStatus(data.title.length)} />
      <span class="field-meta">{data.title.length} characters</span>
    </div>
  </section>

  <section class="section">
    <h3 class="section-title">Meta Description</h3>
    <div class="field-row">
      <span class="field-value">{data.description.value || '(empty)'}</span>
      <Badge {...descStatus(data.description.length)} />
      <span class="field-meta">{data.description.length} characters</span>
    </div>
  </section>

  <section class="section">
    <h3 class="section-title">Meta Keywords</h3>
    <div class="field-row">
      <span class="field-value">{data.keywords || '(none)'}</span>
    </div>
  </section>

  <section class="section">
    <h3 class="section-title">URL</h3>
    <div class="field-value mono">{data.url}</div>
  </section>

  <section class="section">
    <h3 class="section-title">Canonical</h3>
    <div class="field-row">
      <span class="field-value mono">{data.canonical.value || '(not set)'}</span>
      {#if data.canonical.value}
        <Badge
          type={data.canonical.matches ? 'success' : 'warning'}
          label={data.canonical.matches ? 'Matches URL' : 'Mismatch'}
        />
      {:else}
        <Badge type="warning" label="Missing" />
      {/if}
    </div>
  </section>

  <section class="section">
    <h3 class="section-title">Meta Robots</h3>
    <div class="field-value">{data.robots || '(not set)'}</div>
  </section>

  <section class="section">
    <h3 class="section-title">Page Meta</h3>
    <div class="meta-grid">
      <div class="meta-item">
        <span class="meta-label">Viewport</span>
        <span class="meta-value">{data.viewport || '(not set)'}</span>
        {#if !data.viewport}<Badge type="error" label="Missing" />{/if}
      </div>
      <div class="meta-item">
        <span class="meta-label">Charset</span>
        <span class="meta-value">{data.charset || '(not set)'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Language</span>
        <span class="meta-value">{data.lang || '(not set)'}</span>
        {#if !data.lang}<Badge type="warning" label="Missing" />{/if}
      </div>
      <div class="meta-item">
        <span class="meta-label">Favicon</span>
        <span class="meta-value">{data.favicon || '(not set)'}</span>
      </div>
    </div>
  </section>

  {#if data.redirectChain.length > 0}
    <section class="section">
      <h3 class="section-title">Redirect Chain</h3>
      {#each data.redirectChain as url, i}
        <div class="redirect-step">
          <span class="redirect-num">{i + 1}.</span>
          <span class="field-value mono">{url}</span>
        </div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .overview { display: flex; flex-direction: column; gap: 4px; }
  .section {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-color);
  }
  .section-title {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  .field-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .field-value { color: var(--text-primary); font-size: 12px; }
  .field-value.mono { font-family: var(--font-mono); }
  .field-meta { color: var(--text-muted); font-size: 11px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .meta-label { color: var(--text-muted); font-size: 11px; }
  .meta-value { color: var(--text-primary); font-size: 12px; font-family: var(--font-mono); }
  .redirect-step { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
  .redirect-num { color: var(--text-muted); font-size: 11px; }
</style>
```

**Step 3: Update `App.svelte` to render Overview tab**

Add the import and conditional rendering for the Overview tab in the `{#if analysisData}` block:

```svelte
<!-- In the script tag, add import: -->
import Overview from './tabs/Overview.svelte';

<!-- Replace the placeholder paragraph with: -->
{#if activeTab === 'Overview'}
  <Overview data={analysisData.overview} />
{:else}
  <p class="placeholder">Tab: {activeTab} - content coming soon</p>
{/if}
```

**Step 4: Build and test**

```bash
npx vite build
```

Reload extension in Chrome. Open DevTools on any page. Verify the Overview tab shows real page data.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: implement Overview tab with page title, description, canonical, meta analysis"
```

---

### Task 4: Headings Tab

**Files:**
- Modify: `src/content/analyzer.ts` (implement `analyzeHeadings`)
- Create: `src/panel/tabs/Headings.svelte`
- Modify: `src/panel/App.svelte` (wire up tab)

**Step 1: Implement `analyzeHeadings` in analyzer.ts**

```typescript
function analyzeHeadings(): AnalysisResult['headings'] {
  const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const items: HeadingItem[] = [];
  const counts: Record<string, number> = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };

  headingEls.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const level = parseInt(tag[1]);
    items.push({ tag, text: el.textContent?.trim() || '', level });
    counts[tag] = (counts[tag] || 0) + 1;
  });

  const warnings: string[] = [];
  if (counts.h1 === 0) warnings.push('No H1 tag found');
  if (counts.h1 > 1) warnings.push(`Multiple H1 tags found (${counts.h1})`);

  // Check for skipped levels
  const levels = items.map((h) => h.level);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      warnings.push(`Skipped heading level: ${items[i - 1].tag.toUpperCase()} to ${items[i].tag.toUpperCase()}`);
    }
  }

  return { items, counts, warnings };
}
```

**Step 2: Create `src/panel/tabs/Headings.svelte`**

```svelte
<script lang="ts">
  import type { HeadingsData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import TreeView from '../components/TreeView.svelte';

  interface Props {
    data: HeadingsData;
    tabId: number;
  }

  let { data, tabId }: Props = $props();

  let treeNodes = $derived(
    data.items.map((h) => ({
      label: h.text || '(empty)',
      tag: h.tag.toUpperCase(),
    }))
  );

  function scrollToHeading(node: { label: string; tag?: string }) {
    if (!node.tag) return;
    const tag = node.tag.toLowerCase();
    const text = node.label;
    // Use chrome.devtools.inspectedWindow to scroll to the heading
    // This is the official Chrome DevTools API for interacting with the inspected page
    chrome.devtools.inspectedWindow.eval(
      `(function() {
        var headings = document.querySelectorAll('${tag}');
        for (var i = 0; i < headings.length; i++) {
          if (headings[i].textContent.trim() === ${JSON.stringify(text)}) {
            headings[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
            headings[i].style.outline = '2px solid #4fc1ff';
            setTimeout(function() { headings[i].style.outline = ''; }, 2000);
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
          <span class="count-tag">{tag.toUpperCase()}</span>
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
```

**Step 3: Wire up in App.svelte**

```svelte
import Headings from './tabs/Headings.svelte';

<!-- Add to the tab content conditional: -->
{:else if activeTab === 'Headings'}
  <Headings data={analysisData.headings} tabId={chrome.devtools.inspectedWindow.tabId} />
```

**Step 4: Build and test**

```bash
npx vite build
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: implement Headings tab with hierarchy tree, counts, and click-to-scroll"
```

---

### Task 5: Content Tab

**Files:**
- Modify: `src/content/analyzer.ts` (implement `analyzeContent`)
- Create: `src/panel/tabs/Content.svelte`
- Modify: `src/panel/App.svelte` (wire up tab)

**Step 1: Implement `analyzeContent` in analyzer.ts**

```typescript
function analyzeContent(): AnalysisResult['content'] {
  const body = document.body;
  const text = body?.innerText || '';
  const html = document.documentElement.outerHTML;

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;

  // Text-to-HTML ratio
  const textLength = text.length;
  const htmlLength = html.length;
  const textToHtmlRatio = htmlLength > 0 ? Math.round((textLength / htmlLength) * 100) : 0;

  // Readability (Flesch-Kincaid)
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentenceCount = Math.max(sentences.length, 1);
  const syllableCount = words.reduce((sum, word) => sum + countSyllables(word), 0);

  const fleschScore = Math.round(
    206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (syllableCount / Math.max(wordCount, 1))
  );
  const grade = getReadabilityGrade(fleschScore);

  // Word density
  const lowerWords = words.map((w) => w.toLowerCase().replace(/[^a-z0-9'-]/g, '')).filter((w) => w.length > 1);
  const stopWords = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
    'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
    'when', 'make', 'can', 'like', 'no', 'just', 'him', 'know', 'take', 'people',
    'into', 'year', 'your', 'some', 'could', 'them', 'see', 'other', 'than', 'then',
    'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after',
    'use', 'two', 'how', 'our', 'way', 'even', 'new', 'want', 'because', 'any',
    'these', 'give', 'most', 'us', 'is', 'are', 'was', 'were', 'been', 'has',
    'had', 'did', 'am'
  ]);
  const filteredWords = lowerWords.filter((w) => !stopWords.has(w));

  const oneWord = getNgramDensity(filteredWords, 1, wordCount);
  const twoWord = getNgramDensity(lowerWords, 2, wordCount);
  const threeWord = getNgramDensity(lowerWords, 3, wordCount);

  return {
    wordCount,
    textToHtmlRatio,
    readabilityScore: Math.max(0, Math.min(100, fleschScore)),
    readabilityGrade: grade,
    density: { oneWord, twoWord, threeWord },
  };
}

function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

function getReadabilityGrade(score: number): string {
  if (score >= 90) return 'Very Easy';
  if (score >= 80) return 'Easy';
  if (score >= 70) return 'Fairly Easy';
  if (score >= 60) return 'Standard';
  if (score >= 50) return 'Fairly Difficult';
  if (score >= 30) return 'Difficult';
  return 'Very Difficult';
}

function getNgramDensity(
  words: string[],
  n: number,
  totalWords: number
): { word: string; count: number; percentage: number }[] {
  const freq: Record<string, number> = {};
  for (let i = 0; i <= words.length - n; i++) {
    const gram = words.slice(i, i + n).join(' ');
    freq[gram] = (freq[gram] || 0) + 1;
  }
  return Object.entries(freq)
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 50)
    .map(([word, count]) => ({
      word,
      count,
      percentage: Math.round((count / Math.max(totalWords, 1)) * 10000) / 100,
    }));
}
```

**Step 2: Create `src/panel/tabs/Content.svelte`**

```svelte
<script lang="ts">
  import type { ContentData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import SortableTable from '../components/SortableTable.svelte';

  interface Props {
    data: ContentData;
  }

  let { data }: Props = $props();

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
    <SortableTable columns={densityColumns} rows={data.density[activeDensityTab]} />
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
```

**Step 3: Wire up in App.svelte**

```svelte
import Content from './tabs/Content.svelte';

{:else if activeTab === 'Content'}
  <Content data={analysisData.content} />
```

**Step 4: Build and test**

```bash
npx vite build
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: implement Content tab with word count, readability, and word density"
```

---

### Task 6: Links Tab

**Files:**
- Modify: `src/content/analyzer.ts` (implement `analyzeLinks`)
- Create: `src/content/highlighter.ts`
- Create: `src/panel/tabs/Links.svelte`
- Modify: `src/panel/App.svelte` (wire up tab)

**Step 1: Implement `analyzeLinks` in analyzer.ts**

```typescript
function analyzeLinks(): AnalysisResult['links'] {
  const links = document.querySelectorAll('a[href]');
  const currentOrigin = window.location.origin;
  const internal: LinkItem[] = [];
  const external: LinkItem[] = [];
  const bad: LinkItem[] = [];

  links.forEach((el) => {
    const href = el.getAttribute('href') || '';
    const anchorText = el.textContent?.trim() || '';
    const rel = el.getAttribute('rel') || '';
    const hasNofollow = rel.includes('nofollow');

    const issues: string[] = [];

    // Detect bad links
    const isBad =
      href === '' ||
      href === '#' ||
      href.startsWith('javascript:') ||
      href === 'about:blank';

    if (isBad) {
      if (href === '' || href === '#') issues.push('Empty or fragment-only href');
      if (href.startsWith('javascript:')) issues.push('JavaScript href');
      bad.push({ href, anchorText, rel, isInternal: false, isExternal: false, hasNofollow, issues });
      return;
    }

    if (!anchorText && !el.querySelector('img')) {
      issues.push('No anchor text');
    }

    try {
      const url = new URL(href, window.location.href);
      const isInt = url.origin === currentOrigin;

      const item: LinkItem = {
        href: url.href,
        anchorText,
        rel,
        isInternal: isInt,
        isExternal: !isInt,
        hasNofollow,
        issues,
      };

      if (isInt) {
        internal.push(item);
      } else {
        if (!hasNofollow) issues.push('External link without nofollow');
        external.push(item);
      }
    } catch {
      issues.push('Malformed URL');
      bad.push({ href, anchorText, rel, isInternal: false, isExternal: false, hasNofollow, issues });
    }
  });

  const warnings: string[] = [];
  const totalCount = internal.length + external.length + bad.length;
  if (totalCount > 100) warnings.push(`High link count: ${totalCount} links on page`);
  if (bad.length > 0) warnings.push(`${bad.length} problematic link(s) found`);

  // Check for duplicates
  const hrefCounts: Record<string, number> = {};
  [...internal, ...external].forEach((l) => {
    hrefCounts[l.href] = (hrefCounts[l.href] || 0) + 1;
  });
  const dupes = Object.entries(hrefCounts).filter(([, c]) => c > 1);
  if (dupes.length > 0) warnings.push(`${dupes.length} duplicate link(s) found`);

  return { internal, external, bad, warnings, totalCount };
}
```

**Step 2: Create `src/content/highlighter.ts`**

```typescript
import type { HighlightMode } from '../shared/types';

const HIGHLIGHT_CLASS = 'seo-ext-highlight';
const STYLE_ID = 'seo-ext-highlight-styles';

const COLORS: Record<string, string> = {
  internal: '#4ec9b0',
  external: '#f14c4c',
  nofollow: '#cca700',
  broken: '#ff8c00',
};

export function highlightLinks(mode: HighlightMode) {
  clearHighlights();

  if (mode === 'none') return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      outline-width: 2px !important;
      outline-style: solid !important;
      outline-offset: 2px !important;
      position: relative !important;
    }
  `;
  document.head.appendChild(style);

  const links = document.querySelectorAll('a[href]');
  const currentOrigin = window.location.origin;

  links.forEach((el) => {
    const href = el.getAttribute('href') || '';
    const rel = el.getAttribute('rel') || '';
    const isBad = href === '' || href === '#' || href.startsWith('javascript:');

    let linkType: string | null = null;

    if (isBad) {
      linkType = 'broken';
    } else {
      try {
        const url = new URL(href, window.location.href);
        if (url.origin === currentOrigin) {
          linkType = 'internal';
        } else {
          linkType = rel.includes('nofollow') ? 'nofollow' : 'external';
        }
      } catch {
        linkType = 'broken';
      }
    }

    if (linkType && (mode === 'all' || mode === linkType)) {
      const color = COLORS[linkType];
      (el as HTMLElement).classList.add(HIGHLIGHT_CLASS);
      (el as HTMLElement).style.outlineColor = color;
    }
  });
}

export function clearHighlights() {
  const existing = document.getElementById(STYLE_ID);
  if (existing) existing.remove();

  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
    (el as HTMLElement).classList.remove(HIGHLIGHT_CLASS);
    (el as HTMLElement).style.outlineColor = '';
  });
}
```

**Step 3: Create `src/panel/tabs/Links.svelte`**

```svelte
<script lang="ts">
  import type { LinksData, HighlightMode } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import SortableTable from '../components/SortableTable.svelte';

  interface Props {
    data: LinksData;
    tabId: number;
  }

  let { data, tabId }: Props = $props();

  let activeSection = $state<'internal' | 'external' | 'bad'>('internal');
  let highlightMode = $state<HighlightMode>('none');
  let deepScanning = $state(false);
  let deepScanResults = $state<Record<string, { status: number; redirectUrl?: string }>>({});

  const linkColumns = [
    { key: 'anchorText', label: 'Anchor Text', width: '30%' },
    { key: 'href', label: 'URL', width: '45%' },
    { key: 'rel', label: 'Rel', width: '10%' },
    { key: 'issues', label: 'Issues', width: '15%', render: (v: unknown) => (v as string[]).join(', ') },
  ];

  function toggleHighlight(mode: HighlightMode) {
    highlightMode = highlightMode === mode ? 'none' : mode;
    // Send message to content script to highlight links
    chrome.tabs.sendMessage(tabId, {
      type: highlightMode === 'none' ? 'CLEAR_HIGHLIGHTS' : 'HIGHLIGHT_LINKS',
      mode: highlightMode,
    });
  }

  async function deepScan() {
    deepScanning = true;
    const allUrls = [...data.internal, ...data.external].map((l) => l.href);
    const response = await chrome.runtime.sendMessage({
      type: 'DEEP_SCAN_LINKS',
      tabId,
      urls: allUrls,
    });
    deepScanResults = response || {};
    deepScanning = false;
  }

  let currentRows = $derived(data[activeSection]);
</script>

<div class="links-tab">
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

  <section class="toolbar">
    <div class="section-tabs">
      <button class:active={activeSection === 'internal'} onclick={() => activeSection = 'internal'}>
        Internal ({data.internal.length})
      </button>
      <button class:active={activeSection === 'external'} onclick={() => activeSection = 'external'}>
        External ({data.external.length})
      </button>
      <button class:active={activeSection === 'bad'} onclick={() => activeSection = 'bad'}>
        Bad ({data.bad.length})
      </button>
    </div>

    <div class="highlight-controls">
      <span class="label">Highlight:</span>
      <button class="hl-btn hl-internal" class:active={highlightMode === 'internal'} onclick={() => toggleHighlight('internal')}>Internal</button>
      <button class="hl-btn hl-external" class:active={highlightMode === 'external'} onclick={() => toggleHighlight('external')}>External</button>
      <button class="hl-btn hl-nofollow" class:active={highlightMode === 'nofollow'} onclick={() => toggleHighlight('nofollow')}>Nofollow</button>
      <button class="hl-btn hl-all" class:active={highlightMode === 'all'} onclick={() => toggleHighlight('all')}>All</button>
    </div>

    <button class="deep-scan-btn" onclick={deepScan} disabled={deepScanning}>
      {deepScanning ? 'Scanning...' : 'Deep Scan'}
    </button>
  </section>

  <section class="section">
    <SortableTable columns={linkColumns} rows={currentRows} maxHeight="500px" />
  </section>
</div>

<style>
  .links-tab { display: flex; flex-direction: column; gap: 4px; }
  .warnings {
    padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
    border-bottom: 1px solid var(--border-color);
  }
  .warning-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .toolbar {
    display: flex; align-items: center; gap: 12px; padding: 8px 12px;
    border-bottom: 1px solid var(--border-color); flex-wrap: wrap;
  }
  .section-tabs { display: flex; gap: 4px; }
  .section-tabs button {
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    color: var(--text-secondary); font-size: 11px; padding: 3px 10px;
    border-radius: 3px; cursor: pointer;
  }
  .section-tabs button:hover { color: var(--text-primary); }
  .section-tabs button.active {
    background: var(--bg-active); color: var(--accent-color); border-color: var(--accent-color);
  }
  .highlight-controls { display: flex; align-items: center; gap: 4px; margin-left: auto; }
  .label { color: var(--text-muted); font-size: 11px; }
  .hl-btn {
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    color: var(--text-secondary); font-size: 10px; padding: 2px 6px;
    border-radius: 3px; cursor: pointer;
  }
  .hl-btn.active { font-weight: 600; }
  .hl-internal.active { color: #4ec9b0; border-color: #4ec9b0; }
  .hl-external.active { color: #f14c4c; border-color: #f14c4c; }
  .hl-nofollow.active { color: #cca700; border-color: #cca700; }
  .hl-all.active { color: var(--accent-color); border-color: var(--accent-color); }
  .deep-scan-btn {
    background: var(--bg-active); border: 1px solid var(--border-color);
    color: var(--text-primary); font-size: 11px; padding: 3px 10px;
    border-radius: 3px; cursor: pointer;
  }
  .deep-scan-btn:hover { background: var(--bg-hover); }
  .deep-scan-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .section { padding: 0 12px 12px; }
</style>
```

**Step 4: Wire up in App.svelte**

```svelte
import Links from './tabs/Links.svelte';

{:else if activeTab === 'Links'}
  <Links data={analysisData.links} tabId={chrome.devtools.inspectedWindow.tabId} />
```

**Step 5: Build and test**

```bash
npx vite build
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: implement Links tab with internal/external/bad links, highlighting, and deep scan"
```

---

### Task 7: Images Tab

**Files:**
- Modify: `src/content/analyzer.ts` (implement `analyzeImages`)
- Create: `src/panel/tabs/Images.svelte`
- Modify: `src/panel/App.svelte` (wire up tab)

**Step 1: Implement `analyzeImages` in analyzer.ts**

```typescript
function analyzeImages(): AnalysisResult['images'] {
  const imgEls = document.querySelectorAll('img');
  const items: ImageItem[] = [];
  const warnings: string[] = [];

  imgEls.forEach((el) => {
    const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
    const alt = el.getAttribute('alt') ?? '';
    const width = el.naturalWidth || el.width || null;
    const height = el.naturalHeight || el.height || null;
    const loading = el.getAttribute('loading');
    const issues: string[] = [];

    if (alt === '') issues.push('Missing alt text');
    if (!loading) issues.push('No lazy loading attribute');

    items.push({ src, alt, width, height, loading, issues });
  });

  if (items.some((i) => i.issues.includes('Missing alt text'))) {
    const count = items.filter((i) => i.issues.includes('Missing alt text')).length;
    warnings.push(`${count} image(s) missing alt text`);
  }

  // OG image
  const ogImage = document.querySelector('meta[property="og:image"]');
  const ogWidth = document.querySelector('meta[property="og:image:width"]');
  const ogHeight = document.querySelector('meta[property="og:image:height"]');
  const ogType = document.querySelector('meta[property="og:image:type"]');
  const ogAlt = document.querySelector('meta[property="og:image:alt"]');

  const og: OgImageData = {
    url: ogImage?.getAttribute('content') || null,
    width: ogWidth?.getAttribute('content') || null,
    height: ogHeight?.getAttribute('content') || null,
    type: ogType?.getAttribute('content') || null,
    alt: ogAlt?.getAttribute('content') || null,
  };

  // Twitter image
  const twitterCard = document.querySelector('meta[name="twitter:card"]');
  const twitterImage = document.querySelector('meta[name="twitter:image"]');
  const twitterImageAlt = document.querySelector('meta[name="twitter:image:alt"]');

  const twitter: TwitterImageData = {
    card: twitterCard?.getAttribute('content') || null,
    image: twitterImage?.getAttribute('content') || null,
    imageAlt: twitterImageAlt?.getAttribute('content') || null,
  };

  if (!og.url) warnings.push('No OG image set');
  if (!twitter.image) warnings.push('No Twitter card image set');

  return { items, og, twitter, warnings };
}
```

**Step 2: Create `src/panel/tabs/Images.svelte`**

```svelte
<script lang="ts">
  import type { ImagesData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import SortableTable from '../components/SortableTable.svelte';

  interface Props {
    data: ImagesData;
  }

  let { data }: Props = $props();

  const imageColumns = [
    { key: 'src', label: 'Source', width: '40%' },
    { key: 'alt', label: 'Alt Text', width: '25%' },
    { key: 'width', label: 'Width', width: '8%' },
    { key: 'height', label: 'Height', width: '8%' },
    { key: 'loading', label: 'Loading', width: '9%' },
    { key: 'issues', label: 'Issues', width: '10%', render: (v: unknown) => (v as string[]).join(', ') },
  ];
</script>

<div class="images-tab">
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
    <h3 class="section-title">OG Image</h3>
    {#if data.og.url}
      <div class="image-preview">
        <img src={data.og.url} alt={data.og.alt || 'OG Image'} class="preview-img" />
        <div class="image-meta">
          <div><span class="meta-label">URL:</span> <span class="mono">{data.og.url}</span></div>
          {#if data.og.width}<div><span class="meta-label">Size:</span> {data.og.width} x {data.og.height}</div>{/if}
          {#if data.og.type}<div><span class="meta-label">Type:</span> {data.og.type}</div>{/if}
          {#if data.og.alt}<div><span class="meta-label">Alt:</span> {data.og.alt}</div>{/if}
        </div>
      </div>
    {:else}
      <p class="not-set">Not set</p>
    {/if}
  </section>

  <section class="section">
    <h3 class="section-title">Twitter Card Image</h3>
    {#if data.twitter.image}
      <div class="image-preview">
        <img src={data.twitter.image} alt={data.twitter.imageAlt || 'Twitter Image'} class="preview-img" />
        <div class="image-meta">
          <div><span class="meta-label">Card:</span> {data.twitter.card || '(not set)'}</div>
          <div><span class="meta-label">URL:</span> <span class="mono">{data.twitter.image}</span></div>
          {#if data.twitter.imageAlt}<div><span class="meta-label">Alt:</span> {data.twitter.imageAlt}</div>{/if}
        </div>
      </div>
    {:else}
      <p class="not-set">Not set</p>
    {/if}
  </section>

  <section class="section">
    <h3 class="section-title">Page Images ({data.items.length})</h3>
    <SortableTable columns={imageColumns} rows={data.items} maxHeight="400px" />
  </section>
</div>

<style>
  .images-tab { display: flex; flex-direction: column; gap: 4px; }
  .warnings {
    padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
    border-bottom: 1px solid var(--border-color);
  }
  .warning-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .section { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
  .section-title {
    color: var(--text-secondary); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
  }
  .image-preview { display: flex; gap: 12px; align-items: flex-start; }
  .preview-img {
    max-width: 200px; max-height: 120px; border: 1px solid var(--border-color);
    border-radius: 4px; object-fit: contain; background: var(--bg-secondary);
  }
  .image-meta { font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
  .meta-label { color: var(--text-muted); }
  .mono { font-family: var(--font-mono); }
  .not-set { color: var(--text-muted); font-size: 12px; }
</style>
```

**Step 3: Wire up in App.svelte**

```svelte
import Images from './tabs/Images.svelte';

{:else if activeTab === 'Images'}
  <Images data={analysisData.images} />
```

**Step 4: Build and test**

```bash
npx vite build
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: implement Images tab with alt text analysis and OG/Twitter image preview"
```

---

### Task 8: Schema Tab

**Files:**
- Modify: `src/content/analyzer.ts` (implement `analyzeSchema`)
- Create: `src/panel/tabs/Schema.svelte`
- Modify: `src/panel/App.svelte` (wire up tab)

**Step 1: Implement `analyzeSchema` in analyzer.ts**

```typescript
function analyzeSchema(): AnalysisResult['schema'] {
  const items: SchemaItem[] = [];
  const warnings: string[] = [];

  // JSON-LD
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  jsonLdScripts.forEach((script) => {
    try {
      const raw = script.textContent || '';
      const parsed = JSON.parse(raw);
      const type = parsed['@type'] || (Array.isArray(parsed['@graph']) ? 'Graph' : 'Unknown');
      const issues: string[] = [];

      if (!parsed['@context']) issues.push('Missing @context');
      if (!parsed['@type'] && !parsed['@graph']) issues.push('Missing @type');

      items.push({ type, format: 'json-ld', raw, parsed, issues });
    } catch (e) {
      items.push({
        type: 'Invalid',
        format: 'json-ld',
        raw: script.textContent || '',
        parsed: {},
        issues: ['Invalid JSON: ' + (e instanceof Error ? e.message : 'parse error')],
      });
    }
  });

  // Microdata
  const microdataEls = document.querySelectorAll('[itemscope]');
  microdataEls.forEach((el) => {
    const type = el.getAttribute('itemtype') || 'Unknown';
    const props: Record<string, unknown> = {};

    el.querySelectorAll('[itemprop]').forEach((prop) => {
      const name = prop.getAttribute('itemprop') || '';
      const value =
        prop.getAttribute('content') ||
        prop.getAttribute('href') ||
        prop.getAttribute('src') ||
        prop.textContent?.trim() ||
        '';
      props[name] = value;
    });

    items.push({
      type: type.split('/').pop() || type,
      format: 'microdata',
      raw: el.outerHTML.substring(0, 500),
      parsed: { '@type': type, ...props },
      issues: [],
    });
  });

  if (items.length === 0) {
    warnings.push('No structured data found on this page');
  }

  const invalidCount = items.filter((i) => i.issues.length > 0).length;
  if (invalidCount > 0) {
    warnings.push(`${invalidCount} schema item(s) have issues`);
  }

  return { items, warnings };
}
```

**Step 2: Create `src/panel/tabs/Schema.svelte`**

```svelte
<script lang="ts">
  import type { SchemaData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import CodeBlock from '../components/CodeBlock.svelte';

  interface Props {
    data: SchemaData;
  }

  let { data }: Props = $props();

  let viewMode = $state<'parsed' | 'raw'>('parsed');
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

  <div class="view-toggle">
    <button class:active={viewMode === 'parsed'} onclick={() => viewMode = 'parsed'}>Parsed</button>
    <button class:active={viewMode === 'raw'} onclick={() => viewMode = 'raw'}>Raw</button>
  </div>

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

      {#if viewMode === 'parsed'}
        <CodeBlock code={JSON.stringify(item.parsed, null, 2)} language="json" />
      {:else}
        <CodeBlock code={item.raw} language={item.format === 'json-ld' ? 'json' : 'html'} />
      {/if}
    </section>
  {/each}

  {#if data.items.length === 0}
    <p class="empty">No structured data found</p>
  {/if}
</div>

<style>
  .schema-tab { display: flex; flex-direction: column; gap: 4px; }
  .warnings {
    padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
    border-bottom: 1px solid var(--border-color);
  }
  .warning-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .view-toggle { display: flex; gap: 4px; padding: 8px 12px; }
  .view-toggle button {
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    color: var(--text-secondary); font-size: 11px; padding: 3px 10px;
    border-radius: 3px; cursor: pointer;
  }
  .view-toggle button:hover { color: var(--text-primary); }
  .view-toggle button.active {
    background: var(--bg-active); color: var(--accent-color); border-color: var(--accent-color);
  }
  .schema-item { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
  .schema-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .schema-type { color: var(--text-primary); font-weight: 600; font-size: 13px; }
  .issues { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
  .issue-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .empty { color: var(--text-muted); padding: 24px; text-align: center; }
</style>
```

**Step 3: Wire up in App.svelte**

```svelte
import Schema from './tabs/Schema.svelte';

{:else if activeTab === 'Schema'}
  <Schema data={analysisData.schema} />
```

**Step 4: Build and test**

```bash
npx vite build
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: implement Schema tab with JSON-LD/microdata parsing and validation"
```

---

### Task 9: Technical Tab

**Files:**
- Modify: `src/content/analyzer.ts` (implement `analyzeTechnical`)
- Create: `src/panel/tabs/Technical.svelte`
- Modify: `src/panel/App.svelte` (wire up tab)

**Step 1: Implement `analyzeTechnical` in analyzer.ts**

```typescript
function analyzeTechnical(): AnalysisResult['technical'] {
  // Hreflang
  const hreflangLinks = document.querySelectorAll('link[rel="alternate"][hreflang]');
  const hreflang: { lang: string; url: string }[] = [];
  hreflangLinks.forEach((el) => {
    hreflang.push({
      lang: el.getAttribute('hreflang') || '',
      url: el.getAttribute('href') || '',
    });
  });

  // Core Web Vitals from Performance API
  let lcp: number | null = null;
  let cls: number | null = null;
  let fid: number | null = null;

  try {
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
    if (lcpEntries.length > 0) {
      lcp = Math.round((lcpEntries[lcpEntries.length - 1] as any).startTime);
    }
  } catch {}

  // Page weight from performance entries
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  let jsSize = 0, cssSize = 0, imageSize = 0, fontSize = 0, otherSize = 0;
  const renderBlocking: string[] = [];

  resources.forEach((r) => {
    const size = r.transferSize || 0;
    const type = r.initiatorType;

    if (type === 'script' || r.name.match(/\.js(\?|$)/)) {
      jsSize += size;
      if ((r as any).renderBlockingStatus === 'blocking') renderBlocking.push(r.name);
    } else if (type === 'css' || type === 'link' || r.name.match(/\.css(\?|$)/)) {
      cssSize += size;
      if ((r as any).renderBlockingStatus === 'blocking') renderBlocking.push(r.name);
    } else if (type === 'img' || r.name.match(/\.(png|jpg|jpeg|gif|webp|svg|avif)(\?|$)/i)) {
      imageSize += size;
    } else if (r.name.match(/\.(woff2?|ttf|otf|eot)(\?|$)/i)) {
      fontSize += size;
    } else {
      otherSize += size;
    }
  });

  const total = jsSize + cssSize + imageSize + fontSize + otherSize;
  const renderedElementCount = document.querySelectorAll('*').length;

  return {
    robotsTxt: { exists: false, content: null }, // Fetched by panel via service worker
    sitemap: { exists: false, url: null, urls: [] }, // Fetched by panel via service worker
    hreflang,
    coreWebVitals: { lcp, cls, fid },
    pageWeight: { total, js: jsSize, css: cssSize, images: imageSize, fonts: fontSize, other: otherSize },
    renderBlocking,
    jsRendering: { initialElementCount: 0, renderedElementCount, diff: 0 },
  };
}
```

**Step 2: Create `src/panel/tabs/Technical.svelte`**

```svelte
<script lang="ts">
  import type { TechnicalData } from '../../shared/types';
  import Badge from '../components/Badge.svelte';
  import CodeBlock from '../components/CodeBlock.svelte';

  interface Props {
    data: TechnicalData;
    tabId: number;
  }

  let { data, tabId }: Props = $props();

  let robotsTxt = $state(data.robotsTxt);
  let sitemap = $state(data.sitemap);
  let fetchingRobots = $state(true);
  let fetchingSitemap = $state(true);

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function lcpBadge(ms: number | null): { type: 'success' | 'warning' | 'error' | 'info'; label: string } {
    if (ms === null) return { type: 'info', label: 'N/A' };
    if (ms <= 2500) return { type: 'success', label: 'Good' };
    if (ms <= 4000) return { type: 'warning', label: 'Needs Improvement' };
    return { type: 'error', label: 'Poor' };
  }

  // Fetch robots.txt and sitemap via service worker on mount
  $effect(() => {
    // Use inspectedWindow to get the origin, then fetch via service worker
    chrome.devtools.inspectedWindow.eval(
      'window.location.origin',
      (origin: unknown) => {
        if (typeof origin !== 'string') return;

        chrome.runtime.sendMessage(
          { type: 'FETCH_ROBOTS', tabId, origin },
          (response: any) => {
            if (response) robotsTxt = response;
            fetchingRobots = false;
          }
        );

        chrome.runtime.sendMessage(
          { type: 'FETCH_SITEMAP', tabId, origin },
          (response: any) => {
            if (response) {
              sitemap = { exists: response.exists, url: origin + '/sitemap.xml', urls: [] };
            }
            fetchingSitemap = false;
          }
        );
      }
    );
  });
</script>

<div class="technical-tab">
  <section class="section">
    <h3 class="section-title">robots.txt</h3>
    {#if fetchingRobots}
      <p class="loading-text">Fetching...</p>
    {:else if robotsTxt?.exists}
      <Badge type="success" label="Found" />
      <CodeBlock code={robotsTxt.content || ''} language="txt" />
    {:else}
      <Badge type="error" label="Not Found" />
    {/if}
  </section>

  <section class="section">
    <h3 class="section-title">sitemap.xml</h3>
    {#if fetchingSitemap}
      <p class="loading-text">Fetching...</p>
    {:else if sitemap?.exists}
      <Badge type="success" label="Found" />
      {#if sitemap.url}<p class="mono">{sitemap.url}</p>{/if}
    {:else}
      <Badge type="error" label="Not Found" />
    {/if}
  </section>

  {#if data.hreflang.length > 0}
    <section class="section">
      <h3 class="section-title">Hreflang Tags</h3>
      {#each data.hreflang as hl}
        <div class="hreflang-row">
          <span class="hl-lang">{hl.lang}</span>
          <span class="mono">{hl.url}</span>
        </div>
      {/each}
    </section>
  {/if}

  <section class="section">
    <h3 class="section-title">Core Web Vitals</h3>
    <div class="vitals-grid">
      <div class="vital">
        <span class="vital-label">LCP</span>
        <span class="vital-value">{data.coreWebVitals.lcp !== null ? data.coreWebVitals.lcp + 'ms' : 'N/A'}</span>
        <Badge {...lcpBadge(data.coreWebVitals.lcp)} />
      </div>
      <div class="vital">
        <span class="vital-label">CLS</span>
        <span class="vital-value">{data.coreWebVitals.cls !== null ? data.coreWebVitals.cls : 'N/A'}</span>
      </div>
      <div class="vital">
        <span class="vital-label">FID</span>
        <span class="vital-value">{data.coreWebVitals.fid !== null ? data.coreWebVitals.fid + 'ms' : 'N/A'}</span>
      </div>
    </div>
  </section>

  <section class="section">
    <h3 class="section-title">Page Weight</h3>
    <div class="weight-grid">
      <div class="weight-item"><span class="weight-label">Total</span><span class="weight-value">{formatBytes(data.pageWeight.total)}</span></div>
      <div class="weight-item"><span class="weight-label">JavaScript</span><span class="weight-value">{formatBytes(data.pageWeight.js)}</span></div>
      <div class="weight-item"><span class="weight-label">CSS</span><span class="weight-value">{formatBytes(data.pageWeight.css)}</span></div>
      <div class="weight-item"><span class="weight-label">Images</span><span class="weight-value">{formatBytes(data.pageWeight.images)}</span></div>
      <div class="weight-item"><span class="weight-label">Fonts</span><span class="weight-value">{formatBytes(data.pageWeight.fonts)}</span></div>
      <div class="weight-item"><span class="weight-label">Other</span><span class="weight-value">{formatBytes(data.pageWeight.other)}</span></div>
    </div>
  </section>

  {#if data.renderBlocking.length > 0}
    <section class="section">
      <h3 class="section-title">Render-Blocking Resources ({data.renderBlocking.length})</h3>
      {#each data.renderBlocking as resource}
        <div class="blocking-resource mono">{resource}</div>
      {/each}
    </section>
  {/if}

  <section class="section">
    <h3 class="section-title">JS Rendering</h3>
    <div class="weight-grid">
      <div class="weight-item"><span class="weight-label">DOM Elements</span><span class="weight-value">{data.jsRendering.renderedElementCount}</span></div>
    </div>
  </section>
</div>

<style>
  .technical-tab { display: flex; flex-direction: column; gap: 4px; }
  .section { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
  .section-title {
    color: var(--text-secondary); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
  }
  .loading-text { color: var(--text-muted); font-size: 12px; }
  .mono { font-family: var(--font-mono); font-size: 12px; }
  .hreflang-row { display: flex; gap: 12px; padding: 3px 0; font-size: 12px; }
  .hl-lang {
    background: var(--bg-active); color: var(--accent-color);
    padding: 0 4px; border-radius: 2px; font-size: 11px; font-family: var(--font-mono);
  }
  .vitals-grid { display: flex; gap: 24px; }
  .vital { display: flex; align-items: center; gap: 8px; }
  .vital-label { color: var(--text-muted); font-size: 11px; font-weight: 600; }
  .vital-value { color: var(--text-primary); font-size: 14px; font-weight: 600; font-family: var(--font-mono); }
  .weight-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .weight-item { display: flex; flex-direction: column; gap: 2px; }
  .weight-label { color: var(--text-muted); font-size: 11px; }
  .weight-value { color: var(--text-primary); font-size: 13px; font-family: var(--font-mono); }
  .blocking-resource {
    padding: 3px 0; font-size: 11px; color: var(--warning-color);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
</style>
```

**Step 3: Wire up in App.svelte**

```svelte
import Technical from './tabs/Technical.svelte';

{:else if activeTab === 'Technical'}
  <Technical data={analysisData.technical} tabId={chrome.devtools.inspectedWindow.tabId} />
```

**Step 4: Build and test**

```bash
npx vite build
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: implement Technical tab with robots.txt, sitemap, CWV, page weight, and hreflang"
```

---

### Task 10: Wire Up Complete App + Tab Issue Badges

**Files:**
- Modify: `src/panel/App.svelte` (final wiring, tab badges)
- Modify: `src/content/analyzer.ts` (wire all analyzers into `analyzePage`)

**Step 1: Update `analyzePage` in analyzer.ts to call all analyzers**

Replace the stub `analyzePage`:

```typescript
function analyzePage(): AnalysisResult {
  return {
    overview: analyzeOverview(),
    headings: analyzeHeadings(),
    content: analyzeContent(),
    links: analyzeLinks(),
    images: analyzeImages(),
    schema: analyzeSchema(),
    technical: analyzeTechnical(),
    timestamp: Date.now(),
    url: window.location.href,
  };
}
```

**Step 2: Update App.svelte with all tab imports and issue badge counts**

The final App.svelte should import all tab components, render them conditionally, and show issue counts on each tab.

Add a derived `issueCounts` object:

```typescript
let issueCounts = $derived.by(() => {
  if (!analysisData) return {} as Record<string, number>;
  return {
    Overview: 0,
    Headings: analysisData.headings.warnings.length,
    Content: 0,
    Links: analysisData.links.warnings.length,
    Images: analysisData.images.warnings.length,
    Schema: analysisData.schema.warnings.length,
    Technical: 0,
  };
});
```

Update the tab button to show badge:

```svelte
<button class="tab" class:active={activeTab === tab} onclick={() => activeTab = tab}>
  {tab}
  {#if issueCounts[tab]}
    <span class="tab-badge">{issueCounts[tab]}</span>
  {/if}
</button>
```

Add CSS for `.tab-badge`:

```css
.tab-badge {
  background: var(--error-color);
  color: #fff;
  font-size: 9px;
  padding: 0 4px;
  border-radius: 8px;
  margin-left: 4px;
  min-width: 14px;
  text-align: center;
}
```

**Step 3: Build and full end-to-end test**

```bash
npx vite build
```

Load extension, open DevTools on multiple test pages. Verify all 7 tabs work, data populates, issue badges show.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire up all tabs with issue badges and complete page analysis"
```

---

### Task 11: Extension Icons + Polish

**Files:**
- Create: `scripts/generate-icons.ts`
- Modify: `manifest.json` (verify paths after build)

**Step 1: Create simple SVG-based icons**

```bash
npm install -D sharp tsx
```

Create `scripts/generate-icons.ts`:

```typescript
import sharp from 'sharp';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="16" fill="#1e1e1e"/>
  <text x="64" y="72" font-family="system-ui" font-weight="700" font-size="40" fill="#4fc1ff" text-anchor="middle">SEO</text>
</svg>`;

const sizes = [16, 48, 128];

for (const size of sizes) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon${size}.png`);
}

console.log('Icons generated');
```

Run:

```bash
npx tsx scripts/generate-icons.ts
```

**Step 2: Verify manifest paths work with built output**

After `npx vite build`, check that `dist/` has the correct structure and manifest references resolve. Adjust manifest.json paths if needed.

**Step 3: Build final**

```bash
npx vite build
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add extension icons and finalize build"
```

---

### Task 12: Build Pipeline + Dev Workflow

**Files:**
- Modify: `package.json` (add scripts)

**Step 1: Add npm scripts to package.json**

```json
{
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build",
    "icons": "tsx scripts/generate-icons.ts"
  }
}
```

**Step 2: Test dev workflow**

```bash
npm run dev
```

Verify that changes to Svelte files trigger rebuilds. Reload the extension in Chrome to pick up changes.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add dev/build scripts for development workflow"
```
