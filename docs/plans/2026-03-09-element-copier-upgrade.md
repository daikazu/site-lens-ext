# Element Copier Upgrade — Full Subtree Export

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the element copier to export a self-contained HTML+CSS snippet that visually reproduces the selected element and its full subtree, including descendant styles, CSS variables, pseudo-elements, and parent layout context.

**Architecture:** Extract the style capture logic into a new `src/content/style-extractor.ts` module with distinct functions for DOM cloning, recursive style extraction, CSS variable collection, pseudo-element capture, and parent context capture. The element-copier.ts buttons change from "Copy CSS" / "Copy HTML" to "Copy Snippet" (full HTML+CSS) and "Copy CSS Only" (styles for subtree). The snippet output is a self-contained `<style>` block + HTML that renders portably.

**Tech Stack:** TypeScript, Chrome Extension content script APIs, `window.getComputedStyle`, `document.styleSheets` CSSOM API

---

### Task 1: Create style-extractor.ts — Core extraction engine

**Files:**
- Create: `src/content/style-extractor.ts`

**Step 1: Create the style extractor module**

This module exports three functions:
- `extractSubtreeStyles(root)` — returns scoped CSS for the element + all descendants
- `extractSnippet(root)` — returns self-contained HTML string with embedded `<style>`
- `extractCssOnly(root)` — returns just the CSS rules for the subtree

