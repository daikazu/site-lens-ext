import type { AnalysisResult, ResourceCategory, ResourceCategoryName } from '../shared/types';
import { highlightLinks, clearHighlights } from './highlighter';
import { activeTool, toggleTool } from './tools';
import { setBlur, toggleGrayscale, setColorBlindness, getState as getVisionState, resetAll as resetVision } from './vision-simulator';
import { ALT_ISSUES, PRIORITY_ISSUES, detectImages } from './image-detector';
import { performanceMetrics } from './perf';

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
  const googlebot = document.querySelector('meta[name="googlebot"]')?.getAttribute('content') || null;

  // The real status of this document load (Chrome 109+), without refetching the page.
  const nav = performance.getEntriesByType('navigation')[0] as
    (PerformanceNavigationTiming & { responseStatus?: number }) | undefined;

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
    googlebot,
    viewport,
    charset,
    lang,
    favicon,
    httpStatus: nav?.responseStatus || null,
    redirected: (nav?.redirectCount ?? 0) > 0,
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

// The text search engines and screen readers use for a link: visible text, then aria-label,
// then image alt text, then title.
function linkText(el: Element): string {
  const text = el.textContent?.replace(/\s+/g, ' ').trim();
  if (text) return text;
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return aria;
  const alt = Array.from(el.querySelectorAll('img[alt]'))
    .map((img) => img.getAttribute('alt')?.trim())
    .find(Boolean);
  if (alt) return alt;
  return el.getAttribute('title')?.trim() || '';
}

function analyzeLinks(): AnalysisResult['links'] {
  const links = document.querySelectorAll('a[href]');
  const currentOrigin = window.location.origin;
  const internal: { href: string; anchorText: string; rel: string; isInternal: boolean; isExternal: boolean; hasNofollow: boolean; issues: string[] }[] = [];
  const external: typeof internal = [];
  const bad: typeof internal = [];

  links.forEach((el) => {
    const href = el.getAttribute('href') || '';
    const anchorText = linkText(el);
    const rel = el.getAttribute('rel') || '';
    const hasNofollow = rel.includes('nofollow');

    const issues: string[] = [];

    if (href === '' || href === '#' || href.startsWith('javascript:') || href === 'about:blank') {
      if (href === '') issues.push('Empty href');
      else if (href === '#') issues.push('href="#" goes nowhere (use a <button> for actions)');
      else if (href.startsWith('javascript:')) issues.push('javascript: href (not crawlable)');
      else issues.push('about:blank href');
      bad.push({ href, anchorText, rel, isInternal: false, isExternal: false, hasNofollow, issues });
      return;
    }

    try {
      const url = new URL(href, window.location.href);
      const isWeb = url.protocol === 'http:' || url.protocol === 'https:';
      const isInt = isWeb && url.origin === currentOrigin;

      if (!anchorText) issues.push('No anchor text');

      const item = {
        href: url.href,
        anchorText,
        rel,
        isInternal: isInt,
        isExternal: !isInt,
        hasNofollow,
        issues,
      };

      if (isInt) internal.push(item);
      else external.push(item);
    } catch {
      issues.push('Malformed URL');
      bad.push({ href, anchorText, rel, isInternal: false, isExternal: false, hasNofollow, issues });
    }
  });

  const warnings: string[] = [];
  const totalCount = internal.length + external.length + bad.length;
  if (bad.length > 0) warnings.push(`${bad.length} link(s) with an unusable href (see the Bad list)`);

  const noText = [...internal, ...external].filter((l) => l.issues.includes('No anchor text')).length;
  if (noText > 0) warnings.push(`${noText} link(s) with no anchor text, aria-label, title, or image alt`);

  return { internal, external, bad, warnings, totalCount };
}

function analyzeImages(): AnalysisResult['images'] {
  const items = detectImages();
  const warnings: string[] = [];

  const imgItems = items.filter((i) => i.source === 'img');
  const countIssue = (issue: string) => imgItems.filter((i) => i.issues.includes(issue)).length;
  const missingAlt = countIssue(ALT_ISSUES.missing);
  if (missingAlt > 0) warnings.push(`${missingAlt} image(s) missing alt text`);
  const hiddenNoAlt = countIssue(ALT_ISSUES.hiddenWithoutEmptyAlt);
  if (hiddenNoAlt > 0) warnings.push(`${hiddenNoAlt} decorative image(s) hidden with ARIA but missing alt=""`);
  if (countIssue(PRIORITY_ISSUES.lcpLazy) + countIssue(PRIORITY_ISSUES.lcpLazyHasHigh) > 0) {
    warnings.push('Likely LCP image is lazy-loaded, which delays the main image (see Issues column)');
  } else if (countIssue(PRIORITY_ISSUES.addHigh) > 0) {
    warnings.push('Likely LCP image is missing fetchpriority="high" (see Issues column)');
  }
  const tooManyHigh = countIssue(PRIORITY_ISSUES.tooManyHigh);
  if (tooManyHigh > 0) warnings.push(`${tooManyHigh} extra image(s) use fetchpriority="high"; reserve it for the LCP image`);

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

type ResourceEntry = PerformanceResourceTiming & { renderBlockingStatus?: string; contentType?: string };

const CATEGORY_ORDER: ResourceCategoryName[] = ['HTML', 'JavaScript', 'CSS', 'Images', 'Fonts', 'Media', 'XHR / fetch', 'Other'];

// Classify by MIME type when the browser reports it, then by file extension, then by initiator.
// Initiator alone misleads: fonts and background images loaded from a stylesheet have initiator "css".
function resourceCategory(r: ResourceEntry): ResourceCategoryName {
  const mime = r.contentType ?? '';
  if (mime) {
    if (mime.includes('javascript') || mime.includes('ecmascript')) return 'JavaScript';
    if (mime === 'text/css') return 'CSS';
    if (mime.startsWith('image/')) return 'Images';
    if (mime.startsWith('font/') || mime.includes('font-woff')) return 'Fonts';
    if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'Media';
    if (mime === 'text/html') return 'HTML';
  }
  let path = '';
  try { path = new URL(r.name).pathname.toLowerCase(); } catch { /* keep empty */ }
  if (/\.(woff2?|ttf|otf|eot)$/.test(path)) return 'Fonts';
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/.test(path)) return 'Images';
  if (/\.(mp4|webm|ogv|mov|mp3|m4a|ogg|wav)$/.test(path)) return 'Media';
  if (/\.css$/.test(path)) return 'CSS';
  if (/\.m?js$/.test(path)) return 'JavaScript';
  switch (r.initiatorType) {
    case 'script': return 'JavaScript';
    case 'img': case 'image': return 'Images';
    case 'video': case 'audio': return 'Media';
    case 'fetch': case 'xmlhttprequest': case 'beacon': return 'XHR / fetch';
    default: return 'Other';
  }
}

