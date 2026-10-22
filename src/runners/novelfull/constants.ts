import { ContentRating } from "@suwatte/toolchain";
import type { NovelFullSourceConfiguration } from "./types.js";

export { ContentRating };

// ============================================================================
// 1. Source Identity & Manifest Metadata
// ============================================================================

export const SOURCE_ID = "org.novelfull";
export const SOURCE_NAME = "NovelFull";
export const SOURCE_VERSION = 1.2;
export const BASE_URL = "https://novelfull.com";
export const VARIANT_ID = "org.novelfull";
export const THUMBNAIL_FILENAME = "novelfull.png";
export const SOURCE_ENVIRONMENT = "jsc" as const;

export const SOURCE_LANGUAGES: readonly string[] = Object.freeze(["en"]);
export const SOURCE_CONTENT_RATING = ContentRating.EVERYONE;

export const REFERER_URL = "https://novelfull.com/";
export const ORIGIN_URL = "https://novelfull.com";
export const CLOUDFLARE_RESOLUTION_URL = "https://novelfull.com";
export const FALLBACK_COVER_URL =
  "https://novelfull.com/uploads/default-cover.jpg";
export const DEFAULT_SYNOPSIS_FALLBACK =
  "No synopsis available for this novel.";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export const STANDARD_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "User-Agent": DEFAULT_USER_AGENT,
  Referer: REFERER_URL,
  Origin: ORIGIN_URL,
});

export const DEFAULT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "User-Agent": DEFAULT_USER_AGENT,
  Referer: REFERER_URL,
  Origin: ORIGIN_URL,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
});

export const AJAX_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "User-Agent": DEFAULT_USER_AGENT,
  Referer: REFERER_URL,
  Origin: ORIGIN_URL,
  "X-Requested-With": "XMLHttpRequest",
  Accept: "text/html, */*; q=0.01",
});

export const IMAGE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "User-Agent": DEFAULT_USER_AGENT,
  Referer: REFERER_URL,
  Origin: ORIGIN_URL,
});

export const STATIC_CONFIGURATION: NovelFullSourceConfiguration = Object.freeze({
  imageReferer: REFERER_URL,
  cloudflareResolutionURL: CLOUDFLARE_RESOLUTION_URL,
  standardHeaders: STANDARD_HEADERS,
});

export const RATE_LIMIT_PER_SECOND = 4;

// ============================================================================
// 2. Pre-Compiled Module-Level Regular Expressions
// ============================================================================

