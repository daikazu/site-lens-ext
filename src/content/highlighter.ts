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
  style.textContent = `.${HIGHLIGHT_CLASS} { outline-width: 2px !important; outline-style: solid !important; outline-offset: 2px !important; position: relative !important; }`;
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
