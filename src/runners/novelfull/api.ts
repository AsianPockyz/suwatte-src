import {
  BASE_URL,
  BROWSE_FEED_KEYS,
  CHAPTER_PATH_REGEX,
  CHAPTER_URL_REGEX,
  ContentRating,
  FALLBACK_COVER_URL,
  HOME_SECTION_KEYS,
  HTML_EXT_REGEX,
  HTTP_PREFIX_REGEX,
  MATURE_GENRES_SET,
  NOVEL_PATH_REGEX,
  NOVEL_URL_REGEX,
  NOVELFULL_GENRES,
  PROTOCOL_RELATIVE_REGEX,
  RESERVED_PATHS_SET,
  SUGGESTIVE_GENRES_SET,
  TRIM_SLASHES_REGEX,
} from "./constants.js";
import type { NovelFullExploreParams } from "./types.js";

const GENRE_SLUG_MAP: ReadonlyMap<string, string> = new Map(
  NOVELFULL_GENRES.flatMap((g) => [
    [g.id.toLowerCase(), g.slug],
    [g.title.toLowerCase(), g.slug],
    [g.slug.toLowerCase(), g.slug],
    [g.title.toLowerCase().replace(/\s+/g, "-"), g.slug],
  ])
);

/**
 * Guards against placeholder traps: blank.gif, pixel.gif, /images/, data:image, or empty URLs.
 */
export function isPlaceholderImageUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  const clean = url.trim().toLowerCase();
  if (!clean) return true;
  return (
    clean.includes("blank.gif") ||
    clean.includes("pixel.gif") ||
    clean.includes("/images/") ||
    clean.includes("placeholder") ||
    clean.includes("no-image") ||
    clean.includes("no_image") ||
    clean.includes("noimage") ||
    clean.includes("about:blank") ||
    clean.startsWith("data:image")
  );
}

/**
 * Normalizes any relative (starts with `/` or `uploads/`), protocol-relative (`//`),
 * or HTTP image URL into a full HTTPS URL on `https://novelfull.com`.
 */
export function normalizeImageUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl) return FALLBACK_COVER_URL;
  const trimmed = rawUrl.trim();
  if (!trimmed || isPlaceholderImageUrl(trimmed)) {
    return FALLBACK_COVER_URL;
  }

  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed
      .replace(HTTP_PREFIX_REGEX, "https://")
      .replace(/^https:\/\/(?:www\.)?novelfull\.net\b/i, BASE_URL);
  }
  if (PROTOCOL_RELATIVE_REGEX.test(trimmed)) {
    return `https:${trimmed}`.replace(
      /^https:\/\/(?:www\.)?novelfull\.net\b/i,
      BASE_URL
    );
  }
  if (trimmed.startsWith("/")) {
    return `${BASE_URL}${trimmed}`;
  }
  return `${BASE_URL}/${trimmed}`;
}

/**
 * Checks whether a path segment is a reserved NovelFull category/system route rather than a novel slug.
 */
export function isReservedNovelFullPath(segment: string): boolean {
  const clean = segment
    .trim()
    .toLowerCase()
    .replace(TRIM_SLASHES_REGEX, "")
    .replace(HTML_EXT_REGEX, "");
  return !clean || RESERVED_PATHS_SET.has(clean);
}

/**
 * Determines whether a URL points to a NovelFull novel detail page or direct chapter link.
 * Matches `https?://novelfull.(com|net)/([^/]+).html` and direct chapter links.
 */
