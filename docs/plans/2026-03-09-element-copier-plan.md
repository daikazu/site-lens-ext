# Element Copier Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone element picker tool that copies an element's meaningful CSS or outer HTML to clipboard.

**Architecture:** New `element-copier.ts` content script following the same pattern as `font-inspector.ts`. Toggled from the popup via message passing through `analyzer.ts`. Mutual exclusion with font inspector handled in `analyzer.ts`.

**Tech Stack:** TypeScript, Chrome Extension APIs (runtime messaging, clipboard)

---

### Task 1: Create element-copier.ts — Core module

**Files:**
- Create: `src/content/element-copier.ts`

**Step 1: Create the element copier module**

```typescript
let active = false;
let popup: HTMLDivElement | null = null;
let styleEl: HTMLStyleElement | null = null;
let currentTarget: Element | null = null;
let selectedTarget: Element | null = null;

const POPUP_ID = 'seo-ext-copier-popup';
const STYLE_ID = 'seo-ext-element-copier-style';
const OUTLINE_CLASS = 'seo-ext-copier-inspected';

const IGNORED_PREFIXES = ['-webkit-', '-moz-', '-ms-', '-o-'];
const IGNORED_PROPS = ['perspective-origin', 'transform-origin'];

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = `
    .seo-ext-element-copier-active, .seo-ext-element-copier-active * {
      cursor: crosshair !important;
    }
    .${OUTLINE_CLASS} {
      outline: 2px dashed #f0b429 !important;
      outline-offset: 2px !important;
    }
    #${POPUP_ID} {
      position: fixed;
      z-index: 2147483647;
      background: #1e1e1e;
      color: #d4d4d4;
      border: 1px solid #444;
      border-radius: 6px;
      padding: 10px 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      font-size: 12px;
      line-height: 1.6;
      pointer-events: auto;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      display: flex;
      gap: 8px;
    }
    #${POPUP_ID} .seo-ec-title {
      color: #4ec9b0;
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
      border-bottom: 1px solid #333;
      padding-bottom: 4px;
    }
    #${POPUP_ID} .seo-ec-btn {
      background: #2a2a2a;
      border: 1px solid #444;
      color: #d4d4d4;
      font-size: 11px;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }
    #${POPUP_ID} .seo-ec-btn:hover {
      background: #333;
      border-color: #555;
      color: #fff;
    }
    #${POPUP_ID} .seo-ec-btn.copied {
      background: #1a3a2a;
      border-color: #4ec9b0;
      color: #4ec9b0;
    }
  `;
  document.head.appendChild(styleEl);
}

function getMeaningfulStyles(el: Element): string {
  const computed = window.getComputedStyle(el);
  const tag = el.tagName.toLowerCase();

  // Create a baseline element to compare against
  const baseline = document.createElement(tag);
  baseline.style.position = 'absolute';
  baseline.style.visibility = 'hidden';
  baseline.style.pointerEvents = 'none';
  document.body.appendChild(baseline);
  const baseComputed = window.getComputedStyle(baseline);

  const lines: string[] = [];

  for (let i = 0; i < computed.length; i++) {
    const prop = computed[i];

    if (IGNORED_PREFIXES.some(p => prop.startsWith(p))) continue;
    if (IGNORED_PROPS.includes(prop)) continue;

    const val = computed.getPropertyValue(prop);
    const baseVal = baseComputed.getPropertyValue(prop);

    if (val !== baseVal) {
      lines.push(`${prop}: ${val};`);
    }
  }

  baseline.remove();
  return lines.join('\n');
}

function createPopup() {
  popup = document.createElement('div');
  popup.id = POPUP_ID;
  popup.style.display = 'none';
  document.body.appendChild(popup);
}

function showPopup(el: Element, x: number, y: number) {
  if (!popup) return;
  selectedTarget = el;
  popup.textContent = '';

  const cssBtn = document.createElement('button');
  cssBtn.className = 'seo-ec-btn';
  cssBtn.textContent = 'Copy CSS';
  cssBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const css = getMeaningfulStyles(el);
    navigator.clipboard.writeText(css).then(() => showCopied(cssBtn));
  });

  const htmlBtn = document.createElement('button');
  htmlBtn.className = 'seo-ec-btn';
  htmlBtn.textContent = 'Copy HTML';
  htmlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(el.outerHTML).then(() => showCopied(htmlBtn));
  });

  popup.appendChild(cssBtn);
  popup.appendChild(htmlBtn);
  popup.style.display = 'flex';

  // Position with overflow prevention
  requestAnimationFrame(() => {
    if (!popup) return;
    const rect = popup.getBoundingClientRect();
    const pad = 16;
    let left = x + pad;
    let top = y + pad;
    if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
    if (top + rect.height > window.innerHeight) top = y - rect.height - pad;
    popup.style.left = `${Math.max(0, left)}px`;
    popup.style.top = `${Math.max(0, top)}px`;
  });
}

function showCopied(btn: HTMLButtonElement) {
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    hidePopup();
  }, 800);
}

function hidePopup() {
  if (popup) popup.style.display = 'none';
  if (selectedTarget) {
    selectedTarget.classList.remove(OUTLINE_CLASS);
    selectedTarget = null;
  }
}

function handleMouseMove(e: MouseEvent) {
  if (!active || selectedTarget) return;

  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el === popup || el.closest(`#${POPUP_ID}`)) return;

  if (currentTarget !== el) {
    if (currentTarget) currentTarget.classList.remove(OUTLINE_CLASS);
    currentTarget = el;
    el.classList.add(OUTLINE_CLASS);
  }
}

