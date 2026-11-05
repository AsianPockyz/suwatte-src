import { ContentRating as SuwatteContentRating } from "@suwatte/toolchain";
import "./types.js";
import type {
  ImHentaiCategoryId,
  ImHentaiLanguageId,
  ImHentaiSourceConfiguration,
  ImHentaiTitlePreference,
} from "./types.js";

// Ensure ContentRating.ADULT is defined as 2 (MATURE) on the runtime enum
(SuwatteContentRating as unknown as Record<string, number>).ADULT =
  SuwatteContentRating.MATURE;

export const ContentRating = SuwatteContentRating;

// ============================================================================
// 1. Source Identity & Manifest Metadata
// ============================================================================

export const SOURCE_ID = "org.imhentai";
export const SOURCE_NAME = "IMHentai";
export const SOURCE_VERSION = 1.9;
export const BASE_URL = "https://imhentai.xxx";
export const VARIANT_ID = "org.imhentai";
export const THUMBNAIL_FILENAME = "imhentai.png";
export const SOURCE_ENVIRONMENT = "jsc" as const;

export const SOURCE_LANGUAGES: readonly string[] = Object.freeze([
  "en",
  "ja",
  "zh",
  "es",
  "fr",
  "de",
  "ru",
]);

export const SOURCE_CONTENT_RATING = ContentRating.ADULT;

export const REFERER_URL = "https://imhentai.xxx/";
export const ORIGIN_URL = "https://imhentai.xxx";
export const CLOUDFLARE_RESOLUTION_URL = "https://imhentai.xxx";
export const FALLBACK_COVER_URL = "https://imhentai.xxx/assets/images/logo.png";
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export const STANDARD_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  Referer: REFERER_URL,
  "User-Agent": DEFAULT_USER_AGENT,
});

export const DEFAULT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  Referer: REFERER_URL,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": DEFAULT_USER_AGENT,
});

export const PAGE_IMAGE_HEADERS: Readonly<Record<string, string>> =
  Object.freeze({
    Referer: REFERER_URL,
    "User-Agent": DEFAULT_USER_AGENT,
  });

export const STATIC_CONFIGURATION: ImHentaiSourceConfiguration = Object.freeze({
  imageReferer: REFERER_URL,
  cloudflareResolutionURL: CLOUDFLARE_RESOLUTION_URL,
  standardHeaders: STANDARD_HEADERS,
});

export const RATE_LIMIT_PER_SECOND = 3;
export const DEFAULT_SERVER_ID = "1";
export const DEFAULT_IMAGE_EXT = "jpg";

// ============================================================================
// 1.1 E-Hentai Discovery Constants
// ============================================================================

export const EHENTAI_BASE_URL = "https://e-hentai.org";
export const EHENTAI_API_URL = "https://api.e-hentai.org/api.php";
export const EHENTAI_GALLERY_LINK_REGEX = /\/g\/(\d+)\/([a-f0-9]+)/gi;
export const TARGET_DISCOVERY_YIELD = 15;
export const EHENTAI_BUFFER_DELAY_MS = 250;

export const EHENTAI_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  Referer: "https://e-hentai.org/",
  "User-Agent": DEFAULT_USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
});

export const EHENTAI_API_HEADERS: Readonly<Record<string, string>> =
  Object.freeze({
    Referer: "https://e-hentai.org/",
    "User-Agent": DEFAULT_USER_AGENT,
    Accept: "application/json",
    "Content-Type": "application/json",
  });

// ============================================================================
// 2. Pre-Compiled Module-Level Regular Expressions
// ============================================================================

export const GALLERY_URL_REGEX =
  /^https?:\/\/(?:www\.)?imhentai\.xxx\/gallery\/(\d+)/i;
export const GALLERY_PATH_REGEX = /\/gallery\/(\d+)/i;
export const VIEW_PATH_REGEX = /\/view\/(\d+)(?:\/(\d+))?/i;
export const SERVER_FROM_URL_REGEX =
  /https?:\/\/m(\d+)\.imhentai\.xxx\/([^/]+)\/(\d+)\//i;
export const SERVER_PREFIX_REGEX = /https?:\/\/m(\d+)\.imhentai\.xxx/i;

