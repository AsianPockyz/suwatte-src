import {
  type Chapter,
  type ChapterPage,
  type ChapterProvider as SuwatteChapterProvider,
  type Content,
  ContentRating,
  ContentStatus,
  ContentType,
  type Credit,
  type Item,
  type ItemCollection,
  NetworkClientBuilder,
  type NetworkRequest,
  type NetworkResponse,
  type PagedItemList,
  ReadingMode,
  type SourceChapterText,
  SourceChapterTextFormat,
  type Tag,
  type TagSection,
  type WebLink,
} from "@suwatte/toolchain";
import {
  ALL_CONTENT_RATINGS,
  ALL_ENABLED_FORMATS,
  API_BASE,
  ATSU_GENRES,
  ATSU_THEMES,
  BASE_URL,
  CDN_STATIC_BASE,
  CLOUDFLARE_FALLBACK_URL,
  CONTENT_URL_REGEX,
  DEFAULT_ALLOWED_CONTENT_RATINGS,
  DEFAULT_ENABLED_FORMATS,
  DEFAULT_HEADERS,
  DEFAULT_PAGE_SIZE,
  FALLBACK_COVER_URL,
  IMAGE_HEADERS,
  MANGA_URL_REGEX,
  NOVEL_URL_REGEX,
  ORIGIN_URL,
  PAGE_IMAGE_HEADERS,
  RATE_LIMIT_PER_SECOND,
  REFERER_URL,
  SEARCH_ENDPOINT,
  WEBP_ACCEPT_HEADER,
} from "./constants.js";
import {
  getImageFormatPreference,
  getUserPreferences,
  hasNsfwRating,
  normalizeFormatToken,
} from "./preferences.js";
import type {
  AtsuAllChaptersResponse,
  AtsuAuthor,
  AtsuBrowseResponse,
  AtsuChapterItem,
  AtsuChapterPage,
  AtsuGenreTag,
  AtsuMangaDetail,
  AtsuMangaPageResponse,
  AtsuMangaSummary,
  AtsuPaginatedChaptersResponse,
  AtsuPosterObject,
  AtsuReadChapterResponse,
  AtsuScanlator,
  AtsuSearchResponse,
  AtsuUserPreferences,
  CompiledFilterContext,
  ExploreParams,
  ImageQualityFormat,
  MangaDetailsResult,
} from "./types.js";

const DEFAULT_SYNOPSIS_FALLBACK = "No synopsis available for this title.";
const DEFAULT_SCANLATOR_ID = "atsu-unassigned";
const DEFAULT_SCANLATOR_NAME = "Atsumaru";

const MANGA_CACHE_TTL_MS = 10_000;
const MANGA_CACHE_MAX_ENTRIES = 10;

const GENRE_LOOKUP = new Map<string, string>(
  ATSU_GENRES.map((g) => [g.id, g.title])
);
const THEME_LOOKUP = new Map<string, string>(
  ATSU_THEMES.map((t) => [t.id, t.title])
);

const ALL_RATINGS_SET: ReadonlySet<string> = new Set<string>([
  "Safe",
  "Suggestive",
  "Erotica",
  "Pornographic",
  "Adult",
]);

const filterContextCacheStandard = new WeakMap<
  AtsuUserPreferences,
  CompiledFilterContext
>();
const filterContextCacheNsfwOverride = new WeakMap<
  AtsuUserPreferences,
  CompiledFilterContext
>();

function buildExclusionSet(
  rawIds: readonly string[] | undefined,
  lookup: ReadonlyMap<string, string>
): Set<string> {
  const set = new Set<string>();
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return set;
  }
  for (let i = 0, len = rawIds.length; i < len; i++) {
    const raw = rawIds[i];
    if (raw === undefined || raw === null) continue;
    const id = typeof raw === "string" ? raw.trim() : String(raw).trim();
    if (!id) continue;
    set.add(id);
    const title = lookup.get(id);
    if (title) {
      set.add(title);
      set.add(title.toLowerCase());
    }
  }
  return set;
}

/**
 * Compiles and memoizes O(1) Set lookup structures for a given preference snapshot.
 */
export function compileFilterContext(
  prefs: AtsuUserPreferences,
  allowNsfwOverride = false
): CompiledFilterContext {
  const cache = allowNsfwOverride
    ? filterContextCacheNsfwOverride
    : filterContextCacheStandard;

  const existing = cache.get(prefs);
  if (existing) {
    return existing;
  }

  const excludedGenreSet = buildExclusionSet(
    prefs.excludedGenres,
    GENRE_LOOKUP
  );
  const excludedTagSet = buildExclusionSet(prefs.excludedTags, THEME_LOOKUP);

  let allowedRatingsSet: ReadonlySet<string>;
  let allowsSafe: boolean;
  let allowsSuggestive: boolean;
  let allowsErotica: boolean;
  let allowsAdult: boolean;

  if (allowNsfwOverride) {
    allowedRatingsSet = ALL_RATINGS_SET;
    allowsSafe = true;
    allowsSuggestive = true;
    allowsErotica = true;
    allowsAdult = true;
  } else {
    const rawRatings =
      Array.isArray(prefs.contentRatings) && prefs.contentRatings.length > 0
        ? prefs.contentRatings
        : DEFAULT_ALLOWED_CONTENT_RATINGS;
    const ratingSet = new Set<string>(rawRatings);
    allowsSafe = ratingSet.has("Safe");
    allowsSuggestive = ratingSet.has("Suggestive");
    allowsErotica = ratingSet.has("Erotica");
    allowsAdult = ratingSet.has("Adult") || ratingSet.has("Pornographic");
    if (allowsAdult) {
      ratingSet.add("Adult");
      ratingSet.add("Pornographic");
    }
    allowedRatingsSet = ratingSet;
  }

  const rawFormats =
    Array.isArray(prefs.enabledFormats) && prefs.enabledFormats.length > 0
      ? prefs.enabledFormats
      : DEFAULT_ENABLED_FORMATS;

  const formatSet = new Set<string>();
  let allowsManga = false;
  let allowsManhwa = false;
  let allowsManhua = false;
  let allowsNovel = false;
  let allowsOel = false;
  let allowsOther = false;

  for (let i = 0, len = rawFormats.length; i < len; i++) {
    const rawFmt = rawFormats[i];
    if (!rawFmt) continue;
    const canonical = normalizeFormatToken(rawFmt);
    switch (canonical) {
      case "Manga":
        allowsManga = true;
        formatSet.add("Manga");
        formatSet.add("manga");
        break;
      case "Manhwa":
        allowsManhwa = true;
        formatSet.add("Manhwa");
        formatSet.add("Manwha");
        formatSet.add("manhwa");
        formatSet.add("manwha");
        break;
      case "Manhua":
        allowsManhua = true;
        formatSet.add("Manhua");
        formatSet.add("manhua");
        break;
      case "Novel":
        allowsNovel = true;
        formatSet.add("Novel");
        formatSet.add("novel");
        break;
      case "OEL":
        allowsOel = true;
        formatSet.add("OEL");
        formatSet.add("oel");
        formatSet.add("Comic");
        formatSet.add("comic");
        break;
      case "OTHER":
        allowsOther = true;
        formatSet.add("OTHER");
        formatSet.add("Other");
        formatSet.add("other");
        break;
    }
  }

  const compiled: CompiledFilterContext = {
    allowedRatingsSet,
    allowedFormatsSet: formatSet,
    excludedGenreSet,
    excludedTagSet,
    allowsSafe,
    allowsSuggestive,
    allowsErotica,
    allowsAdult,
    allowsManga,
    allowsManhwa,
    allowsManhua,
    allowsNovel,
    allowsOel,
    allowsOther,
  };

  cache.set(prefs, compiled);
  return compiled;
}

function isCloudflareBlocked(response: NetworkResponse): boolean {
  if (response.status !== 403 && response.status !== 503) {
    return false;
  }
  const headers = response.headers ?? {};
  const server = String(
    headers["server"] ?? headers["Server"] ?? ""
  ).toLowerCase();
  const cfMitigated = String(
    headers["cf-mitigated"] ?? headers["CF-Mitigated"] ?? ""
  ).toLowerCase();
  const body = typeof response.data === "string" ? response.data : "";

  return (
    cfMitigated.includes("challenge") ||
    server.includes("cloudflare") ||
    body.includes("cf-browser-verification") ||
    body.includes("Just a moment...") ||
    body.includes("Attention Required! | Cloudflare")
  );
}

/**
 * Mutually exclusive format classifier determining each item's single, effective format.
 */
export function getItemEffectiveFormat(
  item: any
): "Novel" | "Manga" | "Manhwa" | "Manhua" | "OEL" | "OTHER" {
  if (!item || typeof item !== "object") return "OTHER";
  // 1. If the item is a novel (text), its format is strictly "Novel"
  const medium = (item.medium || item.format || "").toString().toLowerCase();
  const isNovel =
    medium === "novel" ||
    item.isNovel === true ||
    item.type?.toString().toLowerCase() === "novel";
  if (isNovel) {
    return "Novel";
  }

  // 2. Otherwise, it is a graphic comic classified by its origin type
  const type = (item.type || item.medium || item.format || "").toString().toLowerCase();
  if (type.includes("manhwa") || type.includes("manwha")) return "Manhwa";
  if (type.includes("manhua")) return "Manhua";
  if (type.includes("oel")) return "OEL";
  if (type.includes("other")) return "OTHER";
  if (type.includes("manga")) return "Manga";

  return "OTHER";
}

/**
 * Detects whether a raw identifier or URL explicitly points to a Novel resource.
 */
