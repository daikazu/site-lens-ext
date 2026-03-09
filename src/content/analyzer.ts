import type { AnalysisResult } from '../shared/types';
import { highlightLinks, clearHighlights } from './highlighter';
import { toggleFontInspector, disableFontInspector } from './font-inspector';
import { toggleElementCopier, disableElementCopier } from './element-copier';
import { setBlur, toggleGrayscale, setColorBlindness, getState as getVisionState, resetAll as resetVision } from './vision-simulator';

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

function analyzeHeadings(): AnalysisResult['headings'] {
  const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const items: { tag: string; text: string; level: number }[] = [];
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

  const levels = items.map((h) => h.level);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      warnings.push(`Skipped heading level: ${items[i - 1].tag.toUpperCase()} to ${items[i].tag.toUpperCase()}`);
    }
  }

  return { items, counts, warnings };
}

function analyzeContent(): AnalysisResult['content'] {
  const body = document.body;
  const text = body?.innerText || '';
  const html = document.documentElement.outerHTML;

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;

  const textLength = text.length;
  const htmlLength = html.length;
  const textToHtmlRatio = htmlLength > 0 ? Math.round((textLength / htmlLength) * 100) : 0;

  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentenceCount = Math.max(sentences.length, 1);
  const syllableCount = words.reduce((sum, word) => sum + countSyllables(word), 0);

  const fleschScore = Math.round(
    206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (syllableCount / Math.max(wordCount, 1))
  );
  const grade = getReadabilityGrade(fleschScore);

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

function analyzeLinks(): AnalysisResult['links'] {
  const links = document.querySelectorAll('a[href]');
  const currentOrigin = window.location.origin;
  const internal: { href: string; anchorText: string; rel: string; isInternal: boolean; isExternal: boolean; hasNofollow: boolean; issues: string[] }[] = [];
  const external: typeof internal = [];
  const bad: typeof internal = [];

  links.forEach((el) => {
    const href = el.getAttribute('href') || '';
    const anchorText = el.textContent?.trim() || '';
    const rel = el.getAttribute('rel') || '';
    const hasNofollow = rel.includes('nofollow');

    const issues: string[] = [];

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

      const item = {
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

  const hrefCounts: Record<string, number> = {};
  [...internal, ...external].forEach((l) => {
    hrefCounts[l.href] = (hrefCounts[l.href] || 0) + 1;
  });
  const dupes = Object.entries(hrefCounts).filter(([, c]) => c > 1);
  if (dupes.length > 0) warnings.push(`${dupes.length} duplicate link(s) found`);

  return { internal, external, bad, warnings, totalCount };
}

function analyzeImages(): AnalysisResult['images'] {
  const imgEls = document.querySelectorAll('img');
  const items: { src: string; alt: string; width: number | null; height: number | null; loading: string | null; issues: string[] }[] = [];
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

  const ogImage = document.querySelector('meta[property="og:image"]');
  const ogWidth = document.querySelector('meta[property="og:image:width"]');
  const ogHeight = document.querySelector('meta[property="og:image:height"]');
  const ogType = document.querySelector('meta[property="og:image:type"]');
  const ogAlt = document.querySelector('meta[property="og:image:alt"]');

  const og = {
    url: ogImage?.getAttribute('content') || null,
    width: ogWidth?.getAttribute('content') || null,
    height: ogHeight?.getAttribute('content') || null,
    type: ogType?.getAttribute('content') || null,
    alt: ogAlt?.getAttribute('content') || null,
  };

  const twitterCard = document.querySelector('meta[name="twitter:card"]');
  const twitterImage = document.querySelector('meta[name="twitter:image"]');
  const twitterImageAlt = document.querySelector('meta[name="twitter:image:alt"]');

  const twitter = {
    card: twitterCard?.getAttribute('content') || null,
    image: twitterImage?.getAttribute('content') || null,
    imageAlt: twitterImageAlt?.getAttribute('content') || null,
  };

  return { items, og, twitter, warnings };
}

function analyzeSchema(): AnalysisResult['schema'] {
  const items: { type: string; format: 'json-ld' | 'microdata' | 'rdfa'; raw: string; parsed: Record<string, unknown>; issues: string[] }[] = [];
  const warnings: string[] = [];

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


  const invalidCount = items.filter((i) => i.issues.length > 0).length;
  if (invalidCount > 0) {
    warnings.push(`${invalidCount} schema item(s) have issues`);
  }

  return { items, warnings };
}

function analyzeTechnical(): AnalysisResult['technical'] {
  const hreflangLinks = document.querySelectorAll('link[rel="alternate"][hreflang]');
  const hreflang: { lang: string; url: string }[] = [];
  hreflangLinks.forEach((el) => {
    hreflang.push({
      lang: el.getAttribute('hreflang') || '',
      url: el.getAttribute('href') || '',
    });
  });

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
    robotsTxt: { exists: false, content: null },
    sitemap: { exists: false, url: null, urls: [] },
    hreflang,
    pageWeight: { total, js: jsSize, css: cssSize, images: imageSize, fonts: fontSize, other: otherSize },
    renderBlocking,
    jsRendering: { initialElementCount: 0, renderedElementCount, diff: 0 },
  };
}

function analyzePreview(): AnalysisResult['preview'] {
  const title = document.title || '';
  const descMeta = document.querySelector('meta[name="description"]');
  const description = descMeta?.getAttribute('content') || '';
  const faviconLink = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
  const favicon = faviconLink?.getAttribute('href') || null;

  const getMeta = (attr: string, val: string) =>
    document.querySelector(`meta[${attr}="${val}"]`)?.getAttribute('content') || null;

  return {
    title,
    description,
    url: window.location.href,
    favicon,
    og: {
      title: getMeta('property', 'og:title'),
      description: getMeta('property', 'og:description'),
      image: getMeta('property', 'og:image'),
      siteName: getMeta('property', 'og:site_name'),
      type: getMeta('property', 'og:type'),
      url: getMeta('property', 'og:url'),
    },
    twitter: {
      card: getMeta('name', 'twitter:card'),
      title: getMeta('name', 'twitter:title'),
      description: getMeta('name', 'twitter:description'),
      image: getMeta('name', 'twitter:image'),
      site: getMeta('name', 'twitter:site'),
    },
  };
}

function analyzePage(): AnalysisResult {
  return {
    overview: analyzeOverview(),
    headings: analyzeHeadings(),
    content: analyzeContent(),
    links: analyzeLinks(),
    images: analyzeImages(),
    schema: analyzeSchema(),
    technical: analyzeTechnical(),
    preview: analyzePreview(),
    timestamp: Date.now(),
    url: window.location.href,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ANALYZE_PAGE') {
    const result = analyzePage();
    sendResponse(result);
  }
  if (message.type === 'HIGHLIGHT_LINKS') {
    highlightLinks(message.mode);
    sendResponse({ ok: true });
  }
  if (message.type === 'CLEAR_HIGHLIGHTS') {
    clearHighlights();
    sendResponse({ ok: true });
  }
  if (message.type === 'TOGGLE_FONT_INSPECTOR') {
    disableElementCopier();
    const isActive = toggleFontInspector();
    sendResponse({ active: isActive });
  }
  if (message.type === 'TOGGLE_ELEMENT_COPIER') {
    disableFontInspector();
    const isActive = toggleElementCopier();
    sendResponse({ active: isActive });
  }
  if (message.type === 'SET_BLUR') {
    setBlur(message.amount);
    sendResponse({ state: getVisionState() });
  }
  if (message.type === 'TOGGLE_GRAYSCALE') {
    const active = toggleGrayscale();
    sendResponse({ active, state: getVisionState() });
  }
  if (message.type === 'SET_COLOR_BLINDNESS') {
    const active = setColorBlindness(message.cbType);
    sendResponse({ active, state: getVisionState() });
  }
  if (message.type === 'GET_VISION_STATE') {
    sendResponse({ state: getVisionState() });
  }
  if (message.type === 'RESET_VISION') {
    resetVision();
    sendResponse({ state: getVisionState() });
  }
  return true;
});
