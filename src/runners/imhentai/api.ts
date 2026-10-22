import {
  BASE_URL,
  BROWSE_FEED_KEYS,
  CATEGORY_PREFIX_REGEX,
  CATEGORY_QUERY_MAP,
  DEFAULT_IMAGE_EXT,
  DEFAULT_SERVER_ID,
  EXTENSION_CODE_MAP,
  FALLBACK_COVER_URL,
  HOME_SECTION_KEYS,
  HTTP_PREFIX_REGEX,
  LANGUAGE_QUERY_MAP,
  LEADING_DOT_REGEX,
  PROTOCOL_RELATIVE_REGEX,
  TRIM_SLASHES_REGEX,
} from "./constants.js";
import {
  buildFullCategoryQueryFlags,
  buildFullLanguageQueryFlags,
  buildPreferenceQueryFlags,
  normalizeCategoryToken,
} from "./preferences.js";
import type {
  ImHentaiExploreParams,
  ImHentaiUserPreferences,
} from "./types.js";

/**
 * Detects whether an image URL points to a blank placeholder GIF or internal asset rather than live CDN media.
 */
export function isPlaceholderImageUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  const clean = url.trim().toLowerCase();
  if (!clean) return true;
  return (
    clean.includes("blank.gif") ||
    clean.includes("pixel.gif") ||
    clean.includes("placeholder") ||
    clean.startsWith("/images/") ||
    clean.startsWith("/assets/images/") ||
    clean.includes("about:blank") ||
    clean.startsWith("data:image")
  );
}

/**
 * Derives the Base CDN Directory URL from a cover or thumbnail URL (gallery-dl pattern).
 * Strips the trailing filename (thumb.jpg, 1t.jpg, etc.) and any query string up to the final slash:
 * e.g., https://m2.imhentai.xxx/007/5uqtji3sho/thumb.jpg?v=1 -> https://m2.imhentai.xxx/007/5uqtji3sho/
 */
export function deriveBaseCdnUrl(
  rawUrl: string | undefined | null
): string | undefined {
  if (!rawUrl) return undefined;
  const clean = rawUrl.split("?")[0]?.split("#")[0]?.trim() ?? "";
  if (!clean || isPlaceholderImageUrl(clean)) return undefined;

  const normalized = normalizeImageUrl(clean);
  const lastSlashIdx = normalized.lastIndexOf("/");
  if (lastSlashIdx !== -1) {
    const base = normalized.substring(0, lastSlashIdx + 1);
    if (base.startsWith("https://") || base.startsWith("http://")) {
      return base.replace(HTTP_PREFIX_REGEX, "https://");
    }
  }
  return undefined;
}

/**
 * Normalizes any relative, protocol-relative, or HTTP URL into a full HTTPS URL.
 */
export function normalizeImageUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl) return FALLBACK_COVER_URL;
  const trimmed = rawUrl.trim();
  if (!trimmed) return FALLBACK_COVER_URL;

  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed.replace(HTTP_PREFIX_REGEX, "https://");
  }
  if (PROTOCOL_RELATIVE_REGEX.test(trimmed)) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith("/")) {
    return `${BASE_URL}${trimmed}`;
  }
  return `${BASE_URL}/${trimmed}`;
}

/**
 * Maps a single category identifier to its IMHentai query parameter name.
 */
export function buildCategoryQueryParam(category: string): string | undefined {
  const norm = normalizeCategoryToken(category);
  return norm ? CATEGORY_QUERY_MAP[norm] : undefined;
}

/**
 * Maps a language identifier to its IMHentai query parameter name.
 */
export function buildLanguageQueryParam(language: string): string | undefined {
  const lower = language.trim().toLowerCase();
  return LANGUAGE_QUERY_MAP[lower];
}

export {
  buildFullCategoryQueryFlags,
  buildFullLanguageQueryFlags,
  buildPreferenceQueryFlags,
} from "./preferences.js";

/**
 * Builds the exploration/feed URL for IMHentai browse categories and home feeds.
 */