```typescript
// =============================================================================
// style-extractor.ts
//
// Extracts a self-contained HTML+CSS snippet from a DOM subtree.
// Walks the full descendant tree, captures computed styles, CSS variables,
// pseudo-elements, and parent layout context to produce a portable export.
// =============================================================================

const VENDOR_PREFIXES = ['-webkit-', '-moz-', '-ms-', '-o-'];
const POSITIONAL_PROPS = ['perspective-origin', 'transform-origin'];

// Properties that are inherited by default in CSS — we capture these from
// the root element even if they match browser defaults, because they affect
// all descendants and must be preserved for portability.
const INHERITED_PROPS = [
  'color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'font-variant', 'font-stretch', 'line-height', 'letter-spacing',
  'word-spacing', 'text-align', 'text-indent', 'text-transform',
  'text-decoration', 'text-shadow', 'white-space', 'word-break',
  'word-wrap', 'overflow-wrap', 'direction', 'unicode-bidi',
  'visibility', 'cursor', 'list-style', 'list-style-type',
  'list-style-position', 'list-style-image', 'quotes',
  'orphans', 'widows', 'tab-size', 'hyphens',
];

// Parent layout properties that affect how the selected element renders.
// We capture these from ancestors to create a wrapper context.
const PARENT_CONTEXT_PROPS = [
  'display', 'flex-direction', 'flex-wrap', 'justify-content',
  'align-items', 'align-content', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-auto-flow',
  'grid-auto-columns', 'grid-auto-rows', 'place-items', 'place-content',
  'position', 'width', 'max-width', 'min-width', 'box-sizing',
  'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
];

// Pseudo-elements we attempt to capture.
const PSEUDO_ELEMENTS = ['::before', '::after'] as const;

// Class prefix for scoped selectors — avoids collisions with page styles.
const SCOPE_PREFIX = 'ec-';

/**
 * Determine if a CSS property should be skipped (vendor prefix or positional).
 */
function shouldSkipProp(prop: string): boolean {
  if (VENDOR_PREFIXES.some(p => prop.startsWith(p))) return true;
  if (POSITIONAL_PROPS.includes(prop)) return true;
  return false;
}

/**
 * Get meaningful (non-default) computed styles for a single element.
 * Compares against a baseline same-tag element to filter browser defaults.
 * For the root element, also captures inherited properties unconditionally.
 */
function getMeaningfulStyles(
  el: Element,
  isRoot: boolean,
  baselineCache: Map<string, CSSStyleDeclaration>
): Map<string, string> {
  const computed = window.getComputedStyle(el);
  const tag = el.tagName.toLowerCase();
  const result = new Map<string, string>();

  // Get or create baseline for this tag type
  let baseComputed = baselineCache.get(tag);
  if (!baseComputed) {
    const baseline = document.createElement(tag);
    baseline.style.position = 'absolute';
    baseline.style.visibility = 'hidden';
    baseline.style.pointerEvents = 'none';
    document.body.appendChild(baseline);
    baseComputed = window.getComputedStyle(baseline);
    // Copy values out because the CSSStyleDeclaration is live
    const snapshot = new Map<string, string>();
    for (let i = 0; i < baseComputed.length; i++) {
      const prop = baseComputed[i];
      snapshot.set(prop, baseComputed.getPropertyValue(prop));
    }
    baseline.remove();
    // Store as a pseudo-CSSStyleDeclaration (we only need getPropertyValue)
    baselineCache.set(tag, {
      getPropertyValue: (p: string) => snapshot.get(p) || '',
    } as CSSStyleDeclaration);
    baseComputed = baselineCache.get(tag)!;
  }

  for (let i = 0; i < computed.length; i++) {
    const prop = computed[i];
    if (shouldSkipProp(prop)) continue;

    const val = computed.getPropertyValue(prop);
    const baseVal = baseComputed.getPropertyValue(prop);

    // Include if different from default
    if (val !== baseVal) {
      result.set(prop, val);
    }
    // For root element, always include inherited props for portability
    else if (isRoot && INHERITED_PROPS.includes(prop) && val) {
      result.set(prop, val);
    }
  }

  return result;
}

/**
 * Capture pseudo-element styles (::before, ::after) if they have content.
 */
function getPseudoStyles(
  el: Element,
  pseudo: '::before' | '::after'
): Map<string, string> | null {
  const computed = window.getComputedStyle(el, pseudo);
  const content = computed.getPropertyValue('content');

  // No pseudo-element rendered if content is 'none' or empty
  if (!content || content === 'none' || content === '""' || content === "''") {
    return null;
  }

  const styles = new Map<string, string>();

  for (let i = 0; i < computed.length; i++) {
    const prop = computed[i];
    if (shouldSkipProp(prop)) continue;
    const val = computed.getPropertyValue(prop);
    if (val) styles.set(prop, val);
  }

  return styles;
}

/**
 * Collect CSS custom properties (variables) used by the subtree.
 * Walks all stylesheets to find --var declarations, then checks which
 * ones are actually referenced by elements in the subtree via var().
 */
function collectCssVariables(root: Element): Map<string, string> {
  const result = new Map<string, string>();

  // First, find all var() references in the subtree's computed styles
  const referencedVars = new Set<string>();
  const els = [root, ...root.querySelectorAll('*')];

  for (const el of els) {
    const computed = window.getComputedStyle(el);
    // Check inline style for var() references since computed values are resolved
    const inline = (el as HTMLElement).style;
    if (inline) {
      for (let i = 0; i < inline.length; i++) {
        const val = inline.getPropertyValue(inline[i]);
        const matches = val.matchAll(/var\(\s*(--[^,)]+)/g);
        for (const m of matches) referencedVars.add(m[1].trim());
      }
    }

    // Also check stylesheets for rules that apply to elements in the subtree
    // and reference CSS variables
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i];
      if (prop.startsWith('--')) {
        // This is a custom property defined on this element
        const val = computed.getPropertyValue(prop).trim();
        if (val) result.set(prop, val);
      }
    }
  }

  // Resolve referenced vars from the root's computed style (they cascade)
  const rootComputed = window.getComputedStyle(root);
  for (const varName of referencedVars) {
    if (!result.has(varName)) {
      // Walk up from root to find the variable value
      let current: Element | null = root;
      while (current) {
        const val = window.getComputedStyle(current).getPropertyValue(varName).trim();
        if (val) {
          result.set(varName, val);
          break;
        }
        current = current.parentElement;
      }
    }
  }

  return result;
}

/**
 * Capture parent layout context that materially affects how the root renders.
 * Returns CSS properties for a wrapper element.
 */
function getParentContext(root: Element): Map<string, string> | null {
  const parent = root.parentElement;
  if (!parent) return null;

  const parentComputed = window.getComputedStyle(parent);
  const display = parentComputed.getPropertyValue('display');

  // Only capture context for layout containers that affect children
  const isLayoutContainer = display.includes('flex') || display.includes('grid');
  const isPositioned = parentComputed.getPropertyValue('position') !== 'static';

  if (!isLayoutContainer && !isPositioned) return null;

  const context = new Map<string, string>();
  for (const prop of PARENT_CONTEXT_PROPS) {
    const val = parentComputed.getPropertyValue(prop);
    if (val) {
      // For baseline comparison — only include non-default values
      const baseline = prop === 'display' ? 'block' : '';
      if (val !== baseline) {
        context.set(prop, val);
      }
    }
  }

  return context.size > 0 ? context : null;
}

/**
 * Format a Map of CSS properties into a declaration block string.
 */
function formatDeclarations(styles: Map<string, string>): string {
  const lines: string[] = [];
  for (const [prop, val] of styles) {
    lines.push(`  ${prop}: ${val};`);
  }
  return lines.join('\n');
}

/**
 * Assign scoped class names to elements in the subtree.
 * Returns a map from element to its scoped class name.
 */
function assignScopedClasses(root: Element): Map<Element, string> {
  const map = new Map<Element, string>();
  let counter = 0;

  function walk(el: Element) {
    map.set(el, `${SCOPE_PREFIX}${counter++}`);
    for (const child of el.children) {
      walk(child);
    }
  }

  walk(root);
  return map;
}

/**
 * Clone the element subtree with user-visible state preserved:
 * - Form values (input, textarea, select)
 * - Canvas content (as data URL)
 * - Image sources
 */
function cloneWithState(root: Element): Element {
  const clone = root.cloneNode(true) as Element;

  // Sync form control values
  const origInputs = root.querySelectorAll('input, textarea, select');
  const cloneInputs = clone.querySelectorAll('input, textarea, select');

  origInputs.forEach((orig, i) => {
    const cloned = cloneInputs[i];
    if (!cloned) return;

    if (orig instanceof HTMLInputElement && cloned instanceof HTMLInputElement) {
      if (orig.type === 'checkbox' || orig.type === 'radio') {
        cloned.checked = orig.checked;
      } else {
        cloned.value = orig.value;
      }
    } else if (orig instanceof HTMLTextAreaElement && cloned instanceof HTMLTextAreaElement) {
      cloned.value = orig.value;
      cloned.textContent = orig.value;
    } else if (orig instanceof HTMLSelectElement && cloned instanceof HTMLSelectElement) {
      cloned.selectedIndex = orig.selectedIndex;
    }
  });

  // Convert canvas elements to images
  const origCanvases = root.querySelectorAll('canvas');
  const cloneCanvases = clone.querySelectorAll('canvas');
  origCanvases.forEach((origCanvas, i) => {
    const clonedCanvas = cloneCanvases[i];
    if (!clonedCanvas) return;
    try {
      const img = document.createElement('img');
      img.src = origCanvas.toDataURL();
      img.width = origCanvas.width;
      img.height = origCanvas.height;
      clonedCanvas.replaceWith(img);
    } catch {
      // Canvas may be tainted (cross-origin), skip conversion
    }
  });

  return clone;
}

// =============================================================================
// Public API
// =============================================================================

export interface ExtractionResult {
  /** Self-contained HTML with embedded <style> */
  snippet: string;
  /** Just the CSS rules */
  css: string;
  /** Just the HTML (with scoped class attributes) */
  html: string;
}

/**
 * Extract a full self-contained snippet from a DOM subtree.
 *
 * Walks the subtree, captures computed styles for every element,
 * pseudo-elements, CSS variables, and parent layout context.
 * Returns a portable HTML+CSS export.
 */
export function extractElement(root: Element): ExtractionResult {
  const classMap = assignScopedClasses(root);
  const baselineCache = new Map<string, CSSStyleDeclaration>();
  const cssRules: string[] = [];

  // 1. Collect CSS variables used in the subtree
  const cssVars = collectCssVariables(root);
  if (cssVars.size > 0) {
    const varLines: string[] = [];
    for (const [name, val] of cssVars) {
      varLines.push(`  ${name}: ${val};`);
    }
    cssRules.push(`.${SCOPE_PREFIX}root {\n${varLines.join('\n')}\n}`);
  }

  // 2. Capture parent layout context
  const parentContext = getParentContext(root);
  if (parentContext) {
    cssRules.push(`.${SCOPE_PREFIX}parent {\n${formatDeclarations(parentContext)}\n}`);
  }

  // 3. Walk the subtree and capture styles for each element
  let isFirst = true;
  for (const [el, className] of classMap) {
    const styles = getMeaningfulStyles(el, isFirst, baselineCache);
    isFirst = false;

    if (styles.size > 0) {
      cssRules.push(`.${className} {\n${formatDeclarations(styles)}\n}`);
    }

    // 4. Capture pseudo-elements
    for (const pseudo of PSEUDO_ELEMENTS) {
      const pseudoStyles = getPseudoStyles(el, pseudo);
      if (pseudoStyles) {
        cssRules.push(`.${className}${pseudo} {\n${formatDeclarations(pseudoStyles)}\n}`);
      }
    }
  }

  // 5. Clone the DOM with state preserved and apply scoped classes
  const clone = cloneWithState(root);

  // Apply scoped classes to the clone
  const origElements = [root, ...root.querySelectorAll('*')];
  const cloneElements = [clone, ...clone.querySelectorAll('*')];

  for (let i = 0; i < origElements.length; i++) {
    const origEl = origElements[i];
    const cloneEl = cloneElements[i];
    const className = classMap.get(origEl);
    if (className && cloneEl) {
      cloneEl.classList.add(className);
      // Add root marker for CSS variables scope
      if (i === 0) cloneEl.classList.add(`${SCOPE_PREFIX}root`);
    }
  }

  // 6. Build output
  const css = cssRules.join('\n\n');
  const html = parentContext
    ? `<div class="${SCOPE_PREFIX}parent">\n${clone.outerHTML}\n</div>`
    : clone.outerHTML;

  const snippet = `<style>\n${css}\n</style>\n\n${html}`;

  return { snippet, css, html };
}

/**
 * Extract just CSS for the subtree (backward compat with old "Copy CSS" behavior).
 */
export function extractCssOnly(root: Element): string {
  return extractElement(root).css;
}

/**
 * Extract just the full snippet.
 */
export function extractSnippet(root: Element): string {
  return extractElement(root).snippet;
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/content/style-extractor.ts`
Expected: No errors (or only pre-existing errors from other files)