export function isNovelIdentifier(idOrUrl: string): boolean {
  const trimmed = (idOrUrl ?? "").trim();
  if (!trimmed) {
    return false;
  }
  if (NOVEL_URL_REGEX.test(trimmed)) {
    return true;
  }
  if (/^novel[:/]/i.test(trimmed) || /\/novel\/[^/?#]+/i.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Detects whether a manga/novel summary or detail object represents a Novel.
 */
export function isNovelSummary(
  item?: Pick<AtsuMangaSummary, "type" | "medium"> | null
): boolean {
  if (!item) return false;
  return getItemEffectiveFormat(item) === "Novel";
}

/**
 * Extracts a clean Atsu.moe content ID (manga or novel) from either a raw ID or full URL.
 */
export function extractMangaId(idOrUrl: string): string {
  const trimmed = (idOrUrl ?? "").trim();
  if (!trimmed) {
    throw new Error("Manga identifier cannot be empty.");
  }

  const contentMatch = CONTENT_URL_REGEX.exec(trimmed);
  if (contentMatch?.[2]) {
    return decodeURIComponent(contentMatch[2]);
  }

  const regexMatch = MANGA_URL_REGEX.exec(trimmed);
  if (regexMatch?.[1]) {
    return decodeURIComponent(regexMatch[1]);
  }

  const novelMatch = NOVEL_URL_REGEX.exec(trimmed);
  if (novelMatch?.[1]) {
    return decodeURIComponent(novelMatch[1]);
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const withoutProtocol = trimmed.replace(/^https?:\/\/[^/]+/i, "");
    const pathname = (withoutProtocol.split(/[?#]/)[0] ?? "").trim();
    const parts = pathname
      .split("/")
      .filter((segment: string) => segment.length > 0);
    const contentIdx = parts.findIndex((segment: string) => {
      const lower = segment.toLowerCase();
      return lower === "manga" || lower === "novel";
    });
    if (contentIdx !== -1 && parts[contentIdx + 1]) {
      return decodeURIComponent(parts[contentIdx + 1]!);
    }
    const lastSegment = parts[parts.length - 1];
    if (lastSegment) {
      return decodeURIComponent(lastSegment);
    }
  }

  return trimmed
    .replace(/^\/+|\/+$/g, "")
    .replace(/^(?:manga|novel)[:/]/i, "")
    .trim();
}

/**
 * Percent-encodes a URL without double-encoding sequences that are already escaped.
 */
function safeEncodeUrl(url: string): string {
  try {
    return encodeURI(decodeURI(url));
  } catch {
    return encodeURI(url);
  }
}

/**
 * Normalizes a relative or absolute image path from Atsu.moe into a fully qualified,
 * URI-encoded `https://` URL on the image CDN.
 */
export function resolveImageUrl(
  rawImage?: string | AtsuPosterObject | null,
  imageFormat: ImageQualityFormat = "webp",
  fallback: string = FALLBACK_COVER_URL
): string {
  if (!rawImage) {
    return fallback;
  }

  let candidate: string | null | undefined;
  if (typeof rawImage === "object") {
    candidate =
      imageFormat === "webp"
        ? rawImage.mediumImage ??
          rawImage.image ??
          rawImage.largeImage ??
          rawImage.smallImage
        : rawImage.largeImage ??
          rawImage.image ??
          rawImage.mediumImage ??
          rawImage.smallImage;
  } else {
    candidate = rawImage;
  }

  if (!candidate || typeof candidate !== "string") {
    return fallback;
  }

  let value = candidate.trim();
  if (!value) {
    return fallback;
  }

  // Repair doubled / malformed protocols (e.g. "https://https://", "https:///", "https:/").
  if (value.startsWith("http")) {
    value = value
      .replace(/^https?:\/\/https?:\/\//i, "https://")
      .replace(/^(https?):\/{3,}/i, "$1://")
      .replace(/^(https?):\/(?!\/)/i, "$1://");
  } else if (value.startsWith("//")) {
    value = `https:${value}`;
  }

  if (value.startsWith("https://") || value.startsWith("http://") || /^https?:\/\//i.test(value)) {
    const absolute = value
      .replace(/^http:\/\//i, "https://")
      .replace(
        /^https:\/\/(?:www\.)?atsu\.moe\/static\//i,
        `${CDN_STATIC_BASE}/`
      );
    const encoded = safeEncodeUrl(absolute);
    return encoded.length >= 10 ? encoded : fallback;
  }

  const cleanRelative = value.replace(/^\/+/, "").replace(/^static\/+/i, "");
  if (!cleanRelative) {
    return fallback;
  }

  return safeEncodeUrl(`${CDN_STATIC_BASE}/${cleanRelative}`);
}

export function resolveMangaCover(
  manga: AtsuMangaSummary,
  imageFormat: ImageQualityFormat = "webp"
): string {
  if (imageFormat === "webp") {
    const preferred =
      manga.mediumImage ??
      manga.posterMedium ??
      manga.image ??
      manga.poster ??
      manga.largeImage ??
      manga.smallImage ??
      manga.posterSmall;
    return resolveImageUrl(preferred, imageFormat, FALLBACK_COVER_URL);
  }

  const preferred =
    manga.largeImage ??
    manga.image ??
    manga.poster ??
    manga.mediumImage ??
    manga.posterMedium ??
    manga.smallImage ??
    manga.posterSmall;
  return resolveImageUrl(preferred, imageFormat, FALLBACK_COVER_URL);
}

export function resolveBannerUrl(
  manga: AtsuMangaDetail,
  imageFormat: ImageQualityFormat = "webp"
): string | undefined {
  const rawBanner = manga.banner;
  if (!rawBanner) {
    return undefined;
  }
  const bannerUrlCandidate =
    typeof rawBanner === "string" ? rawBanner : rawBanner.url;
  if (
    !bannerUrlCandidate ||
    typeof bannerUrlCandidate !== "string" ||
    !bannerUrlCandidate.trim()
  ) {
    return undefined;
  }
  const resolved = resolveImageUrl(bannerUrlCandidate, imageFormat, "");
  return resolved.length >= 10 ? resolved : undefined;
}

export function mapContentRating(manga: AtsuMangaSummary): ContentRating {
  if (manga.isAdult === true) {
    return ContentRating.MATURE;
  }
  const raw = manga.mbContentRating;
  if (!raw) {
    return ContentRating.EVERYONE;
  }
  switch (raw) {
    case "Erotica":
    case "erotica":
    case "Pornographic":
    case "pornographic":
    case "Adult":
    case "adult":
      return ContentRating.MATURE;
    case "Suggestive":
    case "suggestive":
      return ContentRating.SUGGESTIVE;
    case "Safe":
    case "safe":
      return ContentRating.EVERYONE;
    default: {
      const lower = raw.trim().toLowerCase();
      if (lower === "erotica" || lower === "pornographic" || lower === "adult") {
        return ContentRating.MATURE;
      }
      if (lower === "suggestive") {
        return ContentRating.SUGGESTIVE;
      }
      return ContentRating.EVERYONE;
    }
  }
}

export function mapContentStatus(status?: string | null): ContentStatus {
  if (!status) {
    return ContentStatus.UNKNOWN;
  }
  switch (status) {
    case "Ongoing":
    case "ongoing":
      return ContentStatus.ONGOING;
    case "Completed":
    case "completed":
      return ContentStatus.COMPLETED;
    case "Hiatus":
    case "hiatus":
      return ContentStatus.HIATUS;
    case "Canceled":
    case "Cancelled":
    case "canceled":
    case "cancelled":
      return ContentStatus.CANCELLED;
    default: {
      const normalized = status.trim().toLowerCase();
      switch (normalized) {
        case "ongoing":
          return ContentStatus.ONGOING;
        case "completed":
          return ContentStatus.COMPLETED;
        case "hiatus":
          return ContentStatus.HIATUS;
        case "canceled":
        case "cancelled":
          return ContentStatus.CANCELLED;
        default:
          return ContentStatus.UNKNOWN;
      }
    }
  }
}

export function mapContentType(
  type?: string | null,
  medium?: string | null
): ContentType {
  const effective = getItemEffectiveFormat({ type, medium });
  switch (effective) {
    case "Novel":
      return ContentType.NOVEL;
    case "Manhwa":
      return ContentType.MANHWA;
    case "Manhua":
      return ContentType.MANHUA;
    case "OEL":
      return ContentType.COMIC;
    case "Manga":
    case "OTHER":
    default:
      return ContentType.MANGA;
  }
}

export function mapReadingMode(type?: string | null): ReadingMode {
  if (!type) {
    return ReadingMode.PAGED_MANGA;
  }
  if (
    type === "Manwha" ||
    type === "Manhwa" ||
    type === "Manhua" ||
    type === "manwha" ||
    type === "manhwa" ||
    type === "manhua"
  ) {
    return ReadingMode.VERTICAL;
  }
  const normalized = type.trim().toLowerCase();
  if (
    normalized === "manwha" ||
    normalized === "manhwa" ||
    normalized === "manhua"
  ) {
    return ReadingMode.VERTICAL;
  }
  return ReadingMode.PAGED_MANGA;
}

function parseTimestampToMs(rawDate?: number | string | null): number {
  if (rawDate === null || rawDate === undefined) {
    return 0;
  }
  if (typeof rawDate === "number") {
    if (!Number.isFinite(rawDate)) return 0;
    return rawDate < 1e11 ? rawDate * 1000 : rawDate;
  }
  if (typeof rawDate === "string" && rawDate.length > 0) {
    const numeric = Number(rawDate);
    if (Number.isFinite(numeric)) {
      return numeric < 1e11 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(rawDate);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function parseTimestampToDate(
  rawDate?: number | string | null
): Date | undefined {
  const ms = parseTimestampToMs(rawDate);
  return ms > 0 ? new Date(ms) : undefined;
}

export function mapSummaryToItem(
  manga: AtsuMangaSummary,
  imageFormat: ImageQualityFormat = "webp"
): Item {
  const rawId = manga.id;
  const id =
    rawId.includes("/") || rawId.startsWith("http")
      ? extractMangaId(rawId)
      : rawId.trim();
  const title = (manga.englishTitle || manga.title || "Untitled Series").trim();
  const coverImage = resolveMangaCover(manga, imageFormat);
  const rating = mapContentRating(manga);
  const effectiveFormat = getItemEffectiveFormat(manga);
  const isNovel = effectiveFormat === "Novel";

  const typeLabel = effectiveFormat;
  const statusLabel = manga.status ?? undefined;
  const subtitle =
    typeLabel && statusLabel
      ? `${typeLabel} • ${statusLabel}`
      : typeLabel || statusLabel || undefined;

  const rawScore = manga.mbRating ?? manga.avgRating;
  const numericScore =
    typeof rawScore === "number" && Number.isFinite(rawScore)
      ? Math.round(rawScore * 100) / 100
      : undefined;

  const rawViews = manga.views ?? manga.popularity;
  const numericViews =
    typeof rawViews === "number" && Number.isFinite(rawViews)
      ? rawViews
      : typeof rawViews === "string" && Number.isFinite(Number(rawViews))
        ? Number(rawViews)
        : undefined;

  const routeSegment = isNovel ? "novel" : "manga";
  const item: Item = {
    id,
    title,
    coverImage,
    webUrl: `${BASE_URL}/${routeSegment}/${encodeURIComponent(id)}`,
    rating,
  };

  if (subtitle) {
    item.subtitle = subtitle;
  }

  if (numericScore !== undefined || numericViews !== undefined) {
    item.statistics = {
      ...(numericScore !== undefined ? { rating: numericScore } : {}),
      ...(numericViews !== undefined ? { views: numericViews } : {}),
    };
  }

  return item;
}

/**
 * O(1) lookup helper that checks exact string match before trimming only if leading/trailing whitespace exists.
 */
function setHasToken(
  set: ReadonlySet<string>,
  raw: string | number | null | undefined
): boolean {
  if (raw === undefined || raw === null) {
    return false;
  }
  if (typeof raw === "string") {
    if (raw.length === 0) return false;
    if (set.has(raw)) return true;
    if (
      raw.charCodeAt(0) <= 32 ||
      raw.charCodeAt(raw.length - 1) <= 32
    ) {
      return set.has(raw.trim());
    }
    return false;
  }
  return set.has(String(raw));
}

function hasBlacklistedIdOrTag(
  exclusionSet: ReadonlySet<string>,
  ids?: ReadonlyArray<string | number>,
  entries?: ReadonlyArray<string | AtsuGenreTag>
): boolean {
  if (Array.isArray(ids)) {
    for (let i = 0, len = ids.length; i < len; i++) {
      if (setHasToken(exclusionSet, ids[i])) {
        return true;
      }
    }
  }
  if (Array.isArray(entries)) {
    for (let i = 0, len = entries.length; i < len; i++) {
      const entry = entries[i];
      if (typeof entry === "string") {
        if (setHasToken(exclusionSet, entry)) {
          return true;
        }
      } else if (entry && typeof entry === "object") {
        if (
          setHasToken(exclusionSet, entry.id) ||
          setHasToken(exclusionSet, entry.name)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Fast-path O(1) item evaluator using a pre-compiled filter context with immediate early exit.
 */
export function isMangaAllowedWithContext(
  manga: AtsuMangaSummary,
  ctx: CompiledFilterContext,
  allowNsfwOverride = false
): boolean {
  // 1. Early-exit on scalar maturity rating checks (O(1) property access) before iterating tag arrays
  if (!allowNsfwOverride) {
    if (manga.isAdult === true && !ctx.allowsAdult) {
      return false;
    }

    const rawRating = manga.mbContentRating;
    if (rawRating) {
      switch (rawRating) {
        case "Safe":
        case "safe":
          if (!ctx.allowsSafe) return false;
          break;
        case "Suggestive":
        case "suggestive":
          if (!ctx.allowsSuggestive) return false;
          break;
        case "Erotica":
        case "erotica":
          if (!ctx.allowsErotica) return false;
          break;
        case "Pornographic":
        case "pornographic":
        case "Adult":
        case "adult":
          if (!ctx.allowsAdult) return false;
          break;
        default: {
          const normalized = rawRating.trim().toLowerCase();
          if (normalized === "safe" && !ctx.allowsSafe) return false;
          if (normalized === "suggestive" && !ctx.allowsSuggestive) return false;
          if (normalized === "erotica" && !ctx.allowsErotica) return false;
          if (
            (normalized === "pornographic" || normalized === "adult") &&
            !ctx.allowsAdult
          ) {
            return false;
          }
          break;
        }
      }
    }
  }

  // 2. Early-exit on format/medium check in O(1) via Set lookup
  if (ctx.allowedFormatsSet.size > 0) {
    const effectiveFormat = getItemEffectiveFormat(manga);
    if (!ctx.allowedFormatsSet.has(effectiveFormat)) {
      return false;
    }
  }

  // 3. Early-exit on first blacklisted genre in O(1) per genre via Set lookup
  if (
    ctx.excludedGenreSet.size > 0 &&
    hasBlacklistedIdOrTag(ctx.excludedGenreSet, manga.genreIds, manga.genres)
  ) {
    return false;
  }

  // 4. Early-exit on first blacklisted tag in O(1) per tag via Set lookup
  if (
    ctx.excludedTagSet.size > 0 &&
    hasBlacklistedIdOrTag(ctx.excludedTagSet, manga.tagIds, manga.tags)
  ) {
    return false;
  }

  return true;
}

/**
 * Evaluates whether a manga passes content maturity ratings and exclusion filters using O(1) Set lookups.
 */
export function isMangaAllowed(
  manga: AtsuMangaSummary,
  allowedRatings: ReadonlySet<string> | readonly string[],
  excludedGenreSet: ReadonlySet<string>,
  excludedTagSet: ReadonlySet<string>,
  allowNsfwOverride = false,
  allowedFormats?: ReadonlySet<string> | readonly string[]
): boolean {
  const ratingSet: ReadonlySet<string> =
    allowedRatings instanceof Set ? allowedRatings : new Set(allowedRatings);

  const rawFormats = allowedFormats
    ? Array.from(allowedFormats)
    : ALL_ENABLED_FORMATS;
  const formatSet = new Set<string>();
  let allowsManga = false;
  let allowsManhwa = false;
  let allowsManhua = false;
  let allowsNovel = false;
  let allowsOel = false;
  let allowsOther = false;

  for (let i = 0, len = rawFormats.length; i < len; i++) {
    const f = rawFormats[i];
    if (!f) continue;
    const canonical = normalizeFormatToken(f);
    if (canonical === "Manga") {
      allowsManga = true;
      formatSet.add("Manga");
    } else if (canonical === "Manhwa") {
      allowsManhwa = true;
      formatSet.add("Manhwa");
    } else if (canonical === "Manhua") {
      allowsManhua = true;
      formatSet.add("Manhua");
    } else if (canonical === "Novel") {
      allowsNovel = true;
      formatSet.add("Novel");
    } else if (canonical === "OEL") {
      allowsOel = true;
      formatSet.add("OEL");
    } else if (canonical === "OTHER") {
      allowsOther = true;
      formatSet.add("OTHER");
    }
  }

  const ctx: CompiledFilterContext = {
    allowedRatingsSet: ratingSet,
    allowedFormatsSet: formatSet,
    excludedGenreSet,
    excludedTagSet,
    allowsSafe: ratingSet.has("Safe"),
    allowsSuggestive: ratingSet.has("Suggestive"),
    allowsErotica: ratingSet.has("Erotica"),
    allowsAdult: ratingSet.has("Adult") || ratingSet.has("Pornographic"),
    allowsManga,
    allowsManhwa,
    allowsManhua,
    allowsNovel,
    allowsOel,
    allowsOther,
  };

  return isMangaAllowedWithContext(manga, ctx, allowNsfwOverride);
}

function normalizeTagList(
  entries?: Array<string | AtsuGenreTag>,
  idList?: Array<string | number>,
  lookup?: Map<string, string>
): Tag[] {
  const tags: Tag[] = [];
  const seen = new Set<string>();

  if (Array.isArray(entries)) {
    for (let i = 0, len = entries.length; i < len; i++) {
      const entry = entries[i];
      if (typeof entry === "string") {
        const clean = entry.trim();
        if (!clean) continue;
        const title = lookup?.get(clean) ?? clean;
        const key = clean.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          tags.push({ id: clean, title });
        }
      } else if (entry && typeof entry === "object" && entry.name) {
        const id = String(entry.id || entry.name).trim();
        const title = String(entry.name).trim();
        if (!id || !title) continue;
        const key = id.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          tags.push({
            id,
            title,
            ...(entry.adult ? { rating: ContentRating.MATURE } : {}),
          });
        }
      }
    }
  }

  if (tags.length === 0 && Array.isArray(idList)) {
    for (let i = 0, len = idList.length; i < len; i++) {
      const id = String(idList[i]).trim();
      if (!id) continue;
      const title = lookup?.get(id);
      const key = id.toLowerCase();
      if (title && !seen.has(key)) {
        seen.add(key);
        tags.push({ id, title });
      }
    }
  }

  return tags;
}

function extractCredits(authors?: Array<string | AtsuAuthor>): Credit[] {
  if (!Array.isArray(authors) || authors.length === 0) {
    return [];
  }
  const credits: Credit[] = [];
  const seen = new Set<string>();

  for (let i = 0, len = authors.length; i < len; i++) {
    const author = authors[i];
    if (typeof author === "string") {
      const name = author.trim();
      const key = name.toLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        credits.push({ name, role: "Author" });
      }
    } else if (author && typeof author === "object" && author.name) {
      const name = author.name.trim();
      const role = author.type?.trim() || "Author";
      const key = `${name.toLowerCase()}::${role.toLowerCase()}`;
      if (name && !seen.has(key)) {
        seen.add(key);
        credits.push({ name, role });
      }
    }
  }

  return credits;
}

function extractExternalLinks(
  manga: AtsuMangaDetail,
  mangaId: string,
  isNovel = false
): WebLink[] {
  const routeSegment = isNovel ? "novel" : "manga";
  const links: WebLink[] = [
    {
      title: "View on Atsumaru",
      url: `${BASE_URL}/${routeSegment}/${encodeURIComponent(mangaId)}`,
    },
  ];

  if (manga.anilistId) {
    links.push({
      title: "AniList",
      url: `https://anilist.co/manga/${encodeURIComponent(String(manga.anilistId))}`,
    });
  }
  if (manga.malId) {
    links.push({
      title: "MyAnimeList",
      url: `https://myanimelist.net/manga/${encodeURIComponent(String(manga.malId))}`,
    });
  }
  if (manga.mangaBakaId) {
    links.push({
      title: "MangaBaka",
      url: `https://mangabaka.dev/${encodeURIComponent(String(manga.mangaBakaId))}`,
    });
  }
  if (manga.kitsuId) {
    links.push({
      title: "Kitsu",
      url: `https://kitsu.app/manga/${encodeURIComponent(String(manga.kitsuId))}`,
    });
  }
  if (manga.novelUpdatesId) {
    links.push({
      title: "NovelUpdates",
      url: `https://www.novelupdates.com/series/${encodeURIComponent(String(manga.novelUpdatesId))}/`,
    });
  }
  if (
    manga.kenmeiUrl &&
    typeof manga.kenmeiUrl === "string" &&
    manga.kenmeiUrl.startsWith("http")
  ) {
    links.push({
      title: "Kenmei",
      url: manga.kenmeiUrl,
    });
  }

  return links;
}

interface ActiveFormatSpecs {
  readonly canonicalFormats: string[];
  readonly typesenseTypeTokens: string[];
  readonly apiTypesParam: string;
  readonly apiMediumsParam: string;
  readonly hasNovel: boolean;
  readonly hasComic: boolean;
  readonly overrideFormatSet: ReadonlySet<string> | null;
}

function resolveActiveFormatSpecs(
  prefs: AtsuUserPreferences,
  formatOverride?: string
): ActiveFormatSpecs {
  const baseFormats =
    Array.isArray(prefs.enabledFormats) && prefs.enabledFormats.length > 0
      ? prefs.enabledFormats
      : DEFAULT_ENABLED_FORMATS;

  let activeInput: readonly string[] = baseFormats;
  let overrideFormatSet: Set<string> | null = null;

  if (formatOverride && formatOverride !== "all") {
    const rawParts = formatOverride
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (rawParts.length > 0) {
      activeInput = rawParts;
      overrideFormatSet = new Set<string>();
      for (let i = 0, len = rawParts.length; i < len; i++) {
        const part = rawParts[i]!;
        overrideFormatSet.add(part);
        const canonical = normalizeFormatToken(part);
        if (canonical === "Manga") {
          overrideFormatSet.add("Manga");
          overrideFormatSet.add("manga");
        } else if (canonical === "Manhwa") {
          overrideFormatSet.add("Manhwa");
          overrideFormatSet.add("Manwha");
          overrideFormatSet.add("manhwa");
          overrideFormatSet.add("manwha");
        } else if (canonical === "Manhua") {
          overrideFormatSet.add("Manhua");
          overrideFormatSet.add("manhua");
        } else if (canonical === "Novel") {
          overrideFormatSet.add("Novel");
          overrideFormatSet.add("novel");
        } else if (canonical === "OEL") {
          overrideFormatSet.add("OEL");
          overrideFormatSet.add("oel");
          overrideFormatSet.add("Comic");
          overrideFormatSet.add("comic");
        } else if (canonical === "OTHER") {
          overrideFormatSet.add("OTHER");
          overrideFormatSet.add("Other");
          overrideFormatSet.add("other");
        }
      }
    }
  }

  const canonicalSet = new Set<string>();
  const comicTypesenseTokensSet = new Set<string>();
  const comicApiTypesSet = new Set<string>();
  let hasNovel = false;
  let hasComic = false;

  for (let i = 0, len = activeInput.length; i < len; i++) {
    const raw = activeInput[i];
    if (!raw) continue;
    const canonical = normalizeFormatToken(raw);
    switch (canonical) {
      case "Manga":
        canonicalSet.add("Manga");
        comicTypesenseTokensSet.add("`Manga`");
        comicApiTypesSet.add("Manga");
        hasComic = true;
        break;
      case "Manhwa":
        canonicalSet.add("Manhwa");
        comicTypesenseTokensSet.add("`Manwha`");
        comicTypesenseTokensSet.add("`Manhwa`");
        comicApiTypesSet.add("Manwha");
        comicApiTypesSet.add("Manhwa");
        hasComic = true;
        break;
      case "Manhua":
        canonicalSet.add("Manhua");
        comicTypesenseTokensSet.add("`Manhua`");
        comicApiTypesSet.add("Manhua");
        hasComic = true;
        break;
      case "Novel":
        canonicalSet.add("Novel");
        hasNovel = true;
        break;
      case "OEL":
        canonicalSet.add("OEL");
        comicTypesenseTokensSet.add("`OEL`");
        comicApiTypesSet.add("OEL");
        hasComic = true;
        break;
      case "OTHER":
        canonicalSet.add("OTHER");
        comicTypesenseTokensSet.add("`OTHER`");
        comicTypesenseTokensSet.add("`Other`");
        comicApiTypesSet.add("OTHER");
        comicApiTypesSet.add("Other");
        hasComic = true;
        break;
    }
  }

  const apiMediumsParam =
    hasComic && hasNovel ? "Comic,Novel" : hasNovel ? "Novel" : "Comic";

  let apiTypesParam: string;
  if (hasNovel && !hasComic) {
    // Novel ONLY: do not restrict origin type so web/light novels of all origins pass
    apiTypesParam = "Manga,Manwha,Manhua,OEL,OTHER,Novel";
  } else if (hasNovel && hasComic) {
    // Both: include active comic types plus Novel
    const all = new Set(comicApiTypesSet);
    all.add("Novel");
    apiTypesParam = Array.from(all).join(",");
  } else if (comicApiTypesSet.size > 0) {
    // Comic ONLY: only include active comic types
    apiTypesParam = Array.from(comicApiTypesSet).join(",");
  } else {
    apiTypesParam = "Manga,Manwha,Manhua";
  }

  return {
    canonicalFormats: Array.from(canonicalSet),
    typesenseTypeTokens: Array.from(comicTypesenseTokensSet),
    apiTypesParam,
    apiMediumsParam,
    hasNovel,
    hasComic,
    overrideFormatSet,
  };
}

/**
 * Strips advertising scripts, style blocks, trackers, and unsafe attributes from novel chapter HTML,
 * normalizing paragraphs into clean `<p>` tags for Suwatte's native text reader.
 */
export function sanitizeNovelHtml(
  rawContent: string,
  chapterTitle?: string | null
): string {
  if (!rawContent || typeof rawContent !== "string") {
    return "<p>No chapter text available.</p>";
  }

  let cleaned = rawContent
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, "")
    // Strip script, style, iframe, noscript, object, embed, svg, canvas, form, and ins (ad slot) blocks
    .replace(
      /<(script|style|iframe|noscript|object|embed|form|ins)\b[^>]*>[\s\S]*?<\/\1>/gi,
      ""
    )
    .replace(/<(script|style|iframe|noscript|object|embed|ins|meta|link)\b[^>]*\/?>/gi, "")
    // Strip advertising, sponsor, promo, banner, and analytics containers
    .replace(
      /<(div|section|aside|p|span|a|figure)\b[^>]*(?:class|id|data-ad|data-ad-client|data-ad-slot|data-testid)\s*=\s*["'][^"']*(?:\bads?\b|adsbygoogle|ad-slot|ad-banner|ad-container|ad-wrapper|ad-unit|advertisement|sponsored|promo-banner|popup-ad|analytics|tracker|outbrain|taboola)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
      ""
    )
    // Remove inline event handlers (onclick, onload, onerror, etc.)
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // Neutralize javascript: and data:text/html URIs
    .replace(
      /\s+(href|src)\s*=\s*["']\s*(?:javascript:|vbscript:|data:text\/html)[^"']*["']/gi,
      ""
    );

  // Normalize <br><br> sequences into paragraph breaks
  cleaned = cleaned.replace(/(?:<br\s*\/?>\s*){2,}/gi, "</p><p>");
  cleaned = cleaned.replace(/<br\s*\/?>/gi, "<br>");

  // Sanitize <p ...> opening tags to clean <p> tags
  cleaned = cleaned.replace(/<p\b[^>]*>/gi, "<p>");

  // Convert standalone <div> blocks without nested <p> into <p> tags
  cleaned = cleaned.replace(/<div\b[^>]*>/gi, "<p>").replace(/<\/div>/gi, "</p>");

  // Remove arbitrary attributes from inline formatting tags while preserving semantic tags
  cleaned = cleaned.replace(
    /<(span|strong|b|em|i|u|s|blockquote|h[1-6]|hr)\b[^>]*>/gi,
    "<$1>"
  );

  // If no <p> tags exist at all, split plain text paragraphs into <p>...</p>
  if (!/<p>/i.test(cleaned)) {
    const blocks = cleaned
      .split(/\r?\n\s*\r?\n|\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (blocks.length > 0) {
      cleaned = blocks.map((line) => `<p>${line}</p>`).join("\n");
    } else if (cleaned.trim().length > 0) {
      cleaned = `<p>${cleaned.trim()}</p>`;
    }
  }

  // Collapse nested <p><p> and remove empty <p></p> tags
  cleaned = cleaned
    .replace(/<p>\s*<p>/gi, "<p>")
    .replace(/<\/p>\s*<\/p>/gi, "</p>")
    .replace(/<p>(?:\s|&nbsp;|\u00a0|<br>)*<\/p>/gi, "")
    .trim();

  if (!cleaned) {
    const fallbackTitle = chapterTitle?.trim();
    return fallbackTitle
      ? `<p>${fallbackTitle}</p>`
      : "<p>No chapter text available.</p>";
  }

  return cleaned;
}

interface ScanlatorInfo {
  readonly id: string;
  readonly name: string;
  readonly whitelistRank: number;
  readonly provider: SuwatteChapterProvider;
}

/**
 * Maps raw Atsu.moe chapters into Suwatte `Chapter` records, pre-computing scanlator
 * ranks and timestamps in O(1) lookup tables before sorting and deduplication.
 */
export function normalizeAndFilterChapters(
  mangaId: string,
  rawChapters: AtsuChapterItem[] | null | undefined,
  scanlators: AtsuScanlator[] | null | undefined,
  options: {
    deduplicate: boolean;
    whitelist: string[];
  }
): Chapter[] {
  if (!Array.isArray(rawChapters) || rawChapters.length === 0) {
    return [];
  }

  const normalizedWhitelist: string[] = [];
  for (let i = 0, len = options.whitelist.length; i < len; i++) {
    const entry = options.whitelist[i]?.trim().toLowerCase();
    if (entry) {
      normalizedWhitelist.push(entry);
    }
  }

  const computeWhitelistRank = (name: string): number => {
    if (normalizedWhitelist.length === 0) {
      return Number.MAX_SAFE_INTEGER;
    }
    const lowerName = name.toLowerCase();
    for (let i = 0, len = normalizedWhitelist.length; i < len; i++) {
      const target = normalizedWhitelist[i];
      if (target && lowerName.includes(target)) {
        return i;
      }
    }
    return Number.MAX_SAFE_INTEGER;
  };

  const encodedMangaId = encodeURIComponent(mangaId);
  const mangaWebUrl = `${BASE_URL}/manga/${encodedMangaId}`;

  const buildScanlatorInfo = (id: string, name: string): ScanlatorInfo => ({
    id,
    name,
    whitelistRank: computeWhitelistRank(name),
    provider: {
      id,
      name,
      links: [{ title: name, url: mangaWebUrl }],
    },
  });

  const defaultScanlatorInfo = buildScanlatorInfo(
    DEFAULT_SCANLATOR_ID,
    DEFAULT_SCANLATOR_NAME
  );

  const scanlatorInfoMap = new Map<string, ScanlatorInfo>();
  if (Array.isArray(scanlators)) {
    for (let i = 0, len = scanlators.length; i < len; i++) {
      const scan = scanlators[i];
      if (scan?.id && scan?.name) {
        const id = String(scan.id);
        const name = String(scan.name).trim() || DEFAULT_SCANLATOR_NAME;
        scanlatorInfoMap.set(id, buildScanlatorInfo(id, name));
      }
    }
  }

  const getScanlatorInfo = (chapter: AtsuChapterItem): ScanlatorInfo => {
    const rawId = chapter.scanlationMangaId ?? chapter.scanId;
    if (!rawId) {
      return defaultScanlatorInfo;
    }
    const key = String(rawId);
    let info = scanlatorInfoMap.get(key);
    if (!info) {
      info = buildScanlatorInfo(key, DEFAULT_SCANLATOR_NAME);
      scanlatorInfoMap.set(key, info);
    }
    return info;
  };

  // Pre-compute numeric timestamp per chapter to avoid Date allocations in sort comparators
  const timestampMap = new WeakMap<AtsuChapterItem, number>();
  const getTimestampMs = (ch: AtsuChapterItem): number => {
    const cached = timestampMap.get(ch);
    if (cached !== undefined) {
      return cached;
    }
    const ms = parseTimestampToMs(ch.createdAt);
    timestampMap.set(ch, ms);
    return ms;
  };

  let selectedChapters: AtsuChapterItem[];

  if (options.deduplicate) {
    const groupedByNumber = new Map<string, AtsuChapterItem[]>();
    for (let i = 0, len = rawChapters.length; i < len; i++) {
      const ch = rawChapters[i];
      if (!ch || !ch.id) continue;
      const numKey =
        typeof ch.number === "number" && Number.isFinite(ch.number)
          ? String(ch.number)
          : `id:${ch.id}`;
      const bucket = groupedByNumber.get(numKey);
      if (bucket) {
        bucket.push(ch);
      } else {
        groupedByNumber.set(numKey, [ch]);
      }
    }

    selectedChapters = [];
    for (const candidates of groupedByNumber.values()) {
      if (candidates.length === 1) {
        selectedChapters.push(candidates[0]!);
        continue;
      }

      let best = candidates[0]!;
      let bestInfo = getScanlatorInfo(best);
      let bestPages = best.pageCount ?? 0;
      let bestDate = getTimestampMs(best);

      // Find best candidate in O(K) single linear scan instead of O(K log K) array copy + sort
      for (let i = 1, len = candidates.length; i < len; i++) {
        const cand = candidates[i]!;
        const candInfo = getScanlatorInfo(cand);
        if (candInfo.whitelistRank !== bestInfo.whitelistRank) {
          if (candInfo.whitelistRank < bestInfo.whitelistRank) {
            best = cand;
            bestInfo = candInfo;
            bestPages = cand.pageCount ?? 0;
            bestDate = getTimestampMs(cand);
          }
          continue;
        }
        const candPages = cand.pageCount ?? 0;
        if (candPages !== bestPages) {
          if (candPages > bestPages) {
            best = cand;
            bestInfo = candInfo;
            bestPages = candPages;
            bestDate = getTimestampMs(cand);
          }
          continue;
        }
        const candDate = getTimestampMs(cand);
        if (candDate > bestDate) {
          best = cand;
          bestInfo = candInfo;
          bestPages = candPages;
          bestDate = candDate;
        }
      }

      selectedChapters.push(best);
    }
  } else {
    selectedChapters = [];
    for (let i = 0, len = rawChapters.length; i < len; i++) {
      const ch = rawChapters[i];
      if (ch && ch.id) {
        selectedChapters.push(ch);
      }
    }
  }

  selectedChapters.sort((a, b) => {
    const numA =
      typeof a.number === "number" && Number.isFinite(a.number) ? a.number : -1;
    const numB =
      typeof b.number === "number" && Number.isFinite(b.number) ? b.number : -1;
    if (numA !== numB) {
      return numB - numA;
    }
    return getTimestampMs(b) - getTimestampMs(a);
  });

  const result = new Array<Chapter>(selectedChapters.length);
  for (let idx = 0, len = selectedChapters.length; idx < len; idx++) {
    const ch = selectedChapters[idx]!;
    const scanInfo = getScanlatorInfo(ch);
    const chapterNumber =
      typeof ch.number === "number" &&
      Number.isFinite(ch.number) &&
      ch.number >= 0
        ? ch.number
        : -1;

    const rawTitle = (ch.title ?? "").trim();
    const displayTitle =
      rawTitle ||
      (chapterNumber >= 0 ? `Chapter ${chapterNumber}` : `Chapter ${idx + 1}`);

    const chapterIdStr = String(ch.id);
    const chapter: Chapter = {
      id: chapterIdStr,
      index: idx,
      number: chapterNumber,
      title: displayTitle,
      language: "en",
      webUrl: `${BASE_URL}/read/${encodedMangaId}/${encodeURIComponent(chapterIdStr)}`,
      providers: [scanInfo.provider],
      data: {
        mangaId,
        scanlatorId: scanInfo.id,
        scanlatorName: scanInfo.name,
        ...(typeof ch.pageCount === "number" ? { pageCount: ch.pageCount } : {}),
      },
    };

    if (
      typeof ch.volume === "number" &&
      Number.isFinite(ch.volume) &&
      ch.volume > 0
    ) {
      chapter.volume = ch.volume;
    }

    const releaseMs = getTimestampMs(ch);
    if (releaseMs > 0) {
      chapter.date = new Date(releaseMs);
    }

    result[idx] = chapter;
  }

  return result;
}

interface CachedMangaBundle {
  readonly detail: AtsuMangaDetail;
  readonly rawChapters: AtsuChapterItem[];
  readonly timestamp: number;
}

export class AtsuApiClient {
  public readonly client: NetworkClient;
  private readonly mangaCache = new Map<string, CachedMangaBundle>();
  private readonly inflightMangaRequests = new Map<
    string,
    Promise<CachedMangaBundle>
  >();
  private readonly knownNovelIds = new Set<string>();

  public getItemEffectiveFormat(
    item: any
  ): "Novel" | "Manga" | "Manhwa" | "Manhua" | "OEL" | "OTHER" {
    return getItemEffectiveFormat(item);
  }

  constructor(client?: NetworkClient) {
    if (client) {
      this.client = client;
      return;
    }

    const builder = new NetworkClientBuilder()
      .setRateLimit(RATE_LIMIT_PER_SECOND, 1)
      .setTimeout(20000)
      .setMaxRetries(2);

    for (const [key, value] of Object.entries(DEFAULT_HEADERS)) {
      builder.addHeader(key, value);
    }

    builder.addRequestInterceptor(async (request: NetworkRequest) => {
      request.headers = {
        ...DEFAULT_HEADERS,
        ...(request.headers ?? {}),
        Referer: REFERER_URL,
        Origin: ORIGIN_URL,
      };
      return request;
    });

    builder.addResponseInterceptor(async (response: NetworkResponse) => {
      if (isCloudflareBlocked(response)) {
        throw new CloudflareError(CLOUDFLARE_FALLBACK_URL);
      }
      return response;
    });

    this.client = builder.build();
  }

  private async getJson<T>(
    url: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    let cleanParams: Record<string, string | number | boolean> | undefined;
    if (params) {
      for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null && val !== "") {
          if (!cleanParams) {
            cleanParams = {};
          }
          cleanParams[key] = val;
        }
      }
    }

    let response: NetworkResponse;
    try {
      response = await this.client.get(url, {
        params: cleanParams,
        headers: DEFAULT_HEADERS,
      });
    } catch (error) {
      if (error instanceof CloudflareError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.toLowerCase().includes("cloudflare") ||
        message.includes("403") ||
        message.includes("503")
      ) {
        throw new CloudflareError(CLOUDFLARE_FALLBACK_URL);
      }
      throw new Error(`Network request failed for ${url}: ${message}`);
    }

    if (isCloudflareBlocked(response)) {
      throw new CloudflareError(CLOUDFLARE_FALLBACK_URL);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Atsumaru API returned HTTP ${response.status} for ${url}`
      );
    }

    if (!response.data || typeof response.data !== "string") {
      throw new Error(`Empty response payload from ${url}`);
    }

    try {
      return JSON.parse(response.data) as T;
    } catch (parseErr) {
      const snippet = response.data.slice(0, 120);
      if (
        snippet.includes("<!DOCTYPE html") ||
        snippet.includes("Cloudflare")
      ) {
        throw new CloudflareError(CLOUDFLARE_FALLBACK_URL);
      }
      throw new Error(
        `Invalid JSON response from ${url}: ${
          parseErr instanceof Error ? parseErr.message : String(parseErr)
        }`
      );
    }
  }

  /**
   * Evaluates and filters raw manga summaries against content maturity ratings and exclusion preferences
   * using memoized O(1) Set lookups and early-exit evaluation.
   */
  public filterSummaryItems(
    items: AtsuMangaSummary[],
    prefs: AtsuUserPreferences,
    allowNsfwOverride = false
  ): AtsuMangaSummary[] {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const ctx = compileFilterContext(prefs, allowNsfwOverride);
    const result: AtsuMangaSummary[] = [];

    for (let i = 0, len = items.length; i < len; i++) {
      const item = items[i];
      if (
        item &&
        isMangaAllowedWithContext(item, ctx, allowNsfwOverride)
      ) {
        result.push(item);
      }
    }

    return result;
  }

  /**
   * Single-pass filter and Item mapper that eliminates intermediate array allocations.
   */
  private filterAndMapSummaries(
    rawDocs: ReadonlyArray<AtsuMangaSummary | null | undefined>,
    prefs: AtsuUserPreferences,
    allowNsfwOverride: boolean
  ): Item[] {
    const ctx = compileFilterContext(prefs, allowNsfwOverride);
    const imageFormat = prefs.imageFormat;
    const items: Item[] = [];

    for (let i = 0, len = rawDocs.length; i < len; i++) {
      const doc = rawDocs[i];
      if (!doc || !doc.id) continue;
      if (isNovelSummary(doc)) {
        this.knownNovelIds.add(extractMangaId(doc.id));
      }
      if (isMangaAllowedWithContext(doc, ctx, allowNsfwOverride)) {
        items.push(mapSummaryToItem(doc, imageFormat));
      }
    }

    return items;
  }

  /**
   * Builds the Typesense `filter_by` expression used by Atsu.moe's `/collections/manga/documents/search`.
   * Uses O(1) Set lookups and comma-separated server-side filter lists to reduce raw network payloads.
   */
  public buildTypesenseFilterBy(
    params: ExploreParams,
    prefsOrShowNsfw: AtsuUserPreferences | boolean
  ): string {
    const prefs: AtsuUserPreferences =
      typeof prefsOrShowNsfw === "object" && prefsOrShowNsfw !== null
        ? prefsOrShowNsfw
        : {
            imageFormat: "webp",
            deduplicateChapters: true,
            scanlatorWhitelist: [],
            showNsfw: Boolean(prefsOrShowNsfw),
            contentRatings: prefsOrShowNsfw
              ? [...ALL_CONTENT_RATINGS]
              : [...DEFAULT_ALLOWED_CONTENT_RATINGS],
            excludedGenres: [],
            excludedTags: [],
            enabledFormats: [...DEFAULT_ENABLED_FORMATS],
          };

    const effectiveFormatOverride =
      params.format && params.format !== "all"
        ? params.format
        : params.mode === "manga"
          ? "Manga"
          : params.mode === "manhwa"
            ? "Manhwa"
            : undefined;

    const formatSpecs = resolveActiveFormatSpecs(prefs, effectiveFormatOverride);

    const clauses: string[] = ["hidden:!=true"];
    if (formatSpecs.hasNovel && !formatSpecs.hasComic) {
      // ONLY Novel: filter by medium Novel, do not restrict type so novels of any origin pass
      clauses.push("medium:=[`Novel`]");
    } else if (!formatSpecs.hasNovel && formatSpecs.hasComic) {
      // ONLY Comics: exclude Novel medium and restrict type to selected comic origins
      clauses.push("medium:!=[`Novel`]");
      if (formatSpecs.typesenseTypeTokens.length > 0) {
        clauses.push(`type:=[${formatSpecs.typesenseTypeTokens.join(",")}]`);
      }
    } else if (formatSpecs.hasNovel && formatSpecs.hasComic) {
      // Both Novel and Comics enabled
      clauses.push("medium:=[`Comic`,`Novel`]");
      if (
        formatSpecs.typesenseTypeTokens.length > 0 &&
        formatSpecs.typesenseTypeTokens.length < 8
      ) {
        clauses.push(
          `(medium:=[\`Novel\`] || type:=[${formatSpecs.typesenseTypeTokens.join(",")}])`
        );
      }
    }
    clauses.push("views:>0");

    const isSearchNsfwOverride = params.includeNsfw === true;
    const ctx = compileFilterContext(prefs, isSearchNsfwOverride);

    if (!ctx.allowsAdult) {
      clauses.push("isAdult:=false");
    }

    const mbRatings: string[] = [];
    if (ctx.allowsSafe) mbRatings.push("`Safe`");
    if (ctx.allowsSuggestive) mbRatings.push("`Suggestive`");
    if (ctx.allowsErotica) mbRatings.push("`Erotica`");
    if (ctx.allowsAdult) mbRatings.push("`Pornographic`");

    if (mbRatings.length > 0) {
      clauses.push(
        `(mbContentRating:=[${mbRatings.join(",")}] || mbContentRating:!=*)`
      );
    } else {
      clauses.push("mbContentRating:=[`none`]");
    }

    if (params.status && params.status !== "all") {
      if (params.status.includes(",")) {
        const parts = params.status
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => `\`${s}\``)
          .join(",");
        if (parts) {
          clauses.push(`status:=[${parts}]`);
        }
      } else {
        clauses.push(`status:=[\`${params.status}\`]`);
      }
    }

    const includedGenres = new Set<string>(params.genres?.include ?? []);
    const excludedGenres = new Set<string>(prefs.excludedGenres ?? []);
    if (params.genres?.exclude) {
      for (let i = 0, len = params.genres.exclude.length; i < len; i++) {
        const g = params.genres.exclude[i];
        if (g) excludedGenres.add(g);
      }
    }
    for (const inc of includedGenres) {
      excludedGenres.delete(inc);
      clauses.push(`genreIds:=\`${inc}\``);
    }
    if (excludedGenres.size > 0) {
      const formatted: string[] = [];
      for (const id of excludedGenres) {
        formatted.push(`\`${id}\``);
      }
      clauses.push(`genreIds:!=[${formatted.join(",")}]`);
    }

    const includedTags = new Set<string>(params.tags?.include ?? []);
    const excludedTags = new Set<string>(prefs.excludedTags ?? []);
    if (params.tags?.exclude) {
      for (let i = 0, len = params.tags.exclude.length; i < len; i++) {
        const t = params.tags.exclude[i];
        if (t) excludedTags.add(t);
      }
    }
    for (const inc of includedTags) {
      excludedTags.delete(inc);
      clauses.push(`tagIds:=\`${inc}\``);
    }
    if (excludedTags.size > 0) {
      const formatted: string[] = [];
      for (const id of excludedTags) {
        formatted.push(`\`${id}\``);
      }
      clauses.push(`tagIds:!=[${formatted.join(",")}]`);
    }

    return clauses.join(" && ");
  }

  public buildTypesenseSortBy(params: ExploreParams): string {
    const rawKey =
      params.sortBy ??
      (params.mode === "top_rated"
        ? "mbRating"
        : params.mode === "latest" || params.mode === "recently_added"
          ? "dateAdded"
          : params.mode === "popular" || params.mode === "most_bookmarked"
            ? "views"
            : "trending");

    if (rawKey === "title_asc") {
      return "title:asc";
    }
    if (rawKey === "title_desc") {
      return "title:desc";
    }

    const direction =
      typeof params.sortAscending === "boolean"
        ? params.sortAscending
          ? "asc"
          : "desc"
        : "desc";

    if (rawKey === "updatedAt") {
      return `dateAdded:${direction}`;
    }
    if (rawKey === "popularity") {
      return `views:${direction}`;
    }

    switch (rawKey) {
      case "mbRating":
      case "dateAdded":
      case "released":
      case "trending":
      case "views":
        return `${rawKey}:${direction}`;
      default:
        return `trending:${direction}`;
    }
  }

  /**
   * Queries Atsu.moe's catalog with support for text search, tri-state genre/tag filters,
   * format/status filters, sorting, and pagination.
   */
  public async fetchExplore(
    params: ExploreParams = {},
    preloadedPrefs?: AtsuUserPreferences
  ): Promise<PagedItemList> {
    const prefs = preloadedPrefs ?? (await getUserPreferences());
    const page = Math.max(1, params.page ?? 1);
    const perPage = params.perPage ?? DEFAULT_PAGE_SIZE;
    const isSearchNsfwOverride = params.includeNsfw === true;

    const queryText = params.query?.trim() || "*";
    const filterBy = this.buildTypesenseFilterBy(params, prefs);
    const sortBy = this.buildTypesenseSortBy(params);
    const effectiveFormatOverride =
      params.format && params.format !== "all"
        ? params.format
        : params.mode === "manga"
          ? "Manga"
          : params.mode === "manhwa"
            ? "Manhwa"
            : undefined;
    const formatSpecs = resolveActiveFormatSpecs(prefs, effectiveFormatOverride);
    const overrideFormatSet = formatSpecs.overrideFormatSet;

    const searchParams: Record<string, string | number | boolean | undefined> =
      {
        q: queryText,
        page,
        per_page: perPage,
        filter_by: filterBy,
        include_fields:
          "id,title,englishTitle,image,poster,smallImage,mediumImage,largeImage,type,medium,status,isAdult,mbContentRating,mbRating,avgRating,views,popularity,genreIds,tagIds",
      };

    if (queryText !== "*") {
      searchParams.query_by = "title,englishTitle,otherNames,authors,acronyms";
      searchParams.query_by_weights = "4,4,3,2,1";
      searchParams.num_typos = "4,4,3,2,1";
      searchParams.sort_by = params.sortBy
        ? `${sortBy},_text_match:desc`
        : "_text_match:desc,trending:desc";
    } else {
      searchParams.sort_by = sortBy;
    }

    try {
      const response = await this.getJson<AtsuSearchResponse>(
        SEARCH_ENDPOINT,
        searchParams
      );

      const hits = Array.isArray(response?.hits) ? response.hits : [];
      const ctx = compileFilterContext(prefs, isSearchNsfwOverride);
      const imageFormat = prefs.imageFormat;
      const items: Item[] = [];

      // Single-pass extraction, early-exit O(1) Set filtering, and Item mapping
      for (let i = 0, len = hits.length; i < len; i++) {
        const doc = hits[i]?.document;
        if (!doc || !doc.id) continue;
        if (isNovelSummary(doc)) {
          this.knownNovelIds.add(extractMangaId(doc.id));
        }
        if (!isMangaAllowedWithContext(doc, ctx, isSearchNsfwOverride)) {
          continue;
        }
        if (overrideFormatSet) {
          const itemFormat = getItemEffectiveFormat(doc);
          if (!overrideFormatSet.has(itemFormat)) {
            continue;
          }
        }
        items.push(mapSummaryToItem(doc, imageFormat));
      }

      const total =
        typeof response?.found === "number" ? response.found : items.length;
      const effectivePerPage = response?.request_params?.per_page ?? perPage;
      const isLastPage =
        hits.length === 0 || page * effectivePerPage >= total;

      return {
        items,
        total,
        isLastPage,
      };
    } catch (error) {
      if (error instanceof CloudflareError) {
        throw error;
      }
      if (queryText === "*") {
        const fallbackEndpoint =
          params.mode === "latest"
            ? "recentlyUpdated"
            : params.mode === "hot_updates"
              ? "hotUpdates"
              : params.mode === "recently_added"
                ? "recentlyAdded"
                : params.mode === "top_rated"
                  ? "topRated"
                  : params.mode === "most_bookmarked"
                    ? "mostBookmarked"
                    : "popular";
        return this.fetchHomeEndpoint(
          fallbackEndpoint,
          page,
          perPage,
          prefs,
          isSearchNsfwOverride,
          formatSpecs.apiTypesParam,
          formatSpecs.apiMediumsParam
        );
      }
      throw error;
    }
  }

  public async fetchHomeEndpoint(
    endpoint:
      | "popular"
      | "recentlyUpdated"
      | "hotUpdates"
      | "recentlyAdded"
      | "topRated"
      | "mostBookmarked"
      | string,
    page = 1,
    limit = DEFAULT_PAGE_SIZE,
    prefsOrAllowNsfw?: AtsuUserPreferences | boolean,
    isNsfwOverride = false,
    types?: string,
    mediums?: string
  ): Promise<PagedItemList> {
    const prefs: AtsuUserPreferences =
      typeof prefsOrAllowNsfw === "object" && prefsOrAllowNsfw !== null
        ? prefsOrAllowNsfw
        : await getUserPreferences();

    const ctx = compileFilterContext(prefs, isNsfwOverride);
    const allowAdult =
      isNsfwOverride ||
      (typeof prefsOrAllowNsfw === "boolean"
        ? prefsOrAllowNsfw
        : ctx.allowsAdult);

    const formatSpecs = resolveActiveFormatSpecs(prefs, types);
    const offset = Math.max(0, (page - 1) * limit);
    const params: Record<string, string | number | boolean | undefined> = {
      offset,
      limit,
      types: types ?? formatSpecs.apiTypesParam,
      mediums: mediums ?? formatSpecs.apiMediumsParam,
      ...(endpoint === "popular" ? { timeframe: "daily" } : {}),
      ...(allowAdult ? { adult: 1 } : {}),
    };

    const data = await this.getJson<AtsuBrowseResponse>(
      `${API_BASE}/home2/${endpoint}`,
      params
    );
    const rawItems = Array.isArray(data?.items) ? data.items : [];
    const items = this.filterAndMapSummaries(rawItems, prefs, isNsfwOverride);

    return {
      items,
      isLastPage: rawItems.length < limit,
    };
  }

  /**
   * Fetches the complete chapter list for a novel from `/api/novel/allChapters` or `/api/novel/chapters`,
   * with fallback to `/api/manga/allChapters`.
   */
  public async fetchRawNovelChapters(
    novelId: string,
    fallbackChapters?: AtsuChapterItem[] | null
  ): Promise<AtsuChapterItem[]> {
    const cleanId = extractMangaId(novelId);
    try {
      const response = await this.getJson<AtsuAllChaptersResponse>(
        `${API_BASE}/novel/allChapters`,
        { novelId: cleanId, mangaId: cleanId, id: cleanId }
      );
      const list = response?.novelChapters ?? response?.chapters;
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
    } catch (error) {
      if (error instanceof CloudflareError) {
        throw error;
      }
    }

    try {
      const paged = await this.getJson<AtsuPaginatedChaptersResponse>(
        `${API_BASE}/novel/chapters`,
        {
          id: cleanId,
          novelId: cleanId,
          filter: "all",
          sort: "desc",
          page: 0,
        }
      );
      const list = paged?.novelChapters ?? paged?.chapters;
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
    } catch (error) {
      if (error instanceof CloudflareError) {
        throw error;
      }
    }

    return this.fetchRawChapters(cleanId, fallbackChapters);
  }

  /**
   * Fetches the complete chapter list for a manga from `/api/manga/allChapters?mangaId={id}`,
   * with a defensive fallback to `/api/manga/chapters` if needed.
   */
  public async fetchRawChapters(
    mangaId: string,
    fallbackChapters?: AtsuChapterItem[] | null
  ): Promise<AtsuChapterItem[]> {
    const cleanId = extractMangaId(mangaId);
    try {
      const response = await this.getJson<AtsuAllChaptersResponse>(
        `${API_BASE}/manga/allChapters`,
        { mangaId: cleanId }
      );
      const list = response?.chapters ?? response?.novelChapters;
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
    } catch (error) {
      if (error instanceof CloudflareError) {
        throw error;
      }
    }

    try {
      const paged = await this.getJson<AtsuPaginatedChaptersResponse>(
        `${API_BASE}/manga/chapters`,
        {
          id: cleanId,
          filter: "all",
          sort: "desc",
          page: 0,
        }
      );
      const list = paged?.chapters ?? paged?.novelChapters;
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
    } catch (error) {
      if (error instanceof CloudflareError) {
        throw error;
      }
    }

    return Array.isArray(fallbackChapters) ? fallbackChapters : [];
  }

  private async fetchPageDetailWithDualRoute(
    cleanId: string,
    preferNovelRoute: boolean
  ): Promise<AtsuMangaDetail | undefined> {
    const extractDetail = (
      res?: AtsuMangaPageResponse | AtsuMangaDetail | null
    ): AtsuMangaDetail | undefined => {
      if (!res || typeof res !== "object") return undefined;
      if ("novelPage" in res && res.novelPage?.id) return res.novelPage;
      if ("mangaPage" in res && res.mangaPage?.id) return res.mangaPage;
      if ("novel" in res && res.novel?.id) return res.novel;
      if ("manga" in res && res.manga?.id) return res.manga;
      if ("id" in res && typeof res.id === "string" && res.id) {
        return res as AtsuMangaDetail;
      }
      return undefined;
    };

    const primaryUrl = preferNovelRoute
      ? `${API_BASE}/novel/page`
      : `${API_BASE}/manga/page`;
    const secondaryUrl = preferNovelRoute
      ? `${API_BASE}/manga/page`
      : `${API_BASE}/novel/page`;

    try {
      const primaryRes = await this.getJson<AtsuMangaPageResponse>(primaryUrl, {
        id: cleanId,
        ...(preferNovelRoute ? { novelId: cleanId } : {}),
      });
      const detail = extractDetail(primaryRes);
      if (detail) {
        return detail;
      }
    } catch (error) {
      if (error instanceof CloudflareError) {
        throw error;
      }
    }

    try {
      const secondaryRes = await this.getJson<AtsuMangaPageResponse>(
        secondaryUrl,
        {
          id: cleanId,
          ...(!preferNovelRoute ? { novelId: cleanId } : {}),
        }
      );
      const detail = extractDetail(secondaryRes);
      if (detail) {
        return detail;
      }
    } catch (error) {
      if (error instanceof CloudflareError) {
        throw error;
      }
    }

    return undefined;
  }

  /**
   * Concurrently fetches metadata and chapters via `Promise.all` (routing to novel or manga endpoints),
   * deduplicating in-flight requests and caching results briefly so back-to-back
   * `getContent` and `getChapters` calls do not duplicate network requests.
   */
  private async fetchMangaBundle(
    idOrUrl: string
  ): Promise<CachedMangaBundle> {
    const mangaId = extractMangaId(idOrUrl);
    const preferNovel =
      isNovelIdentifier(idOrUrl) || this.knownNovelIds.has(mangaId);

    const now = Date.now();
    const cached = this.mangaCache.get(mangaId);
    if (cached && now - cached.timestamp < MANGA_CACHE_TTL_MS) {
      return cached;
    }

    const inflight = this.inflightMangaRequests.get(mangaId);
    if (inflight) {
      return inflight;
    }

    const requestPromise = (async (): Promise<CachedMangaBundle> => {
      const [detail, initialChapters] = await Promise.all([
        this.fetchPageDetailWithDualRoute(mangaId, preferNovel),
        preferNovel
          ? this.fetchRawNovelChapters(mangaId)
          : this.fetchRawChapters(mangaId),
      ]);

      if (!detail || !detail.id) {
        throw new Error(`Content details not found for ID "${mangaId}".`);
      }

      const detectedNovel = preferNovel || isNovelSummary(detail);
      if (detectedNovel) {
        this.knownNovelIds.add(mangaId);
      }

      let rawChapters = initialChapters;
      if (rawChapters.length === 0 && detectedNovel && !preferNovel) {
        rawChapters = await this.fetchRawNovelChapters(
          mangaId,
          detail.chapters
        );
      }

      const effectiveChapters =
        rawChapters.length > 0
          ? rawChapters
          : Array.isArray(detail.chapters)
            ? detail.chapters
            : [];

      const bundle: CachedMangaBundle = {
        detail,
        rawChapters: effectiveChapters,
        timestamp: Date.now(),
      };

      // Evict oldest entry if cache exceeds bounded limit
      if (this.mangaCache.size >= MANGA_CACHE_MAX_ENTRIES) {
        const oldestKey = this.mangaCache.keys().next().value;
        if (oldestKey !== undefined) {
          this.mangaCache.delete(oldestKey);
        }
      }
      this.mangaCache.set(mangaId, bundle);
      return bundle;
    })();

    this.inflightMangaRequests.set(mangaId, requestPromise);
    try {
      return await requestPromise;
    } finally {
      this.inflightMangaRequests.delete(mangaId);
    }
  }

  /**
   * Retrieves manga or novel synopsis, metadata, tags, recommendations, and full chapter list
   * concurrently from Atsu.moe's manga or novel endpoints.
   */
  public async fetchMangaDetails(idOrUrl: string): Promise<MangaDetailsResult> {
    const mangaId = extractMangaId(idOrUrl);
    const [prefs, { detail, rawChapters }] = await Promise.all([
      getUserPreferences(),
      this.fetchMangaBundle(idOrUrl),
    ]);

    const isNovel =
      isNovelIdentifier(idOrUrl) ||
      isNovelSummary(detail) ||
      this.knownNovelIds.has(mangaId);
    if (isNovel) {
      this.knownNovelIds.add(mangaId);
    }

    const chapters = normalizeAndFilterChapters(
      mangaId,
      rawChapters,
      detail.scanlators,
      {
        deduplicate: prefs.deduplicateChapters,
        whitelist: prefs.scanlatorWhitelist,
      }
    );

    const title = (
      detail.englishTitle ||
      detail.title ||
      "Untitled Series"
    ).trim();
    const coverImage = resolveMangaCover(detail, prefs.imageFormat);
    const bannerImage = resolveBannerUrl(detail, prefs.imageFormat);

    const rawSynopsis = (detail.synopsis ?? "").trim();
    const summary =
      rawSynopsis.length > 0 ? rawSynopsis : DEFAULT_SYNOPSIS_FALLBACK;

    const additionalTitles: string[] = [];
    const seenTitles = new Set<string>([title.toLowerCase()]);
    const titleCandidates = [
      detail.title,
      detail.englishTitle,
      ...(detail.otherNames ?? []),
      ...(detail.acronyms ?? []),
    ];
    for (let i = 0, len = titleCandidates.length; i < len; i++) {
      const candidate = titleCandidates[i];
      if (typeof candidate === "string") {
        const clean = candidate.trim();
        const lower = clean.toLowerCase();
        if (clean && !seenTitles.has(lower)) {
          seenTitles.add(lower);
          additionalTitles.push(clean);
        }
      }
    }

    const genreTags = normalizeTagList(
      detail.genres,
      detail.genreIds,
      GENRE_LOOKUP
    );
    const themeTags = normalizeTagList(
      detail.tags,
      detail.tagIds,
      THEME_LOOKUP
    );

    const properties: TagSection[] = [];
    if (genreTags.length > 0) {
      properties.push({
        id: "genres",
        title: "Genres",
        tags: genreTags,
      });
    }
    if (themeTags.length > 0) {
      properties.push({
        id: "themes",
        title: "Themes & Tags",
        tags: themeTags,
      });
    }

    const credits = extractCredits(detail.authors);
    const links = extractExternalLinks(detail, mangaId, isNovel);

    const relatedItems: Item[] = [];
    const seenRelated = new Set<string>();
    const ctx = compileFilterContext(prefs, false);
    const appendRelated = (list?: AtsuMangaSummary[] | null) => {
      if (!Array.isArray(list)) return;
      for (let i = 0, len = list.length; i < len; i++) {
        const rec = list[i];
        if (!rec || !rec.id || seenRelated.has(rec.id)) continue;
        if (isMangaAllowedWithContext(rec, ctx, false)) {
          seenRelated.add(rec.id);
          relatedItems.push(mapSummaryToItem(rec, prefs.imageFormat));
        }
      }
    };
    appendRelated(detail.recommendations);
    appendRelated(detail.similarManga);

    const collections: ItemCollection[] = [];
    if (relatedItems.length > 0) {
      collections.push({
        id: "recommendations",
        title: "Recommendations & Similar Series",
        items: relatedItems,
      });
    }

    const rawScore = detail.mbRating ?? detail.avgRating;
    const numericScore =
      typeof rawScore === "number" && Number.isFinite(rawScore)
        ? Math.round(rawScore * 100) / 100
        : undefined;
    const rawViews = detail.views ?? detail.popularity;
    const numericViews =
      typeof rawViews === "number" && Number.isFinite(rawViews)
        ? rawViews
        : typeof rawViews === "string" && Number.isFinite(Number(rawViews))
          ? Number(rawViews)
          : undefined;

    const additionalDetails: Record<string, string> = {};
    let hasAdditionalDetails = false;
    if (isNovel) {
      additionalDetails["Format"] = "Novel";
      hasAdditionalDetails = true;
    } else if (detail.type) {
      additionalDetails["Format"] =
        detail.type === "Manwha"
          ? "Manhwa"
          : detail.type === "Other"
            ? "OTHER"
            : String(detail.type);
      hasAdditionalDetails = true;
    }
    if (detail.status) {
      additionalDetails["Status"] = String(detail.status);
      hasAdditionalDetails = true;
    }
    const releaseYear = detail.released ?? detail.releaseYear ?? detail.year;
    if (releaseYear) {
      additionalDetails["Released"] = String(releaseYear);
      hasAdditionalDetails = true;
    }
    if (Array.isArray(detail.scanlators) && detail.scanlators.length > 0) {
      const scanNames: string[] = [];
      for (let i = 0, len = detail.scanlators.length; i < len; i++) {
        const name = detail.scanlators[i]?.name?.trim();
        if (name) scanNames.push(name);
      }
      if (scanNames.length > 0) {
        additionalDetails["Scanlators"] = scanNames.join(", ");
        hasAdditionalDetails = true;
      }
    }

    const routeSegment = isNovel ? "novel" : "manga";
    const content: Content = {
      title,
      coverImage,
      ...(bannerImage ? { bannerImage } : {}),
      webUrl: `${BASE_URL}/${routeSegment}/${encodeURIComponent(mangaId)}`,
      rating: mapContentRating(detail),
      status: mapContentStatus(detail.status),
      contentType: isNovel
        ? ContentType.NOVEL
        : mapContentType(detail.type, detail.medium),
      readingMode: mapReadingMode(detail.type),
      summary,
      ...(numericScore !== undefined || numericViews !== undefined
        ? {
            statistics: {
              ...(numericScore !== undefined ? { rating: numericScore } : {}),
              ...(numericViews !== undefined ? { views: numericViews } : {}),
            },
          }
        : {}),
      ...(credits.length > 0 ? { credits } : {}),
      ...(additionalTitles.length > 0 ? { additionalTitles } : {}),
      ...(hasAdditionalDetails ? { additionalDetails } : {}),
      ...(genreTags.length > 0 ? { genres: genreTags } : {}),
      ...(properties.length > 0 ? { properties } : {}),
      ...(collections.length > 0 ? { collections } : {}),
      ...(links.length > 0 ? { links } : {}),
      ...(chapters.length > 0 ? { chapters } : {}),
    };

    return {
      content,
      chapters,
      raw: detail,
    };
  }

  /**
   * Retrieves the deduplicated/filtered chapter list concurrently using Promise.all,
   * automatically routing to novel or manga endpoints based on title medium/ID.
   */
  public async fetchChapters(idOrUrl: string): Promise<Chapter[]> {
    const mangaId = extractMangaId(idOrUrl);
    const preferNovel =
      isNovelIdentifier(idOrUrl) || this.knownNovelIds.has(mangaId);

    const cached = this.mangaCache.get(mangaId);
    if (cached && Date.now() - cached.timestamp < MANGA_CACHE_TTL_MS) {
      const prefs = await getUserPreferences();
      return normalizeAndFilterChapters(
        mangaId,
        cached.rawChapters,
        cached.detail.scanlators,
        {
          deduplicate: prefs.deduplicateChapters,
          whitelist: prefs.scanlatorWhitelist,
        }
      );
    }

    const [prefs, detail, initialChapters] = await Promise.all([
      getUserPreferences(),
      this.fetchPageDetailWithDualRoute(mangaId, preferNovel).catch((error) => {
        if (error instanceof CloudflareError) {
          throw error;
        }
        return undefined;
      }),
      preferNovel
        ? this.fetchRawNovelChapters(mangaId)
        : this.fetchRawChapters(mangaId),
    ]);

    const detectedNovel = preferNovel || isNovelSummary(detail);
    if (detectedNovel) {
      this.knownNovelIds.add(mangaId);
    }

    let rawChapters = initialChapters;
    if (rawChapters.length === 0 && detectedNovel && !preferNovel) {
      rawChapters = await this.fetchRawNovelChapters(
        mangaId,
        detail?.chapters
      );
    }

    const scanlators = detail?.scanlators;
    const effectiveChapters =
      rawChapters.length > 0
        ? rawChapters
        : Array.isArray(detail?.chapters)
          ? detail.chapters
          : [];

    if (detail?.id) {
      if (this.mangaCache.size >= MANGA_CACHE_MAX_ENTRIES) {
        const oldestKey = this.mangaCache.keys().next().value;
        if (oldestKey !== undefined) {
          this.mangaCache.delete(oldestKey);
        }
      }
      this.mangaCache.set(mangaId, {
        detail,
        rawChapters: effectiveChapters,
        timestamp: Date.now(),
      });
    }

    return normalizeAndFilterChapters(mangaId, effectiveChapters, scanlators, {
      deduplicate: prefs.deduplicateChapters,
      whitelist: prefs.scanlatorWhitelist,
    });
  }

  /**
   * Fetches and sanitizes a novel chapter's HTML text payload for Suwatte's native text reader.
   */
  public async fetchChapterText(
    contentId: string,
    chapterId: string
  ): Promise<SourceChapterText> {
    const cleanId = extractMangaId(contentId);
    const cleanChapterId = String(chapterId ?? "").trim();
    if (!cleanChapterId) {
      throw new Error("Chapter ID cannot be empty.");
    }

    const extractRawTextFromPayload = (
      payload?: AtsuReadChapterResponse | null
    ): { rawText: string; title?: string | null } | null => {
      if (!payload || typeof payload !== "object") {
        return null;
      }

      const chapterObj =
        payload.novelChapter ?? payload.readChapter ?? payload.chapter;
      const title = chapterObj?.title ?? undefined;

      const directCandidate =
        chapterObj?.content ??
        chapterObj?.text ??
        chapterObj?.body ??
        chapterObj?.html ??
        payload.content ??
        payload.text ??
        payload.body ??
        payload.html;

      if (typeof directCandidate === "string" && directCandidate.trim()) {
        return { rawText: directCandidate, title };
      }

      const paragraphs = chapterObj?.paragraphs ?? payload.paragraphs;
      if (Array.isArray(paragraphs) && paragraphs.length > 0) {
        const joined = paragraphs
          .map((p) => (typeof p === "string" ? p.trim() : ""))
          .filter(Boolean)
          .map((p) => (p.startsWith("<p") ? p : `<p>${p}</p>`))
          .join("\n");
        if (joined) {
          return { rawText: joined, title };
        }
      }

      const pages = chapterObj?.pages;
      if (Array.isArray(pages) && pages.length > 0) {
        const textChunks: string[] = [];
        for (let i = 0, len = pages.length; i < len; i++) {
          const page = pages[i];
          const chunk = page?.content ?? page?.text ?? page?.body;
          if (typeof chunk === "string" && chunk.trim()) {
            textChunks.push(chunk.trim());
          }
        }
        if (textChunks.length > 0) {
          return { rawText: textChunks.join("\n\n"), title };
        }
      }

      return null;
    };

    const endpoints = [
      {
        url: `${API_BASE}/novel/chapter`,
        params: {
          novelId: cleanId,
          mangaId: cleanId,
          chapterId: cleanChapterId,
          id: cleanChapterId,
        },
      },
      {
        url: `${API_BASE}/read/chapter`,
        params: {
          mangaId: cleanId,
          novelId: cleanId,
          chapterId: cleanChapterId,
        },
      },
    ];

    for (let i = 0, len = endpoints.length; i < len; i++) {
      const ep = endpoints[i]!;
      try {
        const response = await this.getJson<AtsuReadChapterResponse>(
          ep.url,
          ep.params
        );
        const extracted = extractRawTextFromPayload(response);
        if (extracted) {
          const sanitizedBody = sanitizeNovelHtml(
            extracted.rawText,
            extracted.title
          );
          return {
            format: SourceChapterTextFormat.HTML,
            body: sanitizedBody,
            resources: [],
          };
        }
      } catch (error) {
        if (error instanceof CloudflareError) {
          throw error;
        }
      }
    }

    throw new Error(
      `No chapter text returned for novel "${cleanId}" chapter "${cleanChapterId}".`
    );
  }

  /**
   * Retrieves ordered chapter page URLs from `/api/read/chapter?mangaId={id}&chapterId={chapterId}`.
   */
  public async fetchChapterPages(
    mangaId: string,
    chapterId: string
  ): Promise<ChapterPage[]> {
    const cleanMangaId = extractMangaId(mangaId);
    const cleanChapterId = String(chapterId ?? "").trim();
    if (!cleanChapterId) {
      throw new Error("Chapter ID cannot be empty.");
    }

    const [imageFormat, response] = await Promise.all([
      getImageFormatPreference(),
      this.getJson<AtsuReadChapterResponse>(`${API_BASE}/read/chapter`, {
        mangaId: cleanMangaId,
        chapterId: cleanChapterId,
      }),
    ]);

    const rawPages = response?.readChapter?.pages;
    if (!Array.isArray(rawPages) || rawPages.length === 0) {
      throw new Error(
        `No page images returned for manga "${cleanMangaId}" chapter "${cleanChapterId}".`
      );
    }

    const sortedPages = [...rawPages].sort(
      (a, b) => (a.number ?? 0) - (b.number ?? 0)
    );

    const result = new Array<AtsuChapterPage>(sortedPages.length);
    for (let i = 0, len = sortedPages.length; i < len; i++) {
      const page = sortedPages[i]!;
      const imageUrl = resolveImageUrl(
        page.image,
        imageFormat,
        FALLBACK_COVER_URL
      );

      result[i] = {
        url: imageUrl,
        headers: PAGE_IMAGE_HEADERS,
        context: {
          pageId: page.id,
          pageNumber: page.number,
          imageFormat,
          referer: REFERER_URL,
          origin: ORIGIN_URL,
        },
      };
    }

    return result;
  }

  /**
   * Attaches `Referer: https://atsu.moe/`, `Origin: https://atsu.moe`, and image quality
   * `Accept` headers to outgoing image requests using memoized image format preference.
   */
  public async configureImageRequest(
    request: NetworkRequest
  ): Promise<NetworkRequest> {
    const imageFormat = await getImageFormatPreference();
    const acceptHeader =
      imageFormat === "webp" ? WEBP_ACCEPT_HEADER : IMAGE_HEADERS.Accept;

    request.headers = {
      ...IMAGE_HEADERS,
      ...(request.headers ?? {}),
      Referer: REFERER_URL,
      Origin: ORIGIN_URL,
      Accept: acceptHeader,
    };
    return request;
  }
}

export { hasNsfwRating };
