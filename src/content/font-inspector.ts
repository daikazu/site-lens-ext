let active = false;
let tooltip: HTMLDivElement | null = null;
let styleEl: HTMLStyleElement | null = null;
let currentTarget: Element | null = null;

const TOOLTIP_ID = 'seo-ext-font-tooltip';
const STYLE_ID = 'seo-ext-font-inspector-style';
const OUTLINE_CLASS = 'seo-ext-font-inspected';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = `
    .seo-ext-font-inspector-active, .seo-ext-font-inspector-active * {
      cursor: crosshair !important;
    }
    .${OUTLINE_CLASS} {
      outline: 2px dashed #4fc1ff !important;
      outline-offset: 2px !important;
    }
    #${TOOLTIP_ID} {
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
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      max-width: 380px;
      white-space: nowrap;
    }
    #${TOOLTIP_ID} .seo-fi-row {
      display: flex;
      gap: 8px;
    }
    #${TOOLTIP_ID} .seo-fi-label {
      color: #888;
      min-width: 90px;
      flex-shrink: 0;
    }
    #${TOOLTIP_ID} .seo-fi-value {
      color: #4fc1ff;
      font-weight: 600;
    }
    #${TOOLTIP_ID} .seo-fi-color-swatch {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 2px;
      border: 1px solid #666;
      vertical-align: middle;
      margin-right: 6px;
    }
    #${TOOLTIP_ID} .seo-fi-title {
      color: #4ec9b0;
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
      border-bottom: 1px solid #333;
      padding-bottom: 4px;
    }
  `;
  document.head.appendChild(styleEl);
}

function createTooltip() {
  tooltip = document.createElement('div');
  tooltip.id = TOOLTIP_ID;
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getFontInfo(el: Element) {
  const styles = window.getComputedStyle(el);

  const weightMap: Record<string, string> = {
    '100': '100 (Thin)',
    '200': '200 (Extra Light)',
    '300': '300 (Light)',
    '400': '400 (Regular)',
    '500': '500 (Medium)',
    '600': '600 (Semi Bold)',
    '700': '700 (Bold)',
    '800': '800 (Extra Bold)',
    '900': '900 (Black)',
  };

  return {
    fontFamily: styles.fontFamily,
    fontSize: styles.fontSize,
    fontWeight: weightMap[styles.fontWeight] || styles.fontWeight,
    fontStyle: styles.fontStyle,
    lineHeight: styles.lineHeight,
    letterSpacing: styles.letterSpacing,
    color: styles.color,
    textTransform: styles.textTransform,
    textDecoration: styles.textDecoration,
    tag: el.tagName.toLowerCase(),
  };
}

function buildTooltipContent(info: ReturnType<typeof getFontInfo>): void {
  if (!tooltip) return;
  tooltip.textContent = '';

  const title = document.createElement('div');
  title.className = 'seo-fi-title';
  title.textContent = `Font Inspector — <${info.tag}>`;
  tooltip.appendChild(title);

  const rows: [string, string, string?][] = [
    ['Font:', info.fontFamily],
    ['Size:', info.fontSize],
    ['Weight:', info.fontWeight],
    ['Style:', info.fontStyle],
    ['Line Height:', info.lineHeight],
    ['Spacing:', info.letterSpacing],
    ['Color:', info.color, info.color],
    ['Transform:', info.textTransform],
    ['Decoration:', info.textDecoration],
  ];

  for (const [label, value, swatchColor] of rows) {
    const row = document.createElement('div');
    row.className = 'seo-fi-row';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'seo-fi-label';
    labelSpan.textContent = label;
    row.appendChild(labelSpan);

    const valueSpan = document.createElement('span');
    valueSpan.className = 'seo-fi-value';

    if (swatchColor) {
      const swatch = document.createElement('span');
      swatch.className = 'seo-fi-color-swatch';
      swatch.style.background = swatchColor;
      valueSpan.appendChild(swatch);
    }

    valueSpan.appendChild(document.createTextNode(value));
    row.appendChild(valueSpan);
    tooltip.appendChild(row);
  }
}

function handleMouseMove(e: MouseEvent) {
  if (!active || !tooltip) return;

  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el === tooltip || el.closest(`#${TOOLTIP_ID}`)) return;

  if (currentTarget !== el) {
    if (currentTarget) currentTarget.classList.remove(OUTLINE_CLASS);
    currentTarget = el;
    el.classList.add(OUTLINE_CLASS);
    buildTooltipContent(getFontInfo(el));
  }

  tooltip.style.display = 'block';

  const pad = 16;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  const rect = tooltip.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - pad;
  tooltip.style.left = `${Math.max(0, x)}px`;
  tooltip.style.top = `${Math.max(0, y)}px`;
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    disableFontInspector();
    chrome.runtime.sendMessage({ type: 'FONT_INSPECTOR_DISABLED' });
  }
}

function handleMouseLeave() {
  if (currentTarget) currentTarget.classList.remove(OUTLINE_CLASS);
  currentTarget = null;
  if (tooltip) tooltip.style.display = 'none';
}

export function enableFontInspector() {
  if (active) return;
  active = true;
  ensureStyles();
  document.documentElement.classList.add('seo-ext-font-inspector-active');
  if (!tooltip) createTooltip();
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('mouseleave', handleMouseLeave, true);
  document.addEventListener('keydown', handleKeyDown, true);
}

export function disableFontInspector() {
  if (!active) return;
  active = false;
  document.documentElement.classList.remove('seo-ext-font-inspector-active');
  document.removeEventListener('mousemove', handleMouseMove, true);
  document.removeEventListener('mouseleave', handleMouseLeave, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  if (currentTarget) currentTarget.classList.remove(OUTLINE_CLASS);
  currentTarget = null;
  if (tooltip) {
    tooltip.remove();
    tooltip = null;
  }
}

export function toggleFontInspector(): boolean {
  if (active) {
    disableFontInspector();
  } else {
    enableFontInspector();
  }
  return active;
}