function handleClick(e: MouseEvent) {
  if (!active) return;

  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el === popup || el.closest(`#${POPUP_ID}`)) return;

  e.preventDefault();
  e.stopPropagation();

  // If popup is showing, hide it and pick new element
  if (selectedTarget) {
    hidePopup();
  }

  showPopup(el, e.clientX, e.clientY);
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    disableElementCopier();
    chrome.runtime.sendMessage({ type: 'ELEMENT_COPIER_DISABLED' });
  }
}

function handleMouseLeave() {
  if (!selectedTarget) {
    if (currentTarget) currentTarget.classList.remove(OUTLINE_CLASS);
    currentTarget = null;
  }
}

export function enableElementCopier() {
  if (active) return;
  active = true;
  ensureStyles();
  document.documentElement.classList.add('seo-ext-element-copier-active');
  if (!popup) createPopup();
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('mouseleave', handleMouseLeave, true);
  document.addEventListener('keydown', handleKeyDown, true);
}

export function disableElementCopier() {
  if (!active) return;
  active = false;
  document.documentElement.classList.remove('seo-ext-element-copier-active');
  document.removeEventListener('mousemove', handleMouseMove, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('mouseleave', handleMouseLeave, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  if (currentTarget) currentTarget.classList.remove(OUTLINE_CLASS);
  currentTarget = null;
  if (selectedTarget) selectedTarget.classList.remove(OUTLINE_CLASS);
  selectedTarget = null;
  if (popup) {
    popup.remove();
    popup = null;
  }
}

export function toggleElementCopier(): boolean {
  if (active) {
    disableElementCopier();
  } else {
    enableElementCopier();
  }
  return active;
}
```

**Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/content/element-copier.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/content/element-copier.ts
git commit -m "feat: add element-copier content script"
```

---

### Task 2: Wire up message handling in analyzer.ts

**Files:**
- Modify: `src/content/analyzer.ts:1-4` (imports)
- Modify: `src/content/analyzer.ts:458-494` (message listener)

**Step 1: Add import and mutual exclusion**

At the top of `analyzer.ts`, add the import:

```typescript
import { toggleElementCopier, disableElementCopier } from './element-copier';
```

In the message listener (after the `TOGGLE_FONT_INSPECTOR` handler at line 471-474), add:

```typescript
  if (message.type === 'TOGGLE_ELEMENT_COPIER') {
    // Mutual exclusion: disable font inspector if active
    const fontResult = toggleFontInspector();
    if (fontResult) {
      // Font inspector was just enabled by toggle, so it was off — turn it back off
    } else {
      // It was on and we just turned it off — but we need to check if it was actually on
    }
    // Simpler approach: just disable font inspector unconditionally before toggling copier
    // We need to rethink — the toggleFontInspector returns the NEW state
    const isActive = toggleElementCopier();
    sendResponse({ active: isActive });
  }
```

Wait — the mutual exclusion needs more care. The font inspector's `disableFontInspector` is not exported, only `toggleFontInspector`. Let me check...

Actually, looking at `font-inspector.ts` lines 214-227, `disableFontInspector` IS exported. Same for element copier. So the correct approach:

Add to `analyzer.ts` imports:

```typescript
import { toggleFontInspector, disableFontInspector } from './font-inspector';
import { toggleElementCopier, disableElementCopier } from './element-copier';
```

Update the `TOGGLE_FONT_INSPECTOR` handler to also disable element copier:

```typescript
  if (message.type === 'TOGGLE_FONT_INSPECTOR') {
    disableElementCopier();
    const isActive = toggleFontInspector();
    sendResponse({ active: isActive });
  }
```

Add the new handler:

```typescript
  if (message.type === 'TOGGLE_ELEMENT_COPIER') {
    disableFontInspector();
    const isActive = toggleElementCopier();
    sendResponse({ active: isActive });
  }
```

**Step 2: Verify build**

Run: `npm run build` (or the project's build command)
Expected: No errors

**Step 3: Commit**

```bash
git add src/content/analyzer.ts
git commit -m "feat: wire element copier message handling with mutual exclusion"
```

---

### Task 3: Handle ELEMENT_COPIER_DISABLED in service worker

**Files:**
- Modify: `src/background/service-worker.ts:1-5`

**Step 1: Add the handler**

Add alongside the existing `FONT_INSPECTOR_DISABLED` handler:

```typescript
  if (message.type === 'ELEMENT_COPIER_DISABLED' && sender.tab?.id) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: '' });
    return false;
  }
```

**Step 2: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "feat: handle element copier disabled message in service worker"
```

---

### Task 4: Add Element Copier toggle to popup UI

**Files:**
- Modify: `public/popup.html:102-111` (Tools section)
- Modify: `public/popup.js`

**Step 1: Add toggle row to popup.html**

After the font-toggle row (line 110), add:

```html
    <div class="toggle-row" id="copier-toggle">
      <div>
        <div class="toggle-label">Element Copier</div>
        <div class="toggle-desc">Click to copy CSS or HTML</div>
      </div>
      <div class="toggle-switch"></div>
    </div>
```

**Step 2: Add copier toggle handler to popup.js**

Add `let copierActive = false;` at the top (line 3, after `let fontActive = false;`).

Add the toggle handler after the font inspector toggle handler (after line 54):

```javascript
// Element Copier toggle
document.getElementById('copier-toggle').addEventListener('click', () => {
  sendToTab({ type: 'TOGGLE_ELEMENT_COPIER' }).then(res => {
    if (!res) return;
    copierActive = res.active;
    document.getElementById('copier-toggle').classList.toggle('active', copierActive);
    // Mutual exclusion: if copier is now active, font inspector is off
    if (copierActive) {
      fontActive = false;
      document.getElementById('font-toggle').classList.remove('active');
    }
    getTab().then(tab => {
      if (tab && tab.id) {
        chrome.action.setBadgeText({ tabId: tab.id, text: copierActive ? 'ON' : '' });
        chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#f0b429' });
      }
    });
  });
});
```

**Step 3: Update font inspector toggle for mutual exclusion**

Modify the existing font toggle handler to also deactivate copier UI:

```javascript
// Font Inspector toggle
document.getElementById('font-toggle').addEventListener('click', () => {
  sendToTab({ type: 'TOGGLE_FONT_INSPECTOR' }).then(res => {
    if (!res) return;
    fontActive = res.active;
    document.getElementById('font-toggle').classList.toggle('active', fontActive);
    // Mutual exclusion: if font inspector is now active, copier is off
    if (fontActive) {
      copierActive = false;
      document.getElementById('copier-toggle').classList.remove('active');
    }
    getTab().then(tab => {
      if (tab && tab.id) {
        chrome.action.setBadgeText({ tabId: tab.id, text: fontActive ? 'ON' : '' });
        chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#4fc1ff' });
      }
    });
  });
});
```

**Step 4: Update reset handler to also disable copier**

In the reset handler (line 90-108), add copier cleanup:

```javascript
  if (copierActive) {
    sendToTab({ type: 'TOGGLE_ELEMENT_COPIER' }).then(() => {
      copierActive = false;
      document.getElementById('copier-toggle').classList.remove('active');
      getTab().then(tab => {
        if (tab && tab.id) chrome.action.setBadgeText({ tabId: tab.id, text: '' });
      });
    });
  }
```

**Step 5: Verify build and test manually**

Run: `npm run build`
Expected: No errors. Load extension in Chrome, verify both toggles work, mutual exclusion works, copy buttons work.

**Step 6: Commit**

```bash
git add public/popup.html public/popup.js
git commit -m "feat: add element copier toggle to popup with mutual exclusion"
```

---

### Task 5: Manual testing checklist

1. Toggle element copier ON — crosshair cursor appears, elements outline on hover
2. Click an element — popup appears with "Copy CSS" and "Copy HTML" buttons
3. Click "Copy CSS" — button shows "Copied!", popup dismisses, clipboard has meaningful CSS only
4. Click "Copy HTML" — same flow, clipboard has outerHTML
5. Press Esc — copier deactivates, badge clears
6. Toggle font inspector while copier is on — copier deactivates, font inspector activates
7. Toggle copier while font inspector is on — font inspector deactivates, copier activates
8. Reset All button — both tools deactivate
9. Click a different element after popup shows — old popup dismisses, new one appears
