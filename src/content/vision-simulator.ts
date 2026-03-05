const STYLE_ID = 'seo-ext-vision-sim-style';
const SVG_ID = 'seo-ext-vision-sim-svg';

interface VisionState {
  blur: number;
  grayscale: boolean;
  colorBlindness: string | null;
}

const state: VisionState = {
  blur: 0,
  grayscale: false,
  colorBlindness: null,
};

// Color blindness simulation matrices (LMS-based)
const colorMatrices: Record<string, string> = {
  protanopia:
    '0.567, 0.433, 0, 0, 0 ' +
    '0.558, 0.442, 0, 0, 0 ' +
    '0, 0.242, 0.758, 0, 0 ' +
    '0, 0, 0, 1, 0',
  deuteranopia:
    '0.625, 0.375, 0, 0, 0 ' +
    '0.7, 0.3, 0, 0, 0 ' +
    '0, 0.3, 0.7, 0, 0 ' +
    '0, 0, 0, 1, 0',
  tritanopia:
    '0.95, 0.05, 0, 0, 0 ' +
    '0, 0.433, 0.567, 0, 0 ' +
    '0, 0.475, 0.525, 0, 0 ' +
    '0, 0, 0, 1, 0',
  achromatopsia:
    '0.299, 0.587, 0.114, 0, 0 ' +
    '0.299, 0.587, 0.114, 0, 0 ' +
    '0.299, 0.587, 0.114, 0, 0 ' +
    '0, 0, 0, 1, 0',
  protanomaly:
    '0.817, 0.183, 0, 0, 0 ' +
    '0.333, 0.667, 0, 0, 0 ' +
    '0, 0.125, 0.875, 0, 0 ' +
    '0, 0, 0, 1, 0',
  deuteranomaly:
    '0.8, 0.2, 0, 0, 0 ' +
    '0.258, 0.742, 0, 0, 0 ' +
    '0, 0.142, 0.858, 0, 0 ' +
    '0, 0, 0, 1, 0',
  tritanomaly:
    '0.967, 0.033, 0, 0, 0 ' +
    '0, 0.733, 0.267, 0, 0 ' +
    '0, 0.183, 0.817, 0, 0 ' +
    '0, 0, 0, 1, 0',
};

function ensureSvgFilters() {
  if (document.getElementById(SVG_ID)) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = SVG_ID;
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  for (const [name, matrix] of Object.entries(colorMatrices)) {
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.id = `seo-ext-${name}`;
    const feColorMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    feColorMatrix.setAttribute('type', 'matrix');
    feColorMatrix.setAttribute('values', matrix);
    filter.appendChild(feColorMatrix);
    defs.appendChild(filter);
  }
  svg.appendChild(defs);
  document.body.appendChild(svg);
}

function applyFilters() {
  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  const filters: string[] = [];

  if (state.blur > 0) filters.push(`blur(${state.blur}px)`);
  if (state.grayscale) filters.push('grayscale(100%)');
  if (state.colorBlindness && colorMatrices[state.colorBlindness]) {
    ensureSvgFilters();
    filters.push(`url(#seo-ext-${state.colorBlindness})`);
  }

  if (filters.length === 0) {
    if (styleEl) styleEl.remove();
    return;
  }

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = `html { filter: ${filters.join(' ')} !important; }`;
}

export function setBlur(amount: number) {
  state.blur = amount;
  applyFilters();
}

export function toggleGrayscale(): boolean {
  state.grayscale = !state.grayscale;
  applyFilters();
  return state.grayscale;
}

export function setColorBlindness(type: string | null): string | null {
  state.colorBlindness = state.colorBlindness === type ? null : type;
  applyFilters();
  return state.colorBlindness;
}

export function getState(): VisionState {
  return { ...state };
}

export function resetAll() {
  state.blur = 0;
  state.grayscale = false;
  state.colorBlindness = null;
  applyFilters();
}