export const NUMERIC_ONLY_REGEX = /^\d+$/;
export const EXT_REGEX = /\.([a-z0-9]+)$/i;
export const TRIM_SLASHES_REGEX = /^\/+|\/+$/g;
export const LEADING_DOT_REGEX = /^\./;
export const HTTP_PREFIX_REGEX = /^http:\/\//i;
export const PROTOCOL_RELATIVE_REGEX = /^\/\//;
export const WHITESPACE_REGEX = /\s+/g;
export const CATEGORY_PREFIX_REGEX = /^category[:/]/i;
export const COMMA_SEMICOLON_REGEX = /[,;]/;
export const BRACKET_TOKEN_REGEX = /\[([^\]]+)\]|\(([^)]+)\)/g;
export const BADGE_COUNT_REGEX = /\s+\(\d[\d,]*\)$/;
export const BG_IMAGE_URL_REGEX =
  /background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i;

export const FLAG_JP_REGEX = /(?:^|\s|-|_)jp(?:$|\s|-|_)/;
export const FLAG_JA_REGEX = /(?:^|\s|-|_)ja(?:$|\s|-|_)/;

export const INLINE_GALLERY_ID_REGEX =
  /['"]?gallery_id['"]?\s*[:=]\s*['"]?(\d+)['"]?/i;
export const INLINE_LOAD_DIR_REGEX =
  /['"]?load_dir['"]?\s*[:=]\s*['"]([^'"]+)['"]/i;
export const INLINE_LOAD_ID_REGEX =
  /['"]?(?:load_id|load_server|server_id)['"]?\s*[:=]\s*['"]?([^'",;\s}]+)['"]?/i;
export const INLINE_LOAD_PAGES_REGEX =
  /['"]?load_pages['"]?\s*[:=]\s*['"]?(\d+)['"]?/i;
export const PAGES_TEXT_REGEX = /Pages\s*:\s*(\d+)/i;
export const THUMB_PAGENUM_EXT_REGEX = /\/(\d+)t\.([a-z0-9]+)/i;

export const G_TH_PARSE_JSON_REGEX =
  /g_th\s*=\s*(?:\$\.parseJSON|JSON\.parse)\(\s*(['"])([\s\S]*?)\1\s*\)/i;
export const G_TH_STRING_REGEX = /g_th\s*=\s*(['"])(\{[\s\S]*?\})\1/i;
export const G_TH_OBJECT_REGEX = /g_th\s*=\s*(\{[\s\S]*?\})\s*;/i;
export const G_TH_FALLBACK_ENTRY_REGEX =
  /["']?(\d+)["']?\s*:\s*["']([^"']+)["']/g;

// ============================================================================
// 3. In-App Source Preferences Constants
// ============================================================================

export const PREF_KEYS = {
  BUFFER_DEPTH: "page_buffer_depth",
  LANGUAGE: "content_languages",
  CATEGORIES: "enabled_categories",
  TROPE_EXCLUSIONS: "blacklist_heavy_tropes",
  CUSTOM_BLACKLIST: "custom_blacklist_tags",
  TITLE_PREFERENCE: "title_language_preference",
  // Legacy aliases
  LEGACY_BUFFER_DEPTH: "imhentai_pref_buffer_depth",
  LEGACY_CATEGORIES: "imhentai_pref_categories",
  LEGACY_LANGUAGE: "imhentai_pref_language",
  LEGACY_TROPE_EXCLUSIONS: "heavy_trope_exclusions",
  LEGACY_TROPE_EXCLUSIONS_OLD: "imhentai_pref_trope_exclusions",
  LEGACY_CUSTOM_BLACKLIST: "custom_tag_blacklist",
  LEGACY_CUSTOM_BLACKLIST_OLD: "imhentai_pref_custom_blacklist",
  LEGACY_TITLE_PREFERENCE: "imhentai_pref_title_preference",
} as const;

export const BUFFER_DEPTH_OPTIONS: ReadonlyArray<{
  id: string;
  title: string;
}> = Object.freeze([
  { id: "1", title: "1 Page (Fastest / Fewer Titles)" },
  { id: "2", title: "2 Pages (Recommended Balance — Default)" },
  { id: "3", title: "3 Pages (Denser Results / Slight Delay)" },
]);

export const DEFAULT_BUFFER_DEPTH = "2";

export const CATEGORY_OPTIONS: ReadonlyArray<{
  id: ImHentaiCategoryId;
  title: string;
  queryParam: string;
}> = Object.freeze([
  { id: "doujinshi", title: "Doujinshi", queryParam: "d" },
  { id: "manga", title: "Manga", queryParam: "m" },
  { id: "western", title: "Western", queryParam: "w" },
  { id: "artistcg", title: "Artist CG", queryParam: "a" },
  { id: "cosplay", title: "Cosplay", queryParam: "c" },
]);

export const DEFAULT_CATEGORIES: readonly ImHentaiCategoryId[] = Object.freeze([
  "doujinshi",
  "manga",
]);

export const ALL_CATEGORIES: readonly ImHentaiCategoryId[] = Object.freeze([
  "doujinshi",
  "manga",
  "western",
  "imageset",
  "artistcg",
  "gamecg",
  "cosplay",
]);

export const CATEGORY_QUERY_MAP: Readonly<Record<string, string>> =
  Object.freeze({
    doujinshi: "d",
    d: "d",
    manga: "m",
    m: "m",
    western: "w",
    w: "w",
    imageset: "i",
    "image set": "i",
    i: "i",
    artistcg: "a",
    "artist cg": "a",
    a: "a",
    gamecg: "g",
    "game cg": "g",
    g: "g",
    cosplay: "c",
    c: "c",
  });

export const SEARCH_CATEGORY_KEYS = Object.freeze([
  "d",
  "m",
  "w",
  "i",
  "a",
  "g",
] as const);

export const SEARCH_LANGUAGE_KEYS = Object.freeze([
  "en",
  "jp",
  "es",
  "fr",
  "kr",
  "de",
  "ru",
] as const);

export const LANGUAGE_OPTIONS: ReadonlyArray<{
  id: ImHentaiLanguageId;
  title: string;
  queryParam?: string;
}> = Object.freeze([
  { id: "en", title: "English", queryParam: "en" },
  { id: "jp", title: "Japanese", queryParam: "jp" },
  { id: "all", title: "All Languages" },
]);

export const DEFAULT_LANGUAGE: ImHentaiLanguageId = "en";

export const LANGUAGE_QUERY_MAP: Readonly<Record<string, string>> =
  Object.freeze({
    en: "en",
    english: "en",
    jp: "jp",
    ja: "jp",
    japanese: "jp",
    zh: "zh",
    chinese: "zh",
    es: "es",
    spanish: "es",
    fr: "fr",
    french: "fr",
    kr: "kr",
    ko: "kr",
    korean: "kr",
    de: "de",
    german: "de",
    ru: "ru",
    russian: "ru",
  });

export const TROPE_EXCLUSION_OPTIONS: ReadonlyArray<{
  id: string;
  title: string;
  tags: readonly string[];
}> = Object.freeze([
  {
    id: "yaoi",
    title: "Yaoi / Male Only",
    tags: ["yaoi", "male only", "males only", "guy only"],
  },
  {
    id: "netorare",
    title: "Netorare (NTR)",
    tags: ["netorare", "ntr", "cheating"],
  },
  {
    id: "futanari",
    title: "Futanari",
    tags: ["futanari", "dickgirl"],
  },
  {
    id: "guro",
    title: "Guro / Gore",
    tags: ["guro", "gore"],
  },
  {
    id: "scat",
    title: "Scat",
    tags: ["scat", "coprophagia"],
  },
  {
    id: "snuff",
    title: "Snuff",
    tags: ["snuff"],
  },
]);

export const TROPE_TAG_MAP: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    yaoi: ["yaoi", "male only", "males only", "guy only"],
    netorare: ["netorare", "ntr", "cheating"],
    futanari: ["futanari", "dickgirl"],
    guro: ["guro", "gore"],
    scat: ["scat", "coprophagia"],
    snuff: ["snuff"],
  });

export const DEFAULT_TROPE_EXCLUSIONS: readonly string[] = Object.freeze([]);
export const DEFAULT_CUSTOM_BLACKLIST = "";

export const TITLE_PREFERENCE_OPTIONS: ReadonlyArray<{
  id: ImHentaiTitlePreference;
  title: string;
}> = Object.freeze([
  { id: "english", title: "English Title (Japanese Subtitle)" },
  { id: "japanese", title: "Japanese Title (English Subtitle)" },
]);

export const DEFAULT_TITLE_PREFERENCE: ImHentaiTitlePreference = "english";

// ============================================================================
// 4. Custom Browse Feeds & Exploration Constants
// ============================================================================

export const HOME_SECTION_KEYS = {
  POPULAR_TODAY: "popular_today",
  POPULAR_THIS_WEEK: "popular_this_week",
  LATEST_RELEASES: "latest_releases",
  // Legacy aliases
  SPOTLIGHT: "spotlight",
  TRENDING_NOW: "trending_now",
  FRESH_RELEASES: "fresh_releases",
  TOP_RATED: "top_rated",
  LATEST_DOUJINSHI: "latest_doujinshi",
  SERIALIZED_MANGA: "serialized_manga",
} as const;

export const BROWSE_FEED_KEYS = {
  DISCOVER: "discover",
  POPULAR_DAILY: "popular_daily",
  POPULAR_WEEKLY: "popular_weekly",
  POPULAR_MONTHLY: "popular_monthly",
  TOP_RATED_DAILY: "top_rated_daily",
  TOP_RATED_WEEKLY: "top_rated_weekly",
  TOP_RATED_MONTHLY: "top_rated_monthly",
  LATEST: "latest",
  // Legacy aliases for backward compatibility
  TRENDING: "trending",
  POPULAR: "popular",
  TOP_RATED: "top_rated",
  MANGA: "manga",
  DOUJINSHI: "doujinshi",
  WESTERN: "western",
} as const;

export const BROWSE_FEED_DEFINITIONS: ReadonlyArray<{
  id: string;
  title: string;
  urlTemplate?: string;
  isHomePage?: boolean;
}> = Object.freeze([
  {
    id: BROWSE_FEED_KEYS.DISCOVER,
    title: "Discover",
    isHomePage: true,
  },
  {
    id: BROWSE_FEED_KEYS.POPULAR_DAILY,
    title: "Popular (Daily)",
  },
  {
    id: BROWSE_FEED_KEYS.POPULAR_WEEKLY,
    title: "Popular (Weekly)",
  },
  {
    id: BROWSE_FEED_KEYS.POPULAR_MONTHLY,
    title: "Popular (Monthly)",
  },
  {
    id: BROWSE_FEED_KEYS.TOP_RATED_DAILY,
    title: "Top Rated (Daily)",
  },
  {
    id: BROWSE_FEED_KEYS.TOP_RATED_WEEKLY,
    title: "Top Rated (Weekly)",
  },
  {
    id: BROWSE_FEED_KEYS.TOP_RATED_MONTHLY,
    title: "Top Rated (Monthly)",
  },
  {
    id: BROWSE_FEED_KEYS.LATEST,
    title: "Latest Releases",
  },
]);

export const IMHENTAI_SORT_OPTIONS: ReadonlyArray<{
  id: string;
  title: string;
}> = Object.freeze([
  { id: "latest", title: "Date Added / Latest" },
  { id: "popular", title: "Popularity / Most Viewed" },
  { id: "title", title: "Title / Alphabetical" },
]);

export const SEARCH_CATEGORY_OPTIONS: ReadonlyArray<{
  id: string;
  title: string;
  queryParam?: string;
}> = Object.freeze([
  { id: "all", title: "All Categories" },
  { id: "doujinshi", title: "Doujinshi", queryParam: "d" },
  { id: "manga", title: "Manga", queryParam: "m" },
  { id: "western", title: "Western", queryParam: "w" },
  { id: "imageset", title: "Image Set", queryParam: "i" },
  { id: "artistcg", title: "Artist CG", queryParam: "a" },
  { id: "gamecg", title: "Game CG", queryParam: "g" },
  { id: "cosplay", title: "Cosplay", queryParam: "c" },
]);

export const IMHENTAI_FILTER_LANGUAGES: ReadonlyArray<{
  id: string;
  title: string;
}> = Object.freeze([
  { id: "all", title: "All Languages" },
  { id: "en", title: "English" },
  { id: "jp", title: "Japanese" },
  { id: "zh", title: "Chinese" },
  { id: "es", title: "Spanish" },
  { id: "fr", title: "French" },
  { id: "de", title: "German" },
  { id: "ru", title: "Russian" },
]);

export const EXTENSION_CODE_MAP: Readonly<Record<string, string>> =
  Object.freeze({
    j: "jpg",
    jpg: "jpg",
    jpeg: "jpg",
    p: "png",
    png: "png",
    w: "webp",
    webp: "webp",
    g: "gif",
    gif: "gif",
    b: "bmp",
    bmp: "bmp",
    a: "avif",
    avif: "avif",
  });
