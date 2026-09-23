// --- Overview ---
export interface OverviewData {
  title: { value: string; length: number };
  description: { value: string; length: number };
  keywords: string;
  url: string;
  canonical: { value: string | null; matches: boolean };
  robots: string | null;
  googlebot: string | null;
  viewport: string | null;
  charset: string | null;
  lang: string | null;
  favicon: string | null;
  httpStatus: number | null; // from Navigation Timing; null when the browser doesn't report it
  redirected: boolean;
}

// The page as the server sends it, before JavaScript runs.
export interface PageSourceResult {
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  redirected: boolean;
  headers: Record<string, string>;  // lowercased names
  html: string | null;              // null for non-HTML responses
  truncated: boolean;
  error?: string;
}

export interface RobotsTxtResult {
  url: string;
  status: number | null;
  contentType: string | null;
  content: string | null;  // null unless the response is a real text file
  error?: string;
}

export interface SitemapCheck {
  url: string;
  status: number | null;
  kind: 'urlset' | 'index' | 'invalid' | 'unreachable';
  urlCount: number;
  containsPage: boolean;
  children?: SitemapCheck[];  // for sitemap indexes, the child sitemaps that were checked
  error?: string;
}

export interface SitemapsResult {
  sitemaps: SitemapCheck[];
  containsPage: boolean | null;  // null when not every sitemap could be checked
  checkedLimitReached: boolean;
}

// --- Headings ---
export interface HeadingItem {
  tag: string;
  text: string;
  level: number;
}

export interface HeadingsData {
  items: HeadingItem[];
  counts: Record<string, number>;
  warnings: string[];
}

// --- Content ---
export interface ContentData {
  wordCount: number;
  textToHtmlRatio: number;
  readabilityScore: number;
  readabilityGrade: string;
  density: {
    oneWord: { word: string; count: number; percentage: number }[];
    twoWord: { word: string; count: number; percentage: number }[];
    threeWord: { word: string; count: number; percentage: number }[];
  };
}

// --- Links ---
export interface LinkItem {
  href: string;
  anchorText: string;
  rel: string;
  isInternal: boolean;
  isExternal: boolean;
  hasNofollow: boolean;
  statusCode?: number;
  redirectUrl?: string;
  issues: string[];
}

export interface LinkCheckResult {
  status: number; // 0 = unreachable (network error, DNS, timeout)
  redirected: boolean;
  finalUrl?: string;
  error?: string;
}

export interface LinksData {
  internal: LinkItem[];
  external: LinkItem[];
  bad: LinkItem[];
  warnings: string[];
  totalCount: number;
}

// --- Images ---
export type ImageSource =
  | 'img'
  | 'picture'
  | 'css-bg'
  | 'svg'
  | 'video-poster'
  | 'favicon'
  | 'meta';

// How assistive technology treats the image (W3C image categories). Null where it doesn't
// apply: favicons, meta images, video posters, and <picture> sources.
export type ImageRole = 'content' | 'functional' | 'decorative' | 'missing';

export interface ImageItem {
  src: string;            // absolute URL or data: URI
  source: ImageSource;
  role: ImageRole | null;
  alt: string;            // empty string if not applicable
  width: number | null;
  height: number | null;
  loading: string | null;
  fileSize?: number;
  issues: string[];
}

export interface OgImageData {
  url: string | null;
  width: string | null;
  height: string | null;
  type: string | null;
  alt: string | null;
}

export interface TwitterImageData {
  card: string | null;
  image: string | null;
  imageAlt: string | null;
}

export interface ImagesData {
  items: ImageItem[];
  og: OgImageData;
  twitter: TwitterImageData;
  warnings: string[];
}

// --- Schema ---
export interface SchemaItem {
  type: string;
  format: 'json-ld' | 'microdata' | 'rdfa';
  raw: string;
  parsed: Record<string, unknown>;
  issues: string[];
}

export interface SchemaData {
  items: SchemaItem[];
  warnings: string[];
}

// --- Technical ---
export type ResourceCategoryName = 'HTML' | 'JavaScript' | 'CSS' | 'Images' | 'Fonts' | 'Media' | 'XHR / fetch' | 'Other';

export interface ResourceCategory {
  name: ResourceCategoryName;
  bytes: number;       // compressed body size of the requests that could be measured
  requests: number;
  unmeasured: number;  // cross-origin requests without Timing-Allow-Origin report no size
}

export interface PerformanceMetrics {
  ttfb: number | null;              // ms
  fcp: number | null;               // ms
  lcp: number | null;               // ms
  cls: number | null;               // unitless
  domContentLoaded: number | null;  // ms
  load: number | null;              // ms
}

export interface TechnicalData {
  hreflang: { lang: string; url: string }[];
  pageWeight: {
    categories: ResourceCategory[];
    totalBytes: number;
    totalRequests: number;
    unmeasured: number;
  };
  domains: { host: string; requests: number; bytes: number; sameSite: boolean }[];
  protocols: { protocol: string; requests: number }[];
  documentProtocol: string | null;
  renderBlocking: string[];
  mixedContent: string[];
  domElements: number;
  performance: PerformanceMetrics;
}

// --- Preview ---
export interface PreviewData {
  title: string;
  description: string;
  url: string;
  favicon: string | null;
  og: {
    title: string | null;
    description: string | null;
    image: string | null;
    siteName: string | null;
    type: string | null;
    url: string | null;
  };
  twitter: {
    card: string | null;
    title: string | null;
    description: string | null;
    image: string | null;
    site: string | null;
  };
}

// --- Combined ---
export interface AnalysisResult {
  overview: OverviewData;
  headings: HeadingsData;
  content: ContentData;
  links: LinksData;
  images: ImagesData;
  schema: SchemaData;
  technical: TechnicalData;
  preview: PreviewData;
  timestamp: number;
  url: string;
}

// --- Messages ---
export type MessageType =
  | { type: 'ANALYZE_PAGE'; tabId: number }
  | { type: 'DEEP_SCAN_LINKS'; tabId: number; urls: string[] }
  | { type: 'FETCH_ROBOTS'; origin: string }
  | { type: 'CHECK_SITEMAPS'; urls: string[]; pageUrls: string[] }
  | { type: 'FETCH_IMAGE'; url: string }
  | { type: 'HIGHLIGHT_LINKS'; tabId: number; mode: HighlightMode }
  | { type: 'CLEAR_HIGHLIGHTS'; tabId: number }
  | { type: 'FETCH_PAGE_SOURCE'; url: string };

export type FetchImageResponse =
  | { ok: true; bytesB64: string; contentType: string; status: number }
  | { ok: false; error: string; status?: number };

export type HighlightMode = 'internal' | 'external' | 'nofollow' | 'broken' | 'all' | 'none';
