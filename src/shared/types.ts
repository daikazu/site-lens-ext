// --- Overview ---
export interface OverviewData {
  title: { value: string; length: number };
  description: { value: string; length: number };
  keywords: string;
  url: string;
  canonical: { value: string | null; matches: boolean };
  robots: string | null;
  viewport: string | null;
  charset: string | null;
  lang: string | null;
  favicon: string | null;
  redirectChain: string[];
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

export interface ImageItem {
  src: string;            // absolute URL or data: URI
  source: ImageSource;
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
export interface TechnicalData {
  robotsTxt: { exists: boolean; content: string | null };
  sitemap: { exists: boolean; url: string | null; urls: string[] };
  hreflang: { lang: string; url: string }[];
  pageWeight: {
    total: number;
    js: number;
    css: number;
    images: number;
    fonts: number;
    other: number;
  };
  renderBlocking: string[];
  jsRendering: {
    initialElementCount: number;
    renderedElementCount: number;
    diff: number;
  };
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
  | { type: 'FETCH_ROBOTS'; tabId: number; origin: string }
  | { type: 'FETCH_SITEMAP'; tabId: number; origin: string }
  | { type: 'FETCH_IMAGE'; url: string }
  | { type: 'HIGHLIGHT_LINKS'; tabId: number; mode: HighlightMode }
  | { type: 'CLEAR_HIGHLIGHTS'; tabId: number };

export type FetchImageResponse =
  | { ok: true; bytesB64: string; contentType: string; status: number }
  | { ok: false; error: string; status?: number };

export type HighlightMode = 'internal' | 'external' | 'nofollow' | 'broken' | 'all' | 'none';
