# SEO Chrome Extension - Design Document

## Overview

A Chrome DevTools extension for on-page SEO analysis. Provides fast, actionable feedback while building and managing websites. Dark-themed UI matching native Chrome DevTools aesthetics.

## Architecture

### Extension Components

- **DevTools Page** - Registers the "SEO" panel in Chrome DevTools
- **Content Script** - Injected into the inspected page, handles all DOM analysis
- **Panel (Svelte app)** - Renders the UI inside the DevTools tab, communicates with the content script
- **Service Worker (background)** - Handles network requests for deep scan (link checking, robots.txt/sitemap fetching)

### Data Flow

1. User opens DevTools -> SEO panel loads
2. Panel sends analysis request to content script
3. Content script scrapes the DOM, returns structured data
4. Panel renders results in tabbed UI
5. Deep scan requests go through the service worker to avoid CORS issues

### Re-analysis

Results auto-refresh when the inspected page navigates. Manual "Re-scan" button available.

## Panel Tabs & Features

### Tab 1: Overview

- Page title (with character count, warn if too long/short)
- Meta description (with character count, warn if too long/short)
- Meta keywords
- URL analysis (length, special characters, trailing slashes)
- Canonical URL (highlight if missing or mismatched)
- Meta robots directives
- Viewport, charset, language attribute
- Favicon detection
- Redirect chain (if the page was redirected to get here)

### Tab 2: Headings

- Full heading hierarchy (H1-H6) as a tree view
- Heading count per level
- Warnings: missing H1, multiple H1s, skipped levels (H1->H3)
- Click-to-scroll to any heading on the page

### Tab 3: Content

- Word count
- Word/phrase density (1-word, 2-word, 3-word ngrams) with sortable table
- Readability score (Flesch-Kincaid)
- Text-to-HTML ratio

### Tab 4: Links

- Internal links list with anchor text
- External links list with nofollow/sponsored/ugc attributes
- Bad links section (empty hrefs, malformed, javascript:void, #)
- Deep scan button to check status codes (broken, redirects)
- Warnings: too many links, duplicate links, missing anchor text
- Highlight mode: toggle buttons to overlay colors on the page (green=internal, red=external, yellow=nofollow, orange=broken)

### Tab 5: Images

- All images with src, alt text, dimensions, file size
- Warnings: missing alt, oversized images, missing lazy loading
- OG image preview + meta
- Twitter card image preview + meta

### Tab 6: Schema

- Raw JSON-LD / Microdata / RDFa viewer (formatted)
- Parsed view grouped by schema type
- Validation summary: missing required fields, invalid types, warnings for recommended fields

### Tab 7: Technical

- robots.txt status (fetched via service worker, show contents)
- sitemap.xml status (fetched, show URL list)
- Hreflang tags and mappings
- Core Web Vitals (LCP, CLS, FID from Performance API)
- Page weight and resource breakdown (JS, CSS, images, fonts)
- Render-blocking resources
- JS rendering check: compare initial HTML vs rendered DOM

## UI Design

### Theme

- Dark theme matching Chrome DevTools (background #1e1e1e, text #e8e8e8, borders #3c3c3c)
- Monospace font (Menlo / Consolas fallback) for data, system font for labels
- Tab bar across the top, fixed; content scrolls below

### Component Patterns

- **Status badges** - green (pass), yellow (warning), red (error), gray (info) pills
- **Sortable tables** - for links, images, word density; click column headers to sort
- **Tree view** - for headings hierarchy, collapsible nodes
- **Code blocks** - for schema JSON, robots.txt content; syntax highlighted
- **Toggle buttons** - for link highlight mode, grouped in a toolbar
- **Progress indicator** - spinner for deep scan operations
- **Tab badges** - small count on each tab showing number of issues found

### Link Highlight Overlay

- Inject temporary CSS via content script
- Colored outlines + small floating labels on hovered links
- Toggle on/off per link type, all cleared when panel closes

## Tech Stack

- **Svelte 5** + **Vite** for the DevTools panel UI
- **TypeScript** for type safety across all scripts
- **Chrome Extensions Manifest V3**
- No external CSS framework; hand-written styles matching DevTools theme

## Project Structure

```
seo-tools/
  manifest.json
  vite.config.ts
  package.json
  tsconfig.json
  src/
    devtools/
      devtools.html          # Registers the panel
      devtools.ts
    panel/
      panel.html             # Panel entry point
      main.ts                # Svelte app mount
      App.svelte             # Tab container
      styles/
        devtools-theme.css   # Global dark theme
      tabs/
        Overview.svelte
        Headings.svelte
        Content.svelte
        Links.svelte
        Images.svelte
        Schema.svelte
        Technical.svelte
      components/
        Badge.svelte
        SortableTable.svelte
        TreeView.svelte
        CodeBlock.svelte
        TabBar.svelte
    content/
      analyzer.ts            # DOM analysis logic
      highlighter.ts         # Link overlay injection
    background/
      service-worker.ts      # Deep scan, robots/sitemap fetch
    shared/
      types.ts               # Shared TypeScript interfaces
  public/
    icons/                   # Extension icons
```

## Build

Vite builds the panel app, content script, and service worker as separate entry points. Output goes to a `dist/` folder ready to load as an unpacked extension.

## Scope

### In scope

- Per-page on-page SEO analysis
- DOM-based analysis (fast, default)
- Deep scan via network requests (opt-in)
- Visual link highlighting on the inspected page

### Out of scope (for now)

- Backlink analysis (requires external APIs)
- Keyword ranking data (requires external APIs)
- Site-wide crawling
- Report generation / export
- Competitor analysis