export function buildFeedUrl(
  feedKey: string,
  page: number,
  prefs: ImHentaiUserPreferences,
  sortBy?: string
): string {
  const safePage = Math.max(1, page || 1);
  const cleanKey = feedKey.trim().toLowerCase().replace(CATEGORY_PREFIX_REGEX, "");
  const isPopular =
    sortBy === "popular" ||
    sortBy === "popularity" ||
    sortBy === "pp" ||
    sortBy === "most_viewed";
  const subPath = isPopular ? "popular/" : "";

  // 1. Native Category Feeds (Section 2)
  if (
    cleanKey === "doujinshi" ||
    cleanKey === "manga" ||
    cleanKey === "western" ||
    cleanKey === "imageset" ||
    cleanKey === "cosplay"
  ) {
    return `${BASE_URL}/category/${cleanKey}/${subPath}?page=${safePage}`;
  }

  if (cleanKey === HOME_SECTION_KEYS.LATEST_DOUJINSHI) {
    return `${BASE_URL}/category/doujinshi/${subPath}?page=${safePage}`;
  }
  if (cleanKey === HOME_SECTION_KEYS.SERIALIZED_MANGA) {
    return `${BASE_URL}/category/manga/${subPath}?page=${safePage}`;
  }

  // 2. Custom Browse Feeds with full flags and apply=Search
  const catFlags = buildFullCategoryQueryFlags(null, prefs.categories);
  const langFlags = buildFullLanguageQueryFlags(prefs.language);

  switch (cleanKey) {
    case BROWSE_FEED_KEYS.POPULAR:
      return `${BASE_URL}/search/?apply=Search&pp=1&lt=0&page=${safePage}${catFlags}${langFlags}`;
    case BROWSE_FEED_KEYS.TRENDING:
    case HOME_SECTION_KEYS.TRENDING_NOW:
    case HOME_SECTION_KEYS.SPOTLIGHT:
      return `${BASE_URL}/search/?apply=Search&pp=1&lt=1&page=${safePage}${catFlags}${langFlags}`;
    case BROWSE_FEED_KEYS.TOP_RATED:
    case HOME_SECTION_KEYS.TOP_RATED:
      return `${BASE_URL}/search/?apply=Search&pp=1&lt=0&sort=top_rated&page=${safePage}${catFlags}${langFlags}`;
    case BROWSE_FEED_KEYS.LATEST:
    case HOME_SECTION_KEYS.FRESH_RELEASES:
      return `${BASE_URL}/?page=${safePage}`;
    case BROWSE_FEED_KEYS.DISCOVER:
    default: {
      if (isPopular) {
        return `${BASE_URL}/search/?apply=Search&pp=1&lt=0&page=${safePage}${catFlags}${langFlags}`;
      }
      if (sortBy === "top_rated") {
        return `${BASE_URL}/search/?apply=Search&pp=1&lt=0&sort=top_rated&page=${safePage}${catFlags}${langFlags}`;
      }
      if (sortBy === "trending") {
        return `${BASE_URL}/search/?apply=Search&pp=1&lt=1&page=${safePage}${catFlags}${langFlags}`;
      }
      return `${BASE_URL}/?page=${safePage}`;
    }
  }
}

/**
 * Builds the search endpoint URL injecting query, sorting, categories, and language flags.
 * Parameter Safety Guard: If query is empty or whitespace-only, routes cleanly to popular or latest feed.
 */
export function buildSearchUrl(
  params: ImHentaiExploreParams,
  prefs: ImHentaiUserPreferences
): string {
  const safePage = Math.max(1, params.page ?? 1);
  const queryParts: string[] = [];

  if (params.query) {
    const trimmed = params.query.trim();
    if (trimmed.length > 0) {
      queryParts.push(trimmed);
    }
  }

  if (params.tags?.include && params.tags.include.length > 0) {
    for (let i = 0; i < params.tags.include.length; i++) {
      const tag = params.tags.include[i]?.trim();
      if (tag) {
        queryParts.push(tag);
      }
    }
  }

  const isPopular =
    params.sortBy === "popular" ||
    params.sortBy === "popularity" ||
    params.sortBy === "pp" ||
    params.sortBy === "most_viewed";

  // Parameter Safety in Search:
  // If search query is empty or contains only whitespace, route to the standard popular or latest feed
  // rather than sending a broken ?key=&apply=Search query that might trigger server-side 500 errors.
  if (queryParts.length === 0) {
    return buildFeedUrl(
      isPopular ? BROWSE_FEED_KEYS.POPULAR : BROWSE_FEED_KEYS.LATEST,
      safePage,
      prefs,
      params.sortBy
    );
  }

  const searchKey = encodeURIComponent(queryParts.join(" ").trim());

  // 1. Sort Handling:
  let sortFlag = "&pp=0&lt=1";
  if (isPopular) {
    sortFlag = "&pp=1&lt=0";
  } else if (params.sortBy === "top_rated") {
    sortFlag = "&pp=1&lt=0&sort=top_rated";
  } else if (params.sortBy === "trending") {
    sortFlag = "&pp=1&lt=1";
  }

  // 2. Full Category Flags:
  const activeCategoryFilter =
    params.category && params.category !== "all"
      ? params.category
      : params.categories?.include && params.categories.include.length > 0
        ? params.categories.include
        : params.category === "all"
          ? "all"
          : null;

  const categoryFlags = buildFullCategoryQueryFlags(
    activeCategoryFilter,
    prefs.categories
  );

  // 3. Full Language Flags:
  const languageFlags = buildFullLanguageQueryFlags(
    params.language ?? prefs.language
  );

  // 4. Always Include Search Trigger:
  return `${BASE_URL}/search/?key=${searchKey}&apply=Search${categoryFlags}${languageFlags}${sortFlag}&page=${safePage}`;
}