export function canResolveNovelFullUrl(url: string): boolean {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return false;

  const novelMatch = NOVEL_URL_REGEX.exec(trimmed);
  if (novelMatch?.[1]) {
    return !isReservedNovelFullPath(novelMatch[1]);
  }

  const chapterMatch = CHAPTER_URL_REGEX.exec(trimmed);
  if (chapterMatch?.[1] && chapterMatch?.[2]) {
    const firstSeg = chapterMatch[1].toLowerCase();
    if (isReservedNovelFullPath(firstSeg)) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Extracts a clean novel slug from a raw slug, relative href, novel URL, or direct chapter URL.
 */
export function extractNovelId(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";

  const novelUrlMatch = NOVEL_URL_REGEX.exec(trimmed);
  if (novelUrlMatch?.[1]) {
    return novelUrlMatch[1].replace(TRIM_SLASHES_REGEX, "");
  }

  const chapterUrlMatch = CHAPTER_URL_REGEX.exec(trimmed);
  if (chapterUrlMatch?.[1] && !isReservedNovelFullPath(chapterUrlMatch[1])) {
    return chapterUrlMatch[1].replace(TRIM_SLASHES_REGEX, "");
  }

  const withoutQuery = (trimmed.split(/[?#]/)[0] ?? "").trim();

  if (
    withoutQuery.startsWith("http://") ||
    withoutQuery.startsWith("https://")
  ) {
    const pathOnly = withoutQuery.replace(/^https?:\/\/[^/]+/i, "");
    return extractNovelId(pathOnly);
  }

  const chapterPathMatch = CHAPTER_PATH_REGEX.exec(withoutQuery);
  if (chapterPathMatch?.[1] && !isReservedNovelFullPath(chapterPathMatch[1])) {
    return chapterPathMatch[1]
      .replace(TRIM_SLASHES_REGEX, "")
      .replace(HTML_EXT_REGEX, "");
  }

  const novelPathMatch = NOVEL_PATH_REGEX.exec(withoutQuery);
  if (novelPathMatch?.[1]) {
    return novelPathMatch[1]
      .replace(TRIM_SLASHES_REGEX, "")
      .replace(HTML_EXT_REGEX, "");
  }

  return withoutQuery
    .replace(TRIM_SLASHES_REGEX, "")
    .replace(HTML_EXT_REGEX, "")
    .trim();
}

/**
 * Extracts a clean chapter slug from an `<option value="/novel-slug/chapter-1.html">`,
 * full URL, or raw chapter identifier.
 */
export function extractChapterId(
  input: string,
  novelSlug?: string
): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";

  const chapterUrlMatch = CHAPTER_URL_REGEX.exec(trimmed);
  if (chapterUrlMatch?.[2]) {
    return chapterUrlMatch[2]
      .replace(TRIM_SLASHES_REGEX, "")
      .replace(HTML_EXT_REGEX, "");
  }

  const withoutQuery = (trimmed.split(/[?#]/)[0] ?? "")
    .trim()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(TRIM_SLASHES_REGEX, "")
    .replace(HTML_EXT_REGEX, "");

  if (!withoutQuery) return "";

  if (novelSlug) {
    const cleanNovel = extractNovelId(novelSlug).toLowerCase();
    if (
      cleanNovel &&
      withoutQuery.toLowerCase().startsWith(`${cleanNovel}/`)
    ) {
      return withoutQuery.slice(cleanNovel.length + 1).replace(TRIM_SLASHES_REGEX, "");
    }
  }

  const slashIdx = withoutQuery.lastIndexOf("/");
  if (slashIdx !== -1) {
    return withoutQuery.slice(slashIdx + 1).trim();
  }

  return withoutQuery;
}

/**
 * Builds the canonical novel detail URL: `https://novelfull.com/${contentId}.html`.
 */
export function buildNovelUrl(contentId: string): string {
  const slug = extractNovelId(contentId);
  if (!slug) {
    throw new Error("Novel contentId cannot be empty.");
  }
  return `${BASE_URL}/${slug}.html`;
}

/**
 * Builds the 1-pass AJAX chapter option endpoint:
 * `https://novelfull.com/ajax-chapter-option?novelId=${novelId}`
 */
export function buildAjaxChapterUrl(novelId: string | number): string {
  const cleanId = String(novelId ?? "").trim();
  return `${BASE_URL}/ajax-chapter-option?novelId=${encodeURIComponent(cleanId)}`;
}

/**
 * Builds the canonical chapter reader URL:
 * `https://novelfull.com/${contentId}/${chapterId}.html`
 */
export function buildChapterUrl(contentId: string, chapterId: string): string {
  const rawChapter = (chapterId ?? "").trim();
  if (!rawChapter) {
    throw new Error("Chapter ID cannot be empty.");
  }

  if (rawChapter.startsWith("https://") || rawChapter.startsWith("http://")) {
    const normalized = rawChapter
      .replace(HTTP_PREFIX_REGEX, "https://")
      .replace(/^https:\/\/(?:www\.)?novelfull\.net\b/i, BASE_URL);
    const basePart = normalized.split(/[?#]/)[0] ?? normalized;
    return basePart.endsWith(".html") ? basePart : `${basePart}.html`;
  }

  const cleanNovelSlug = extractNovelId(contentId);
  const cleanChapterPath = (rawChapter.split(/[?#]/)[0] ?? "")
    .trim()
    .replace(TRIM_SLASHES_REGEX, "")
    .replace(HTML_EXT_REGEX, "");

  if (cleanChapterPath.includes("/")) {
    return `${BASE_URL}/${cleanChapterPath}.html`;
  }

  if (!cleanNovelSlug) {
    return `${BASE_URL}/${cleanChapterPath}.html`;
  }

  return `${BASE_URL}/${cleanNovelSlug}/${cleanChapterPath}.html`;
}

/**
 * Resolves a genre name or ID to NovelFull's URL path token (e.g. "Martial Arts" -> "Martial+Arts").
 */
export function resolveGenreSlug(genre: string): string {
  const clean = genre.trim();
  const mapped = GENRE_SLUG_MAP.get(clean.toLowerCase());
  if (mapped) {
    return mapped;
  }
  return clean.replace(/\s+/g, "+");
}

/**
 * Builds a paginated genre listing URL: `https://novelfull.com/genre/${genre}?page=${page}`.
 */
export function buildGenreUrl(genre: string, page = 1): string {
  const safePage = Math.max(1, page || 1);
  const slug = resolveGenreSlug(genre);
  return `${BASE_URL}/genre/${slug}?page=${safePage}`;
}

/**
 * Builds a paginated status listing URL.
 */
export function buildStatusUrl(status: string, page = 1): string {
  const safePage = Math.max(1, page || 1);
  const lower = status.trim().toLowerCase();
  if (lower === "completed" || lower === "full") {
    return `${BASE_URL}/completed-novel?page=${safePage}`;
  }
  if (lower === "ongoing") {
    return `${BASE_URL}/status/Ongoing?page=${safePage}`;
  }
  return `${BASE_URL}/latest-release-novel?page=${safePage}`;
}

/**
 * Builds the paginated URL for NovelFull's browse feeds and home sections.
 */
export function buildFeedUrl(
  feedKey: string,
  page = 1,
  sortBy?: string
): string {
  const safePage = Math.max(1, page || 1);
  const cleanKey = (feedKey ?? "").trim().toLowerCase();

  if (cleanKey.startsWith("genre:") || cleanKey.startsWith("genre/")) {
    const genreName = feedKey.slice(6).trim();
    return buildGenreUrl(genreName, safePage);
  }

  if (cleanKey.startsWith("status:") || cleanKey.startsWith("status/")) {
    const statusName = feedKey.slice(7).trim();
    return buildStatusUrl(statusName, safePage);
  }

  switch (cleanKey) {
    case BROWSE_FEED_KEYS.HOT_NOVEL:
    case HOME_SECTION_KEYS.HOT_NOVELS:
    case HOME_SECTION_KEYS.SPOTLIGHT:
    case "hot_novel":
    case "hot":
    case "hot novel":
    case "hot novels":
      return `${BASE_URL}/hot-novel?page=${safePage}`;

    case BROWSE_FEED_KEYS.LATEST_RELEASES:
    case HOME_SECTION_KEYS.LATEST_RELEASES:
    case "latest-releases":
    case "latest_release_novel":
    case "latest":
    case "latest releases":
      return `${BASE_URL}/latest-release-novel?page=${safePage}`;

    case BROWSE_FEED_KEYS.MOST_POPULAR:
    case HOME_SECTION_KEYS.MOST_POPULAR:
    case "most_popular":
    case "popular":
    case "most popular":
    case "most popular all-time":
      return `${BASE_URL}/most-popular?page=${safePage}`;

    case BROWSE_FEED_KEYS.COMPLETED_NOVELS:
    case HOME_SECTION_KEYS.COMPLETED_MASTERPIECES:
    case "completed-novels":
    case "completed_novels":
    case "completed_novel":
    case "completed":
    case "completed novels":
    case "completed masterpieces":
      return `${BASE_URL}/completed-novel?page=${safePage}`;

    case BROWSE_FEED_KEYS.DISCOVER:
    case "home":
    default: {
      const sortLower = (sortBy ?? "").trim().toLowerCase();
      if (sortLower === "hot") {
        return `${BASE_URL}/hot-novel?page=${safePage}`;
      }
      if (sortLower === "popular" || sortLower === "most-popular") {
        return `${BASE_URL}/most-popular?page=${safePage}`;
      }
      if (sortLower === "completed") {
        return `${BASE_URL}/completed-novel?page=${safePage}`;
      }
      if (sortLower === "latest") {
        return `${BASE_URL}/latest-release-novel?page=${safePage}`;
      }
      return `${BASE_URL}/hot-novel?page=${safePage}`;
    }
  }
}

/**
 * Builds the search/filter URL for `getSearchResults`:
 * - Keyword query -> `https://novelfull.com/search?keyword={query}&page={page}`
 * - Genre filter (no keyword) -> `https://novelfull.com/genre/{genre}?page={page}`
 * - Status filter (no keyword) -> `/completed-novel?page={page}` or `/status/Ongoing?page={page}`
 * - Sort option -> `/hot-novel`, `/most-popular`, or `/latest-release-novel`
 */
export function buildSearchUrl(params: NovelFullExploreParams): string {
  const safePage = Math.max(1, params.page ?? 1);
  const cleanQuery = params.query?.trim();

  if (cleanQuery && cleanQuery.length > 0) {
    const encodedQuery = encodeURIComponent(cleanQuery);
    return `${BASE_URL}/search?keyword=${encodedQuery}&page=${safePage}`;
  }

  const activeGenre =
    params.genre?.trim() || params.genres?.include?.[0]?.trim();
  if (activeGenre && activeGenre.toLowerCase() !== "all") {
    return buildGenreUrl(activeGenre, safePage);
  }

  const activeStatus = params.status?.trim().toLowerCase();
  if (activeStatus && activeStatus !== "all") {
    return buildStatusUrl(activeStatus, safePage);
  }

  const sortLower = (params.sortBy ?? "").trim().toLowerCase();
  if (sortLower === "hot") {
    return `${BASE_URL}/hot-novel?page=${safePage}`;
  }
  if (sortLower === "popular" || sortLower === "most-popular") {
    return `${BASE_URL}/most-popular?page=${safePage}`;
  }

  return `${BASE_URL}/latest-release-novel?page=${safePage}`;
}

/**
 * Dynamically detects content maturity rating from a novel's genre tags.
 */
export function detectContentRating(
  genres?: readonly string[] | null
): ContentRating {
  if (!Array.isArray(genres) || genres.length === 0) {
    return ContentRating.EVERYONE;
  }

  let hasSuggestive = false;
  for (let i = 0, len = genres.length; i < len; i++) {
    const g = genres[i]?.trim().toLowerCase();
    if (!g) continue;
    if (MATURE_GENRES_SET.has(g)) {
      return ContentRating.MATURE;
    }
    if (SUGGESTIVE_GENRES_SET.has(g)) {
      hasSuggestive = true;
    }
  }

  return hasSuggestive ? ContentRating.SUGGESTIVE : ContentRating.EVERYONE;
}
