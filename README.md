# Site Lens

A Chrome extension (Manifest V3) for on-page SEO auditing, social previews, and accessibility checks. Most of it lives in a **Site Lens** panel inside Chrome DevTools. A toolbar popup adds on-page tools like a font inspector, an element copier, and vision simulation.

## Features

### DevTools panel

Open DevTools on any page and switch to the **Site Lens** tab. The page is analyzed automatically, and you can run it again with **Re-scan**. When a tab finds issues, it shows a count badge.

| Tab | What it shows |
|---|---|
| **Overview** | Title and meta description with length checks, meta keywords, URL, canonical (flags a missing or mismatched one), meta robots, viewport, charset, `lang`, favicon, redirect chain |
| **Preview** | Google search result, Facebook / Open Graph card, and Twitter / X card previews, with truncation and missing-tag warnings |
| **Headings** | H1–H6 counts and a hierarchy tree. Warns on a missing H1, multiple H1s, and skipped levels. Click a heading to scroll to it |
| **Content** | Word count, Flesch readability, and 1/2/3-word phrase density in a sortable table |
| **Links** | Internal, external, and bad links with rel attributes. Deep Scan checks status codes, and highlight mode outlines links on the page by type |
| **Images** | Every image on the page (`<img>`, `<picture>`/srcset, CSS backgrounds, inline SVG, video posters, favicons, og/twitter meta) with thumbnails, filters, and issue flags. You can copy URLs as a list or CSV, or download all or selected images as a ZIP |
| **Schema** | JSON-LD, Microdata, and RDFa, shown both raw and grouped by type |
| **Technical** | robots.txt, sitemap discovery, hreflang tags, page weight by resource type, render-blocking resources, DOM element count |

### Toolbar popup

Click the extension icon to use these tools on the current page:

- **Font Inspector**: hover over text to see its font family, size, weight, style, line height, and color.
- **Element Copier**: click any element to copy its non-default CSS, or a self-contained HTML + CSS snippet.
- **Vision Simulation**: blur, grayscale, and seven color-blindness filters (protanopia, deuteranopia, tritanopia, achromatopsia, and the three -anomaly variants).
- **Reset All** turns everything off.

Only one of Font Inspector and Element Copier can be on at a time. The toolbar icon shows an `ON` badge while either one is active.

## Installation (from source)

Requirements: Node.js 20+ and Chrome (or another Chromium browser).

```bash
npm install
npm run build
```

Then load it into Chrome:

1. Go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick the `dist/` folder.

## Development

```bash
npm run dev     # rebuild into dist/ on every change
npm run icons   # regenerate icons in public/icons/
```

After a rebuild, click the reload button on the extension card in `chrome://extensions`. Then close and reopen DevTools so the panel picks up the changes. Content script changes also need the inspected page to be refreshed.

## Project structure

```
public/
  manifest.json          MV3 manifest (copied into dist/)
  popup.html, popup.js   Toolbar popup
  icons/
src/
  background/
    service-worker.ts    Message routing and cross-origin fetches (robots.txt, sitemap, link checks, image downloads)
  content/
    analyzer.ts          Content script entry: runs the page analysis and handles messages
    image-detector.ts    Finds images from every source type
    highlighter.ts       Outlines links on the page
    font-inspector.ts    Hover font tooltip
    element-copier.ts    Click-to-copy element picker
    style-extractor.ts   Computed-style → portable HTML/CSS snippet
    vision-simulator.ts  Blur, grayscale, and color-blindness SVG filters
  devtools/              Registers the DevTools panel
  panel/                 Svelte 5 app for the DevTools panel (tabs, components, styles)
  shared/types.ts        Types shared by the content script and the panel
docs/                    Design docs and implementation plans
```

### How it fits together

1. The DevTools page registers the **Site Lens** panel.
2. The panel sends `ANALYZE_PAGE` to the service worker, which forwards it to the content script in the inspected tab.
3. The content script reads the DOM and sends back a structured `AnalysisResult`, which the panel renders.
4. Requests that would hit CORS limits (robots.txt, sitemaps, link status checks, image fetches for the ZIP) go through the service worker.

## Tech stack

Svelte 5, TypeScript, Vite, JSZip, and sharp (for icon generation).

## License

Copyright © 2026 Mike Wall. All rights reserved.