**Step 3: Commit**

```bash
git add src/content/style-extractor.ts
git commit -m "feat: add style-extractor module for full subtree CSS extraction"
```

---

### Task 2: Update element-copier.ts to use new extractor

**Files:**
- Modify: `src/content/element-copier.ts`

**Step 1: Replace button handlers**

Update `element-copier.ts` to:
1. Import `extractSnippet`, `extractCssOnly` from `./style-extractor`
2. Remove the old `getMeaningfulStyles` function and related constants (`IGNORED_PREFIXES`, `IGNORED_PROPS`)
3. Change "Copy CSS" button to call `extractCssOnly(el)` instead of `getMeaningfulStyles(el)`
4. Change "Copy HTML" button to "Copy Snippet" and call `extractSnippet(el)` instead of `el.outerHTML`

The import:
```typescript
import { extractSnippet, extractCssOnly } from './style-extractor';
```

The new `showPopup` button wiring (only the event handlers change):

```typescript
  const cssBtn = document.createElement('button');
  cssBtn.className = 'seo-ec-btn';
  cssBtn.textContent = 'Copy CSS';
  cssBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const css = extractCssOnly(el);
    navigator.clipboard.writeText(css).then(() => showCopied(cssBtn));
  });

  const snippetBtn = document.createElement('button');
  snippetBtn.className = 'seo-ec-btn';
  snippetBtn.textContent = 'Copy Snippet';
  snippetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const snippet = extractSnippet(el);
    navigator.clipboard.writeText(snippet).then(() => showCopied(snippetBtn));
  });

  popup.appendChild(cssBtn);
  popup.appendChild(snippetBtn);
```

**Step 2: Verify build**

Run: `npm run build` (or `npx tsc --noEmit`)
Expected: No errors

**Step 3: Commit**

```bash
git add src/content/element-copier.ts
git commit -m "feat: wire element copier to full subtree style extractor"
```

---

### Task 3: Update popup description text

**Files:**
- Modify: `public/popup.html:112-115`

**Step 1: Update the toggle description**

Change:
```html
        <div class="toggle-desc">Click to copy CSS or HTML</div>
```

To:
```html
        <div class="toggle-desc">Click to copy CSS or full snippet</div>
```

**Step 2: Commit**

```bash
git add public/popup.html
git commit -m "chore: update element copier description in popup"
```
