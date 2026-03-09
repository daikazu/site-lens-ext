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

  const baseline = document.createElement(tag);
  baseline.style.position = 'absolute';
  baseline.style.visibility = 'hidden';
  baseline.style.pointerEvents = 'none';
  document.body.appendChild(baseline);
  try {
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

    return lines.join('\n');
  } finally {
    baseline.remove();
  }
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
  if (currentTarget) {
    currentTarget.classList.remove(OUTLINE_CLASS);
    currentTarget = null;
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
