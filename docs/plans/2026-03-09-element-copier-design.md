# Element Copier — Design

## Summary

A standalone element picker tool that lets users click any element on the page to copy its meaningful CSS properties or outer HTML to clipboard. Activated from the popup toolbar alongside the font inspector.

## User Flow

1. User clicks the "Element Copier" toggle in the popup (under Tools section)
2. Page enters picker mode — crosshair cursor, elements highlight on hover (dashed outline)
3. User clicks an element — a small floating popup appears near it with "Copy CSS" and "Copy HTML" buttons
4. Clicking a button copies content to clipboard, button shows "Copied!" briefly, popup dismisses after ~800ms
5. User can click another element or press Esc to exit
6. Enabling element copier auto-disables font inspector (and vice versa)

## CSS Filtering

Only non-default styles are included. The filter works by:

1. Creating a temporary same-tag element off-screen
2. Getting its computed styles as the baseline (browser defaults)
3. Comparing target element's computed styles against the baseline
4. Excluding vendor-prefixed properties (`-webkit-*`, `-moz-*`) and positional derivatives (`perspective-origin`, `transform-origin`)

Output is a clean declaration block with no selector wrapper:

```
font-family: Inter;
font-size: 16px;
font-weight: 700;
color: rgb(31, 41, 55);
```

## HTML Copy

Copies `element.outerHTML` as-is.

## Popup Design

- Same dark visual style as font inspector tooltip (`#1e1e1e` bg, `#444` border, `6px` radius)
- Two buttons side by side: "Copy CSS" | "Copy HTML"
- `pointer-events: auto` (clickable, unlike font inspector tooltip)
- Positioned near clicked element with same overflow-prevention logic
- Brief green "Copied!" feedback on button click

## Architecture

### New Files

- `src/content/element-copier.ts` — core module: enable/disable/toggle, element picking, popup rendering, CSS extraction, clipboard copy

### Modified Files

- `src/content/analyzer.ts` — add `TOGGLE_ELEMENT_COPIER` message handler; disable font inspector when element copier activates and vice versa
- `src/background/service-worker.ts` — handle `ELEMENT_COPIER_DISABLED` message to clear badge
- `public/popup.html` — add Element Copier toggle row in Tools section
- `public/popup.js` — add toggle handler, sync state on open, mutual exclusion with font inspector toggle

## Mutual Exclusion

When element copier is enabled:
- If font inspector is active, disable it first
- Update font inspector toggle UI in popup to reflect inactive state

Same logic applies in reverse when font inspector is enabled.

## Message Types

- `TOGGLE_ELEMENT_COPIER` — sent from popup to content script via analyzer
- `ELEMENT_COPIER_DISABLED` — sent from content script to service worker (on Esc exit)