/**
 * Builds a gallery detail page URL.
 */
export function buildGalleryUrl(id: string): string {
  const cleanId = id.replace(TRIM_SLASHES_REGEX, "");
  return `${BASE_URL}/gallery/${cleanId}/`;
}

/**
 * Builds a gallery reader page URL.
 */
export function buildReaderUrl(id: string, page = 1): string {
  const cleanId = id.replace(TRIM_SLASHES_REGEX, "");
  return `${BASE_URL}/view/${cleanId}/${page}/`;
}

/**
 * Constructs a fully qualified image CDN URL guaranteed to have a valid file extension.
 * Supports:
 * - (baseUrl, pageNumber, ext): `${baseUrl}${pageNumber}.${cleanExt}`
 * - (serverId, loadDir, pageNumber, ext): `https://m${server}.imhentai.xxx/${dir}/${pageNumber}.${cleanExt}`
 * - (serverId, loadDir, galleryId, pageNumber, ext): omits numerical galleryId as per IMHentai CDN specification
 */
export function buildImageUrl(
  baseOrServer: string,
  dirOrPage: string | number,
  pageOrExt?: number | string,
  maybePage?: number,
  maybeExt?: string
): string {
  // If first argument is already a base URL (e.g. "https://m2.imhentai.xxx/007/5uqtji3sho/")
  if (
    baseOrServer.startsWith("https://") ||
    baseOrServer.startsWith("http://")
  ) {
    const cleanBase = baseOrServer.endsWith("/")
      ? baseOrServer.replace(HTTP_PREFIX_REGEX, "https://")
      : `${baseOrServer.replace(HTTP_PREFIX_REGEX, "https://")}/`;
    const pageNum =
      typeof dirOrPage === "number"
        ? dirOrPage
        : parseInt(String(dirOrPage), 10) || 1;
    const rawExt =
      typeof pageOrExt === "string" ? pageOrExt : DEFAULT_IMAGE_EXT;
    const cleanExt =
      EXTENSION_CODE_MAP[rawExt.toLowerCase().replace(LEADING_DOT_REGEX, "")] ??
      (rawExt && rawExt !== "undefined" && rawExt !== "null"
        ? rawExt
        : DEFAULT_IMAGE_EXT);
    return `${cleanBase}${pageNum}.${cleanExt}`;
  }

  // Fallback: construct from serverId and loadDir (without inserting numeric galleryId)
  const cleanServerId =
    baseOrServer.replace(/^m/i, "").trim() || DEFAULT_SERVER_ID;
  const cleanLoadDir =
    String(dirOrPage).replace(TRIM_SLASHES_REGEX, "").trim() || "001";

  let pageNum = 1;
  let rawExt = DEFAULT_IMAGE_EXT;

  if (maybeExt !== undefined) {
    // 5 arguments: (serverId, loadDir, galleryId, pageNumber, ext)
    pageNum = maybePage ?? 1;
    rawExt = maybeExt;
  } else if (typeof pageOrExt === "number") {
    // 4 arguments: (serverId, loadDir, pageNumber, ext)
    pageNum = pageOrExt;
    rawExt = (maybePage as unknown as string) || DEFAULT_IMAGE_EXT;
  }

  const cleanExt =
    EXTENSION_CODE_MAP[rawExt.toLowerCase().replace(LEADING_DOT_REGEX, "")] ??
    (rawExt && rawExt !== "undefined" && rawExt !== "null"
      ? rawExt
      : DEFAULT_IMAGE_EXT);

  return `https://m${cleanServerId}.imhentai.xxx/${cleanLoadDir}/${pageNum}.${cleanExt}`;
}