// Approximate registrable domain ("img.example.co.uk" -> "example.co.uk") to group first-party CDNs.
function siteOf(host: string): string {
  const labels = host.split('.');
  const take = labels.length >= 3 && labels[labels.length - 1].length === 2 && labels[labels.length - 2].length <= 3 ? 3 : 2;
  return labels.slice(-take).join('.');
}

function findMixedContent(resources: ResourceEntry[]): string[] {
  if (location.protocol !== 'https:') return [];
  const found = new Set<string>();
  resources.forEach((r) => { if (r.name.startsWith('http:')) found.add(r.name); });
  // Browsers block active mixed content outright, so it never shows up as a loaded resource.
  document
    .querySelectorAll('img[src^="http:"], script[src^="http:"], iframe[src^="http:"], source[src^="http:"], video[src^="http:"], audio[src^="http:"], link[rel~="stylesheet"][href^="http:"], object[data^="http:"]')
    .forEach((el) => {
      const url = el.getAttribute('src') ?? el.getAttribute('href') ?? el.getAttribute('data');
      if (url) found.add(url);
    });
  document.querySelectorAll('[srcset*="http:"]').forEach((el) => {
    (el.getAttribute('srcset') ?? '').split(',').forEach((part) => {
      const url = part.trim().split(/\s+/)[0];
      if (url.startsWith('http:')) found.add(url);
    });
  });
  return [...found];
}

function analyzeTechnical(): AnalysisResult['technical'] {
  const hreflang: { lang: string; url: string }[] = [];
  document.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el) => {
    hreflang.push({ lang: el.getAttribute('hreflang') || '', url: el.getAttribute('href') || '' });
  });

  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const resources = performance.getEntriesByType('resource') as ResourceEntry[];
  const pageSite = siteOf(location.hostname);

  const categories = new Map<ResourceCategoryName, ResourceCategory>(
    CATEGORY_ORDER.map((name) => [name, { name, bytes: 0, requests: 0, unmeasured: 0 }]),
  );
  const domains = new Map<string, { host: string; requests: number; bytes: number; sameSite: boolean }>();
  const protocols = new Map<string, number>();
  const renderBlocking: string[] = [];

  const html = categories.get('HTML')!;
  html.requests = 1;
  html.bytes = nav?.encodedBodySize || nav?.transferSize || 0;

  for (const r of resources) {
    const category = categories.get(resourceCategory(r))!;
    category.requests++;
    // encodedBodySize is the compressed size, and is still reported for cached responses.
    // Cross-origin responses without Timing-Allow-Origin report zeros, so count them separately.
    const bytes = r.encodedBodySize || r.transferSize;
    let host = '';
    try { host = new URL(r.name).hostname; } catch { /* data: or blob: */ }
    if (bytes > 0) category.bytes += bytes;
    else if (host && host !== location.hostname && r.decodedBodySize === 0) category.unmeasured++;

    if (host) {
      const d = domains.get(host) ?? { host, requests: 0, bytes: 0, sameSite: siteOf(host) === pageSite };
      d.requests++;
      d.bytes += bytes;
      domains.set(host, d);
    }
    const protocol = r.nextHopProtocol || 'unknown';
    protocols.set(protocol, (protocols.get(protocol) ?? 0) + 1);
    if (r.renderBlockingStatus === 'blocking') renderBlocking.push(r.name);
  }

  const categoryList = [...categories.values()].filter((c) => c.requests > 0);
  return {
    hreflang,
    pageWeight: {
      categories: categoryList,
      totalBytes: categoryList.reduce((sum, c) => sum + c.bytes, 0),
      totalRequests: categoryList.reduce((sum, c) => sum + c.requests, 0),
      unmeasured: categoryList.reduce((sum, c) => sum + c.unmeasured, 0),
    },
    domains: [...domains.values()].sort((a, b) => b.requests - a.requests),
    protocols: [...protocols.entries()].map(([protocol, requests]) => ({ protocol, requests })).sort((a, b) => b.requests - a.requests),
    documentProtocol: nav?.nextHopProtocol || null,
    renderBlocking,
    mixedContent: findMixedContent(resources),
    domElements: document.getElementsByTagName('*').length,
    performance: performanceMetrics(),
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
  if (message.type === 'TOGGLE_TOOL') {
    sendResponse({ tool: toggleTool(message.tool) });
  }
  if (message.type === 'GET_TOOL_STATE') {
    sendResponse({ tool: activeTool() });
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