export const NOVEL_URL_REGEX =
  /^https?:\/\/(?:www\.)?novelfull\.(?:com|net)\/([^/?#]+?)\.html(?:[?#].*)?$/i;

export const CHAPTER_URL_REGEX =
  /^https?:\/\/(?:www\.)?novelfull\.(?:com|net)\/([^/?#]+)\/([^/?#]+?)(?:\.html)?(?:[?#].*)?$/i;

export const NOVEL_PATH_REGEX = /^\/?([^/?#]+?)\.html(?:[?#].*)?$/i;
export const CHAPTER_PATH_REGEX =
  /^\/?([^/?#]+)\/([^/?#]+?)(?:\.html)?(?:[?#].*)?$/i;

export const TRIM_SLASHES_REGEX = /^\/+|\/+$/g;
export const HTML_EXT_REGEX = /\.html$/i;
export const HTTP_PREFIX_REGEX = /^http:\/\//i;
export const PROTOCOL_RELATIVE_REGEX = /^\/\//;
export const WHITESPACE_REGEX = /\s+/g;
export const WORD_TOKEN_REGEX = /[a-z0-9]+/g;
export const NON_ALPHANUMERIC_SLUG_REGEX = /[^a-z0-9]+/g;

export const INLINE_NOVEL_ID_REGEX =
  /(?:data-novel-id|novelId|truyen-id|novel_id)\s*[:=]\s*['"]?(\d+)['"]?/i;

export const CHAPTER_NUMBER_REGEX =
  /(?:chapter|ch\.?|episode|ep\.?|part)\s*(\d+(?:\.\d+)?)/i;
export const LEADING_NUMBER_REGEX =
  /^(?:vol(?:ume)?\.?\s*\d+\s*[-:–—]?\s*)?(\d+(?:\.\d+)?)\b/i;
export const VOLUME_NUMBER_REGEX =
  /\b(?:vol(?:ume)?|book)\.?\s*(\d+)\b/i;

export const BG_IMAGE_URL_REGEX =
  /background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i;

// Translator Note (TLN) detection regex:
// Matches [TL: ...], [TL Note: ...], (TL: ...), (TL Note: ...), [TN: ...], (TN: ...), [Translator Note: ...]
export const TLN_BRACKET_REGEX =
  /(?:\[|\()(?:TL|TN|Translator(?:'s)?)(?:\s*Note)?:\s*([^\])]+?)(?:\]|\))/gi;

// Aggregator watermark & promo stripping regexes:
export const WATERMARK_PATTERNS: readonly RegExp[] = Object.freeze([
  /read\s+novel\s+online\s+free\s+on\s+novelfull(?:\.(?:com|net))?\.?/gi,
  /visit\s+novelfull\.(?:com|net)\s+for\s+the\s+best\s+novel\s+reading\s+experience\.?/gi,
  /if\s+you\s+discover\s+any\s+errors[\s\S]{0,250}?(?:please[\s\S]{0,60}?report|as\s+soon\s+as\s+possible)[^<\n]*/gi,
  /if\s+you\s+discover\s+any\s+errors[^<\n]*/gi,
  /find\s+authorized\s+novels\s+in\s+webnovel[\s\S]{0,200}?for\s+visiting\.?/gi,
  /read\s+latest\s+chapters?\s+at\s+novelfull(?:\.(?:com|net))?[^<\n]*/gi,
  /this\s+chapter\s+is\s+updated\s+by\s+novelfull(?:\.(?:com|net))?[^<\n]*/gi,
  /updated\s+by\s+novelfull(?:\.(?:com|net))?[^<\n]*/gi,
  /source\s*:\s*novelfull\.(?:com|net)/gi,
  /(?:support\s+us\s+on|join\s+our|donate\s+(?:via|to|on)|check\s+out\s+our|follow\s+us\s+on)\s+[^<\n]*?\b(?:patreon|discord|paypal|ko-fi|buymeacoffee)\b[^<\n]*/gi,
  /https?:\/\/(?:www\.)?(?:patreon\.com|discord\.(?:gg|com)|paypal\.(?:me|com)|ko-fi\.com|buymeacoffee\.com)\/[^\s<")']*/gi,
]);

export const PROMO_LINK_HREF_REGEX =
  /(?:patreon\.com|discord\.(?:gg|com)|paypal\.(?:me|com)|ko-fi\.com|buymeacoffee\.com|novelfull\.(?:com|net))/i;

// Reserved non-novel path prefixes on NovelFull
export const RESERVED_PATHS_SET: ReadonlySet<string> = new Set([
  "hot-novel",
  "latest-release-novel",
  "most-popular",
  "completed-novel",
  "search",
  "genre",
  "author",
  "status",
  "ajax-chapter-option",
  "ajax",
  "contact",
  "tos",
  "privacy-policy",
  "dmca",
  "index",
  "home",
]);

// ============================================================================
// 3. Home Dashboard & Browse Feeds
// ============================================================================

export const HOME_SECTION_KEYS = {
  SPOTLIGHT: "spotlight",
  HOT_NOVELS: "hot_novels",
  LATEST_RELEASES: "latest_releases",
  COMPLETED_MASTERPIECES: "completed_masterpieces",
  MOST_POPULAR: "most_popular",
} as const;

export const BROWSE_FEED_KEYS = {
  DISCOVER: "discover",
  HOT_NOVEL: "hot-novel",
  LATEST_RELEASES: "latest-release-novel",
  MOST_POPULAR: "most-popular",
  COMPLETED_NOVELS: "completed-novel",
} as const;

// ============================================================================
// 4. Genres, Filters & Preferences
// ============================================================================

export const PREF_KEYS = {
  SANITIZE_ADS: "sanitize_ads",
  FORMAT_TLN: "format_tln",
  NORMALIZE_SPACING: "normalize_spacing",
  EXCLUDED_GENRES: "excluded_genres",
  CUSTOM_BLACKLIST: "custom_blacklist",
} as const;

export const NOVELFULL_GENRES: ReadonlyArray<{
  id: string;
  title: string;
  slug: string;
}> = Object.freeze([
  { id: "Action", title: "Action", slug: "Action" },
  { id: "Adult", title: "Adult", slug: "Adult" },
  { id: "Adventure", title: "Adventure", slug: "Adventure" },
  { id: "Comedy", title: "Comedy", slug: "Comedy" },
  { id: "Drama", title: "Drama", slug: "Drama" },
  { id: "Eastern", title: "Eastern", slug: "Eastern" },
  { id: "Ecchi", title: "Ecchi", slug: "Ecchi" },
  { id: "Fantasy", title: "Fantasy", slug: "Fantasy" },
  { id: "Game", title: "Game", slug: "Game" },
  { id: "Gender Bender", title: "Gender Bender", slug: "Gender+Bender" },
  { id: "Harem", title: "Harem", slug: "Harem" },
  { id: "Historical", title: "Historical", slug: "Historical" },
  { id: "Horror", title: "Horror", slug: "Horror" },
  { id: "Josei", title: "Josei", slug: "Josei" },
  { id: "Magical Realism", title: "Magical Realism", slug: "Magical+Realism" },
  { id: "Martial Arts", title: "Martial Arts", slug: "Martial+Arts" },
  { id: "Mature", title: "Mature", slug: "Mature" },
  { id: "Mecha", title: "Mecha", slug: "Mecha" },
  { id: "Modern Life", title: "Modern Life", slug: "Modern+Life" },
  { id: "Mystery", title: "Mystery", slug: "Mystery" },
  { id: "Psychological", title: "Psychological", slug: "Psychological" },
  { id: "Reincarnation", title: "Reincarnation", slug: "Reincarnation" },
  { id: "Romance", title: "Romance", slug: "Romance" },
  { id: "School Life", title: "School Life", slug: "School+Life" },
  { id: "Sci-Fi", title: "Sci-Fi", slug: "Sci-fi" },
  { id: "Seinen", title: "Seinen", slug: "Seinen" },
  { id: "Shoujo", title: "Shoujo", slug: "Shoujo" },
  { id: "Shounen", title: "Shounen", slug: "Shounen" },
  { id: "Slice of Life", title: "Slice of Life", slug: "Slice+of+Life" },
  { id: "Smut", title: "Smut", slug: "Smut" },
  { id: "Sports", title: "Sports", slug: "Sports" },
  { id: "Supernatural", title: "Supernatural", slug: "Supernatural" },
  { id: "System", title: "System", slug: "System" },
  { id: "Tragedy", title: "Tragedy", slug: "Tragedy" },
  { id: "Urban Life", title: "Urban Life", slug: "Urban+Life" },
  { id: "Video Games", title: "Video Games", slug: "Video+Games" },
  { id: "Wuxia", title: "Wuxia", slug: "Wuxia" },
  { id: "Xianxia", title: "Xianxia", slug: "Xianxia" },
  { id: "Xuanhuan", title: "Xuanhuan", slug: "Xuanhuan" },
  { id: "Yaoi", title: "Yaoi", slug: "Yaoi" },
  { id: "Yuri", title: "Yuri", slug: "Yuri" },
]);

export const MATURE_GENRES_SET: ReadonlySet<string> = new Set([
  "adult",
  "mature",
  "smut",
  "erotica",
  "18+",
]);

export const SUGGESTIVE_GENRES_SET: ReadonlySet<string> = new Set([
  "ecchi",
  "harem",
  "yaoi",
  "yuri",
]);

export const NOVELFULL_STATUS_OPTIONS: ReadonlyArray<{
  id: string;
  title: string;
}> = Object.freeze([
  { id: "all", title: "All" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
]);

export const NOVELFULL_SORT_OPTIONS: ReadonlyArray<{
  id: string;
  title: string;
}> = Object.freeze([
  { id: "latest", title: "Latest" },
  { id: "hot", title: "Hot" },
  { id: "popular", title: "Most Popular" },
]);
