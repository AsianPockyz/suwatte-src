import {
  type Chapter,
  type ChapterPage,
  type Content,
  ContentStatus,
  ContentType,
  type Credit,
  type Item,
  NetworkClientBuilder,
  type NetworkRequest,
  type NetworkResponse,
  type PagedItemList,
  ReadingMode,
  type Tag,
  type TagSection,
} from "@suwatte/toolchain";
import * as cheerio from "cheerio";
import {
  buildFeedUrl,
  buildPreferenceQueryFlags,
  buildSearchUrl,
  deriveBaseCdnUrl,
  isPlaceholderImageUrl,
  normalizeImageUrl,
} from "./api.js";
import {
  BADGE_COUNT_REGEX,
  BASE_URL,
  BG_IMAGE_URL_REGEX,
  BRACKET_TOKEN_REGEX,
  BROWSE_FEED_KEYS,
  CLOUDFLARE_RESOLUTION_URL,
  COMMA_SEMICOLON_REGEX,
  ContentRating,
  DEFAULT_HEADERS,
  DEFAULT_IMAGE_EXT,
  DEFAULT_LANGUAGE,
  DEFAULT_SERVER_ID,
  EXTENSION_CODE_MAP,
  EXT_REGEX,
  FALLBACK_COVER_URL,
  FLAG_JA_REGEX,
  FLAG_JP_REGEX,
  GALLERY_PATH_REGEX,
  GALLERY_URL_REGEX,
  G_TH_FALLBACK_ENTRY_REGEX,
  G_TH_OBJECT_REGEX,
  G_TH_PARSE_JSON_REGEX,
  G_TH_STRING_REGEX,
  HOME_SECTION_KEYS,
  INLINE_GALLERY_ID_REGEX,
  INLINE_LOAD_DIR_REGEX,
  INLINE_LOAD_ID_REGEX,
  INLINE_LOAD_PAGES_REGEX,
  NUMERIC_ONLY_REGEX,
  PAGE_IMAGE_HEADERS,
  PAGES_TEXT_REGEX,
  RATE_LIMIT_PER_SECOND,
  SERVER_FROM_URL_REGEX,
  SERVER_PREFIX_REGEX,
  THUMB_PAGENUM_EXT_REGEX,
  TRIM_SLASHES_REGEX,
  VIEW_PATH_REGEX,
  WHITESPACE_REGEX,
} from "./constants.js";
import {
  decodeHtmlEntities,
  formatGalleryTitleDisplay,
  getUserPreferences,
  normalizeCategoryToken,
  normalizeLanguageToken,
} from "./preferences.js";
import type {
  ImHentaiChapterPage,
  ImHentaiContent,
  ImHentaiExploreParams,
  ImHentaiGalleryCard,
  ImHentaiGalleryDetail,
  ImHentaiPageResolutionMeta,
  ImHentaiUserPreferences,
} from "./types.js";

const GALLERY_CACHE_TTL_MS = 30_000;
const GALLERY_CACHE_MAX_ENTRIES = 25;

interface CachedGalleryEntry {
  readonly timestamp: number;
  readonly detail: ImHentaiGalleryDetail;
}

function isCloudflareChallenge(response: NetworkResponse): boolean {
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

export { normalizeImageUrl } from "./api.js";

/**
 * Extracts a numeric or slug gallery ID from a URL or raw ID string.
 */
export function extractGalleryId(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";

  const urlMatch = GALLERY_URL_REGEX.exec(trimmed);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  const pathMatch = GALLERY_PATH_REGEX.exec(trimmed);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const viewMatch = VIEW_PATH_REGEX.exec(trimmed);
  if (viewMatch?.[1]) {
    return viewMatch[1];
  }

  const clean = trimmed.replace(TRIM_SLASHES_REGEX, "");
  if (NUMERIC_ONLY_REGEX.test(clean)) {
    return clean;
  }

  return clean;
}

/**
 * Detects the base image extension (.jpg, .webp, .png, .gif) from a URL or filename.
 */
export function detectExtensionFromUrl(url: string | undefined | null): string {
  if (!url) return DEFAULT_IMAGE_EXT;
  const clean = url.split("?")[0]?.split("#")[0]?.trim().toLowerCase() ?? "";
  const extMatch = EXT_REGEX.exec(clean);
  if (extMatch?.[1]) {
    const mapped = EXTENSION_CODE_MAP[extMatch[1].toLowerCase()];
    if (mapped) {
      return mapped;
    }
  }
  return DEFAULT_IMAGE_EXT;
}

/**
 * Resolves a single extension token (e.g. "j,1280,1800", "w", "png", ".webp") to its file extension.
 */
export function resolveExtensionToken(
  rawToken: unknown,
  fallbackExt = DEFAULT_IMAGE_EXT
): string {
  if (typeof rawToken !== "string" || !rawToken.trim()) {
    return fallbackExt;
  }
  const firstPart =
    rawToken
      .split(",")[0]
      ?.trim()
      .toLowerCase()
      .replace(/^\./, "") ?? "";
  if (!firstPart) {
    return fallbackExt;
  }
  return EXTENSION_CODE_MAP[firstPart] ?? fallbackExt;
}

/**
 * Strictly sanitizes an image extension so that it never resolves to undefined, null, or invalid strings.
 */
export function sanitizeImageExtension(ext: unknown): string {
  if (typeof ext !== "string") return DEFAULT_IMAGE_EXT;
  const clean = ext.trim().toLowerCase().replace(/^\./, "");
  if (!clean || clean === "undefined" || clean === "null") {
    return DEFAULT_IMAGE_EXT;
  }
  return EXTENSION_CODE_MAP[clean] ?? clean;
}

/**
 * Parses the inline `g_th` extension map JSON from gallery/reader HTML if present.
 * Uses pre-compiled regular expressions and safe JSON parsing, smoothly falling back
 * to empty extension map on missing or malformed inputs without throwing.
 */
export function parseExtensionMapFromHtml(
  html: string,
  $?: cheerio.CheerioAPI
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!html) return map;

  let rawJson: string | undefined;

  if ($) {
    const inputVal = $("#g_th").val()?.trim();
    if (inputVal && inputVal.startsWith("{")) {
      rawJson = inputVal;
    }
  }

  if (!rawJson) {
    // Pattern 1: g_th = $.parseJSON('{"1":"j,1280,1800",...}') or JSON.parse('...')
    const parseJsonMatch = G_TH_PARSE_JSON_REGEX.exec(html);
    if (parseJsonMatch?.[2]) {
      rawJson = parseJsonMatch[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
    }
  }

  if (!rawJson) {
    // Pattern 2: var g_th = '{"1":"j,..."}'
    const stringMatch = G_TH_STRING_REGEX.exec(html);
    if (stringMatch?.[2]) {
      rawJson = stringMatch[2];
    }
  }

  if (!rawJson) {
    // Pattern 3: var g_th = {"1":"j,1280,1800", ...};
    const objMatch = G_TH_OBJECT_REGEX.exec(html);
    if (objMatch?.[1]) {
      rawJson = objMatch[1];
    }
  }

  if (!rawJson) {
    return map;
  }

  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      for (const [pageKey, val] of Object.entries(
        parsed as Record<string, unknown>
      )) {
        map[pageKey] = resolveExtensionToken(val, DEFAULT_IMAGE_EXT);
      }
      return map;
    }
  } catch {
    // Fallback regex extraction if JSON has unquoted keys or single quotes
  }

  // Fallback regex matching
  const entryRegex = new RegExp(G_TH_FALLBACK_ENTRY_REGEX.source, "g");
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(rawJson)) !== null) {
    if (m[1] && m[2]) {
      map[m[1]] = resolveExtensionToken(m[2], DEFAULT_IMAGE_EXT);
    }
  }

  return map;
}

/**
 * Cleans a tag anchor's text by stripping child badge counts and optional namespace prefixes.
 */
function extractCleanTagText(
  $: cheerio.CheerioAPI,
  el: cheerio.CheerioElement
): { namespace?: string; name: string } {
  const $clone = $(el).clone();
  $clone.find(".badge, .count, span.badge, span.count").remove();
  let raw = decodeHtmlEntities($clone.text());

  // Strip trailing parenthesized badge counts
  raw = raw.replace(BADGE_COUNT_REGEX, "").trim();

  let namespace: string | undefined;
  const href = ($(el).attr("href") ?? "").trim().toLowerCase();
  if (href.includes("/artist/")) namespace = "artist";
  else if (href.includes("/group/")) namespace = "group";
  else if (href.includes("/parody/")) namespace = "parody";
  else if (href.includes("/character/")) namespace = "character";
  else if (href.includes("/category/")) namespace = "category";
  else if (href.includes("/language/")) namespace = "language";
  else if (href.includes("/tag/")) namespace = "tag";

  const colonIdx = raw.indexOf(":");
  if (colonIdx > 0) {
    const prefix = raw.slice(0, colonIdx).trim().toLowerCase();
    if (
      prefix === "artist" ||
      prefix === "artists" ||
      prefix === "group" ||
      prefix === "groups" ||
      prefix === "circle" ||
      prefix === "parody" ||
      prefix === "parodies" ||
      prefix === "character" ||
      prefix === "characters" ||
      prefix === "category" ||
      prefix === "categories" ||
      prefix === "language" ||
      prefix === "languages" ||
      prefix === "tag" ||
      prefix === "tags"
    ) {
      namespace = prefix.replace(/ies$/, "y").replace(/s$/, "");
      if (namespace === "circle") namespace = "group";
      raw = raw.slice(colonIdx + 1).trim();
    }
  }

  return { namespace, name: raw };
}

/**
 * Extracts bracketed tokens from a gallery title (e.g. "[English]", "[NTR]") for supplementary tag matching.
 */
function extractTitleBracketTokens(title: string): string[] {
  const tokens: string[] = [];
  const regex = new RegExp(BRACKET_TOKEN_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(title)) !== null) {
    const inner = (match[1] ?? match[2] ?? "").trim().toLowerCase();
    if (inner) {
      tokens.push(inner);
    }
  }
  return tokens;
}

/**
 * Extracts a live CDN image URL from an element, prioritizing lazy-load attributes
 * and guarding against placeholder GIFs (blank.gif, pixel.gif, etc.).
 */
export function extractImageSrcFromElement(
  $img: cheerio.Cheerio
): string | undefined {
  if (!$img || $img.length === 0) return undefined;

  const candidates = [
    $img.attr("data-src"),
    $img.attr("data-lazy-src"),
    $img.attr("data-original"),
    $img.attr("data-full"),
    $img.attr("src"),
  ];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (candidate && typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed && !isPlaceholderImageUrl(trimmed)) {
        return normalizeImageUrl(trimmed);
      }
    }
  }

  const style = $img.attr("style");
  if (style) {
    const bgMatch = BG_IMAGE_URL_REGEX.exec(style);
    if (bgMatch?.[1]) {
      const bgUrl = bgMatch[1].trim();
      if (!isPlaceholderImageUrl(bgUrl)) {
        return normalizeImageUrl(bgUrl);
      }
    }
  }

  return undefined;
}

// ============================================================================
// 2.1 Thumbnail & Gallery Card Parsing (.thumb)
// ============================================================================

/**
 * Centralized, reusable parser extracting a single gallery card from a Cheerio `.thumb` element.
 * Scopes all DOM queries strictly within `$thumb` to minimize selector overhead.
 */
export function extractGalleryCardFromElement(
  $thumb: cheerio.Cheerio,
  $: cheerio.CheerioAPI
): ImHentaiGalleryCard | null {
  // 1. Extract ID from gallery links (/gallery/{id}/)
  const galleryHref =
    $thumb.find(".caption a").attr("href") ??
    $thumb.find(".inner_thumb a").attr("href") ??
    $thumb.find('a[href*="/gallery/"]').attr("href") ??
    "";
  const id =
    extractGalleryId(galleryHref) || ($thumb.attr("data-id") ?? "").trim();
  if (!id) {
    return null;
  }

  // 2. Extract Title with HTML entity decoding
  const $captionLink = $thumb.find(".caption a").first();
  const rawTitle = decodeHtmlEntities(
    $captionLink.text() ||
      $thumb.find(".caption").text() ||
      $thumb.find("img").attr("alt") ||
      `Gallery #${id}`
  );

  const rawSubtitle =
    $thumb.find(".subtitle").text() ||
    $thumb.attr("data-jtitle") ||
    $thumb.attr("data-subtitle") ||
    "";
  const japaneseTitle = rawSubtitle ? decodeHtmlEntities(rawSubtitle) : undefined;

  // 3. Extract Thumbnail URL prioritizing data-src over placeholders
  const $lazyImg = $thumb.find("img.lazy").first();
  const $anyImg = $lazyImg.length > 0 ? $lazyImg : $thumb.find("img").first();
  const extractedThumb = extractImageSrcFromElement($anyImg);
  const thumbnailUrl = extractedThumb || FALLBACK_COVER_URL;
  const baseUrl = deriveBaseCdnUrl(thumbnailUrl);

  // 4. Extract Category badges and Language tags
  let categoryBadge =
    $thumb
      .find(".thumb_cat, .cat, .category, a[href*='/category/']")
      .first()
      .text()
      .trim() ||
    $thumb.attr("data-category")?.trim() ||
    undefined;

  let languageBadge =
    $thumb
      .find(".lang, .language, .languages, a[href*='/language/']")
      .first()
      .text()
      .trim() ||
    $thumb.attr("data-language")?.trim() ||
    $thumb.attr("data-lang")?.trim() ||
    undefined;

  if (!languageBadge) {
    const flagClass = ($thumb.find("[class*='flag']").attr("class") ?? "").toLowerCase();
    if (flagClass.includes("en") || flagClass.includes("us") || flagClass.includes("gb")) {
      languageBadge = "English";
    } else if (flagClass.includes("jp") || flagClass.includes("ja")) {
      languageBadge = "Japanese";
    } else if (flagClass.includes("zh") || flagClass.includes("cn")) {
      languageBadge = "Chinese";
    } else if (flagClass.includes("es")) {
      languageBadge = "Spanish";
    } else if (flagClass.includes("fr")) {
      languageBadge = "French";
    } else if (flagClass.includes("de")) {
      languageBadge = "German";
    } else if (flagClass.includes("ru")) {
      languageBadge = "Russian";
    }
  }

  // Collect tags from data-tags, inline .tag links, and bracketed title tokens
  const tagSet = new Set<string>();
  const dataTags = $thumb.attr("data-tags");
  if (dataTags) {
    const parts = dataTags.split(COMMA_SEMICOLON_REGEX);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]?.trim().toLowerCase();
      if (p) tagSet.add(p);
    }
  }

  $thumb.find(".tag, .tags a, a[href*='/tag/']").each((_i, tagEl) => {
    const { name } = extractCleanTagText($, tagEl);
    if (name) {
      tagSet.add(name.toLowerCase());
    }
  });

  const bracketTokens = extractTitleBracketTokens(rawTitle);
  for (let i = 0; i < bracketTokens.length; i++) {
    const tok = bracketTokens[i];
    if (tok) {
      tagSet.add(tok);
      if (!languageBadge) {
        if (tok === "english" || tok === "eng") languageBadge = "English";
        else if (
          tok === "japanese" ||
          tok === "jp" ||
          tok === "ja" ||
          tok === "raw" ||
          tok === "untranslated"
        )
          languageBadge = "Japanese";
        else if (tok === "chinese" || tok === "chi" || tok === "zh")
          languageBadge = "Chinese";
        else if (tok === "spanish" || tok === "es") languageBadge = "Spanish";
        else if (tok === "french" || tok === "fr") languageBadge = "French";
        else if (tok === "german" || tok === "de") languageBadge = "German";
        else if (tok === "russian" || tok === "ru") languageBadge = "Russian";
      }
      if (!categoryBadge) {
        const normCat = normalizeCategoryToken(tok);
        if (normCat) {
          categoryBadge = tok;
        }
      }
    }
  }

  if (categoryBadge) {
    tagSet.add(categoryBadge.toLowerCase());
  }
  if (languageBadge) {
    tagSet.add(languageBadge.toLowerCase());
  }

  let serverId: string | undefined;
  let loadDir: string | undefined;
  const serverMatch = SERVER_FROM_URL_REGEX.exec(thumbnailUrl);
  if (serverMatch) {
    serverId = serverMatch[1];
    loadDir = serverMatch[2];
  }

  const subtitleParts: string[] = [];
  if (categoryBadge) subtitleParts.push(categoryBadge);
  if (languageBadge) subtitleParts.push(languageBadge);

  // Client-Side Japanese Raw Marker Detection (.thumb level)
  const titleLower = rawTitle.toLowerCase();
  const isJpTitle =
    titleLower.includes("[japanese]") ||
    titleLower.includes("(japanese)") ||
    titleLower.includes("[jp]");

  const hasJapaneseClass =
    $thumb.hasClass("japanese") ||
    $thumb.find(".japanese").length > 0 ||
    Boolean($thumb.find("[class*='japanese']").length);

  const flagClass = (
    $thumb.find("[class*='flag']").attr("class") ?? ""
  ).toLowerCase();
  const hasJpFlag =
    flagClass.includes("flag-jp") ||
    flagClass.includes("flag_jp") ||
    flagClass.includes("flag-ja") ||
    flagClass.includes("flag_ja") ||
    FLAG_JP_REGEX.test(flagClass) ||
    FLAG_JA_REGEX.test(flagClass);

  const isJpBadge =
    languageBadge?.toLowerCase() === "japanese" ||
    languageBadge?.toLowerCase() === "jp" ||
    languageBadge?.toLowerCase() === "ja";

  const isJapaneseRaw = isJpTitle || hasJapaneseClass || hasJpFlag || isJpBadge;

  return {
    id,
    title: rawTitle,
    subtitle:
      subtitleParts.length > 0 ? subtitleParts.join(" • ") : undefined,
    japaneseTitle,
    thumbnailUrl,
    webUrl: `${BASE_URL}/gallery/${id}/`,
    category: categoryBadge,
    language: languageBadge,
    tags: Array.from(tagSet),
    serverId,
    loadDir,
    baseUrl,
    baseImageUrl: baseUrl,
    isJapaneseRaw,
  };
}

/**
 * Universal gallery card extractor supporting either an HTML string or an already-loaded Cheerio root.
 * Guarantees Cheerio is only loaded once per network response.
 */
export function parseGalleryCards(
  htmlOrCheerio: string | cheerio.CheerioAPI,
  $container?: cheerio.Cheerio
): ImHentaiGalleryCard[] {
  if (!htmlOrCheerio) {
    return [];
  }

  const $ =
    typeof htmlOrCheerio === "function"
      ? htmlOrCheerio
      : cheerio.load(htmlOrCheerio);

  const cards: ImHentaiGalleryCard[] = [];
  const seenIds = new Set<string>();

  const $thumbs = $container ? $container.find(".thumb") : $(".thumb");

  $thumbs.each((_idx, el) => {
    const $thumb = $(el);
    const card = extractGalleryCardFromElement($thumb, $);
    if (card && !seenIds.has(card.id)) {
      seenIds.add(card.id);
      cards.push(card);
    }
  });

  return cards;
}

/**
 * Maps parsed gallery cards to Suwatte Item objects applying universal Layer 2 post-filtering:
 * 1. Client-side language safety guard dropping Japanese raw entries when English is preferred.
 * 2. Title preference formatting with HTML entity decoding.
 */
export function filterAndMapGalleryCards(
  cards: readonly ImHentaiGalleryCard[],
  prefs: ImHentaiUserPreferences,
  options?: {
    overrideCategories?: ReadonlySet<string>;
    overrideLanguage?: string;
    extraExcludedTags?: readonly string[];
    requiredIncludedTags?: readonly string[];
  }
): Item[] {
  const items: Item[] = [];
  const activeLang =
    options?.overrideLanguage ?? prefs.language ?? DEFAULT_LANGUAGE;
  const normLang = normalizeLanguageToken(activeLang);
  const isEnglishPreferred = normLang === "en";

  for (let i = 0, len = cards.length; i < len; i++) {
    const card = cards[i];
    if (!card) continue;

    // Client-Side Language Safety Guard:
    // If the user has "English" selected, check the title and language badge of parsed thumbnail cards (.thumb).
    // Drop any entry explicitly identified as Japanese raw ([Japanese], .japanese, or jp flag) when English is preferred.
    if (isEnglishPreferred) {
      if (card.isJapaneseRaw) {
        continue;
      }
      const titleLower = (card.title ?? "").toLowerCase();
      if (
        titleLower.includes("[japanese]") ||
        titleLower.includes("(japanese)") ||
        titleLower.includes("[jp]")
      ) {
        continue;
      }
      const langLower = (card.language ?? "").toLowerCase();
      if (
        langLower === "japanese" ||
        langLower === "jp" ||
        langLower === "ja"
      ) {
        continue;
      }
      if (
        card.tags.includes("japanese") &&
        (card.tags.includes("raw") || card.tags.includes("untranslated"))
      ) {
        continue;
      }
    }

    const display = formatGalleryTitleDisplay(
      card.title,
      card.japaneseTitle,
      prefs
    );

    items.push({
      id: card.id,
      title: display.title,
      subtitle: display.subtitle ?? card.subtitle,
      coverImage: card.thumbnailUrl,
      webUrl: card.webUrl,
      rating: ContentRating.ADULT,
    });
  }

  return items;
}

/**
 * Backward-compatible wrapper mapping parsed gallery cards to Suwatte Item objects.
 */
export function mapCardsToItems(
  cards: readonly ImHentaiGalleryCard[],
  prefs: ImHentaiUserPreferences,
  extraExcludedTags?: readonly string[],
  requiredIncludedTags?: readonly string[],
  overrideCategories?: ReadonlySet<string>,
  overrideLanguage?: string
): Item[] {
  return filterAndMapGalleryCards(cards, prefs, {
    extraExcludedTags,
    requiredIncludedTags,
    overrideCategories,
    overrideLanguage,
  });
}

// ============================================================================
// 2.3 Zero-Latency 1-Pass Chapter & Page Resolution
// ============================================================================

export function extractPageResolutionMeta(
  html: string,
  fallbackId = "1",
  $loaded?: cheerio.CheerioAPI
): ImHentaiPageResolutionMeta {
  const $ = $loaded ?? cheerio.load(html);

  // 1. Cover / thumbnail URL for fallback server_id, load_dir, and base extension
  const $coverImg = $("#cover img, .left_cover img, .thumb img").first();
  const rawCoverUrl = extractImageSrcFromElement($coverImg);
  const coverUrl = rawCoverUrl ? normalizeImageUrl(rawCoverUrl) : "";

  // Check first preview thumbnail in thumbnail container
  const $firstThumbImg = $(
    "#thumbnail-container img, .gthumb img, .thumbs img, .g_thumb img"
  ).first();
  const rawFirstThumbUrl = extractImageSrcFromElement($firstThumbImg);

  // Derive Base CDN directory URL as used by gallery-dl
  let baseUrl: string | undefined =
    deriveBaseCdnUrl(rawCoverUrl) || deriveBaseCdnUrl(rawFirstThumbUrl);

  const urlPartsMatch = SERVER_FROM_URL_REGEX.exec(
    coverUrl || rawFirstThumbUrl || ""
  );
  const serverPrefixMatch = SERVER_PREFIX_REGEX.exec(
    coverUrl || rawFirstThumbUrl || html
  );

  // 2. Gallery ID: $('#gallery_id').val() or inline regex
  const domGalleryId = ($("#gallery_id").val() ?? "").trim();
  const inlineGalleryIdMatch = INLINE_GALLERY_ID_REGEX.exec(html);
  const galleryId =
    domGalleryId ||
    inlineGalleryIdMatch?.[1] ||
    urlPartsMatch?.[3] ||
    extractGalleryId(fallbackId) ||
    "1";

  // 3. Directory Hash: $('#load_dir').val() or inline regex
  const domLoadDir = ($("#load_dir").val() ?? "").trim();
  const inlineLoadDirMatch = INLINE_LOAD_DIR_REGEX.exec(html);
  const loadDir =
    domLoadDir ||
    inlineLoadDirMatch?.[1]?.trim() ||
    urlPartsMatch?.[2] ||
    "001";

  // 4. Image Server ID: $('#load_id').val() or parsed from thumbnail server prefix
  const domLoadId = (
    $("#load_id").val() ?? $("#load_server").val() ?? ""
  ).trim();
  const inlineLoadIdMatch = INLINE_LOAD_ID_REGEX.exec(html);
  let rawServerId =
    domLoadId ||
    inlineLoadIdMatch?.[1]?.trim() ||
    urlPartsMatch?.[1] ||
    serverPrefixMatch?.[1] ||
    DEFAULT_SERVER_ID;

  if (/^m\d+$/i.test(rawServerId)) {
    rawServerId = rawServerId.slice(1);
  }
  const serverId = rawServerId || DEFAULT_SERVER_ID;

  // Fallback baseUrl if not derived from cover/thumbnail
  if (!baseUrl) {
    const cleanServer = serverId.replace(/^m/i, "") || DEFAULT_SERVER_ID;
    const cleanDir = loadDir.replace(TRIM_SLASHES_REGEX, "");
    baseUrl = `https://m${cleanServer}.imhentai.xxx/${cleanDir}/`;
  }
  // Sanitize baseUrl: strip query strings or hash fragments, guarantee trailing slash
  const cleanBaseUrl = baseUrl.split("?")[0]?.split("#")[0] ?? baseUrl;
  baseUrl = cleanBaseUrl.endsWith("/") ? cleanBaseUrl : `${cleanBaseUrl}/`;

  // 5. Extension Map: Parse JSON string from g_th if present, or detect base image extension
  const extensionMap = parseExtensionMapFromHtml(html, $);

  // Supplement extensionMap by scanning any thumbnail elements (e.g. 1t.jpg, 2t.png) in the DOM
  $("img[data-src*='t.'], img[src*='t.']").each((_i, imgEl) => {
    const src = $(imgEl).attr("data-src") || $(imgEl).attr("src") || "";
    const m = THUMB_PAGENUM_EXT_REGEX.exec(src);
    if (m && m[1] && m[2]) {
      const pNum = m[1];
      const ext = sanitizeImageExtension(m[2]);
      if (!extensionMap[pNum]) {
        extensionMap[pNum] = ext;
      }
    }
  });

  const defaultExt = sanitizeImageExtension(detectExtensionFromUrl(coverUrl));

  // 6. Total Pages: parseInt($('#load_pages').val()) or metadata list item "Pages:" or g_th keys
  const domPagesVal = ($("#load_pages").val() ?? "").trim();
  let totalPages = parseInt(domPagesVal, 10);

  if (Number.isNaN(totalPages) || totalPages <= 0) {
    const inlinePagesMatch = INLINE_LOAD_PAGES_REGEX.exec(html);
    if (inlinePagesMatch?.[1]) {
      totalPages = parseInt(inlinePagesMatch[1], 10);
    }
  }

  if (Number.isNaN(totalPages) || totalPages <= 0) {
    const pagesTextMatch = PAGES_TEXT_REGEX.exec($.text());
    if (pagesTextMatch?.[1]) {
      totalPages = parseInt(pagesTextMatch[1], 10);
    }
  }

  if (Number.isNaN(totalPages) || totalPages <= 0) {
    const extKeysCount = Object.keys(extensionMap).length;
    totalPages = extKeysCount > 0 ? extKeysCount : 1;
  }

  return {
    galleryId,
    loadDir,
    serverId,
    totalPages,
    extensionMap,
    defaultExt,
    baseUrl,
  };
}

/**
 * Constructs the entire array of page image URLs in memory using gallery-dl's Base CDN URL pattern:
 * ${baseUrl}${page_number}.${ext}
 * with attached Referer: "https://imhentai.xxx/" header (no Origin header).
 * Smoothly falls back to default .jpg sequentially for all pages if g_th JSON extraction failed.
 */
export function buildChapterPagesFromMeta(
  meta: ImHentaiPageResolutionMeta
): ImHentaiChapterPage[] {
  const count = Math.max(1, meta.totalPages || 1);
  const pages: ImHentaiChapterPage[] = new Array(count);
  const { extensionMap, defaultExt, baseUrl } = meta;
  const safeDefaultExt = sanitizeImageExtension(defaultExt || DEFAULT_IMAGE_EXT);

  // Determine base CDN directory URL (ensuring trailing slash)
  let baseCdn = baseUrl?.split("?")[0]?.split("#")[0] ?? baseUrl;
  if (!baseCdn || !baseCdn.startsWith("http")) {
    const cleanServer =
      (meta.serverId || DEFAULT_SERVER_ID).replace(/^m/i, "") ||
      DEFAULT_SERVER_ID;
    const cleanDir = (meta.loadDir || "001").replace(TRIM_SLASHES_REGEX, "");
    baseCdn = `https://m${cleanServer}.imhentai.xxx/${cleanDir}/`;
  }
  if (!baseCdn.endsWith("/")) {
    baseCdn += "/";
  }

  for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
    const rawExt = extensionMap[String(pageNumber)] ?? safeDefaultExt;
    const cleanExt = sanitizeImageExtension(rawExt);
    const url = `${baseCdn}${pageNumber}.${cleanExt}`;
    pages[pageNumber - 1] = {
      url,
      headers: PAGE_IMAGE_HEADERS,
    };
  }

  return pages;
}

export function parseChapterPagesFromHtml(
  html: string,
  fallbackId = "1"
): ImHentaiChapterPage[] {
  const meta = extractPageResolutionMeta(html, fallbackId);
  return buildChapterPagesFromMeta(meta);
}

// ============================================================================
// 2.2 Gallery Detail Parsing (/gallery/{id}/)
// ============================================================================

export function parseGalleryDetail(
  html: string,
  fallbackId = "1"
): ImHentaiGalleryDetail {
  // Load Cheerio ONCE for the entire gallery detail response
  const $ = cheerio.load(html);
  const pageMeta = extractPageResolutionMeta(html, fallbackId, $);
  const id = pageMeta.galleryId || extractGalleryId(fallbackId) || "1";

  // Primary Title: .right_details h1
  const primaryTitle = decodeHtmlEntities(
    $(".right_details h1").first().text() ||
      $("h1").first().text() ||
      `Gallery #${id}`
  );

  // Alternative Titles: .right_details .subtitle
  const subtitleRaw =
    $(".right_details .subtitle").first().text() ||
    $(".subtitle").first().text() ||
    "";
  const subtitleText = subtitleRaw ? decodeHtmlEntities(subtitleRaw) : "";
  const additionalTitles = subtitleText.length > 0 ? [subtitleText] : [];

  // Cover Image: #cover img (handle lazy load attributes)
  const $coverImg = $("#cover img, .left_cover img").first();
  const rawCover = extractImageSrcFromElement($coverImg);
  const coverImage = rawCover || FALLBACK_COVER_URL;

  // Attributes & Tag Taxonomies
  const artists: string[] = [];
  const groups: string[] = [];
  const parodies: string[] = [];
  const characters: string[] = [];
  const categories: string[] = [];
  const languages: string[] = [];
  const tags: string[] = [];

  const addUnique = (arr: string[], val: string) => {
    const clean = val.trim();
    if (clean && !arr.includes(clean)) {
      arr.push(clean);
    }
  };

  let totalPages = pageMeta.totalPages;

  // Parse metadata list items (ul.galleries_info li or .right_details li)
  $(".right_details li, ul.galleries_info li, .galleries_info li").each(
    (_idx, liEl) => {
      const $li = $(liEl);
      const fullText = $li.text().replace(WHITESPACE_REGEX, " ").trim();

      if (PAGES_TEXT_REGEX.test(fullText)) {
        const m = PAGES_TEXT_REGEX.exec(fullText);
        if (m?.[1]) {
          const parsedPages = parseInt(m[1], 10);
          if (!Number.isNaN(parsedPages) && parsedPages > 0) {
            totalPages = parsedPages;
          }
        }
      }

      const labelText = $li
        .find(".tags_text, span:first-child")
        .first()
        .text()
        .trim()
        .toLowerCase();

      let rowNamespace: string | undefined;
      if (labelText.startsWith("artist") || /^artists?\s*:/i.test(fullText)) {
        rowNamespace = "artist";
      } else if (
        labelText.startsWith("group") ||
        labelText.startsWith("circle") ||
        /^(?:groups?|circles?)\s*:/i.test(fullText)
      ) {
        rowNamespace = "group";
      } else if (
        labelText.startsWith("parod") ||
        /^parod(?:y|ies)\s*:/i.test(fullText)
      ) {
        rowNamespace = "parody";
      } else if (
        labelText.startsWith("character") ||
        /^characters?\s*:/i.test(fullText)
      ) {
        rowNamespace = "character";
      } else if (
        labelText.startsWith("categor") ||
        /^categor(?:y|ies)\s*:/i.test(fullText)
      ) {
        rowNamespace = "category";
      } else if (
        labelText.startsWith("language") ||
        /^languages?\s*:/i.test(fullText)
      ) {
        rowNamespace = "language";
      } else if (labelText.startsWith("tag") || /^tags?\s*:/i.test(fullText)) {
        rowNamespace = "tag";
      }

      $li.find("a").each((_aIdx, aEl) => {
        const extracted = extractCleanTagText($, aEl);
        const ns = extracted.namespace ?? rowNamespace ?? "tag";
        const name = extracted.name;
        if (!name) return;

        switch (ns) {
          case "artist":
            addUnique(artists, name);
            break;
          case "group":
            addUnique(groups, name);
            break;
          case "parody":
            addUnique(parodies, name);
            break;
          case "character":
            addUnique(characters, name);
            break;
          case "category":
            addUnique(categories, name);
            break;
          case "language":
            addUnique(languages, name);
            break;
          default:
            addUnique(tags, name);
            break;
        }
      });
    }
  );

  // Scan any standalone taxonomy links inside .right_details
  $(
    '.right_details a.tag, .right_details a[href*="/artist/"], .right_details a[href*="/group/"], .right_details a[href*="/parody/"], .right_details a[href*="/character/"], .right_details a[href*="/category/"], .right_details a[href*="/language/"], .right_details a[href*="/tag/"]'
  ).each((_idx, aEl) => {
    const extracted = extractCleanTagText($, aEl);
    if (!extracted.name) return;
    switch (extracted.namespace) {
      case "artist":
        addUnique(artists, extracted.name);
        break;
      case "group":
        addUnique(groups, extracted.name);
        break;
      case "parody":
        addUnique(parodies, extracted.name);
        break;
      case "character":
        addUnique(characters, extracted.name);
        break;
      case "category":
        addUnique(categories, extracted.name);
        break;
      case "language":
        addUnique(languages, extracted.name);
        break;
      default:
        addUnique(tags, extracted.name);
        break;
    }
  });

  // Parse related gallery cards using the SAME loaded Cheerio instance (0 redundant cheerio.load calls)
  const relatedCards = parseRelatedGalleryCards($, $);
  const relatedItems: Item[] = relatedCards.map((card) => ({
    id: card.id,
    title: card.title,
    subtitle: card.subtitle,
    coverImage: card.thumbnailUrl,
    webUrl: card.webUrl,
    rating: ContentRating.ADULT,
  }));

  return {
    ...pageMeta,
    totalPages,
    id,
    title: primaryTitle,
    japaneseTitle: subtitleText || undefined,
    additionalTitles,
    coverImage,
    webUrl: `${BASE_URL}/gallery/${id}/`,
    artists,
    groups,
    parodies,
    characters,
    categories,
    languages,
    tags,
    relatedItems: relatedItems.length > 0 ? relatedItems : undefined,
  };
}

/**
 * Parses related/similar gallery recommendation cards from an IMHentai gallery page.
 * Reuses an existing loaded Cheerio root if available.
 */
export function parseRelatedGalleryCards(
  htmlOrCheerio: string | cheerio.CheerioAPI,
  $loaded?: cheerio.CheerioAPI
): ImHentaiGalleryCard[] {
  if (!htmlOrCheerio) {
    return [];
  }
  const $ =
    $loaded ??
    (typeof htmlOrCheerio === "function"
      ? htmlOrCheerio
      : cheerio.load(htmlOrCheerio));

  const $container = $(
    ".related_galleries, #related, #related_galleries, .similar_galleries, #similar"
  );
  if ($container.length === 0) {
    return [];
  }

  return parseGalleryCards($, $container);
}

/**
 * Maps a parsed ImHentaiGalleryDetail into a Suwatte Content object.
 */
export function mapDetailToContent(
  detail: ImHentaiGalleryDetail,
  prefs: ImHentaiUserPreferences
): ImHentaiContent {
  const display = formatGalleryTitleDisplay(
    detail.title,
    detail.japaneseTitle,
    prefs
  );

  const credits: Credit[] = detail.artists.map((artist) => ({
    name: artist,
    role: "Artist",
  }));

  const genres: Tag[] = detail.tags.map((tag) => ({
    id: tag.toLowerCase().replace(WHITESPACE_REGEX, "-"),
    title: tag,
    rating: ContentRating.ADULT,
  }));

  const properties: TagSection[] = [];

  if (detail.artists.length > 0) {
    properties.push({
      id: "artist",
      title: "Artist",
      namespace: "Artist",
      tags: detail.artists.map((a) => ({
        id: `artist:${a.toLowerCase().replace(WHITESPACE_REGEX, "-")}`,
        title: a,
        namespace: "Artist",
      })),
    } as TagSection);
  }

  if (detail.groups.length > 0) {
    properties.push({
      id: "group",
      title: "Circle",
      namespace: "Circle",
      tags: detail.groups.map((g) => ({
        id: `group:${g.toLowerCase().replace(WHITESPACE_REGEX, "-")}`,
        title: g,
        namespace: "Circle",
      })),
    } as TagSection);
  }

  if (detail.parodies.length > 0) {
    properties.push({
      id: "parody",
      title: "Parody",
      namespace: "Parody",
      tags: detail.parodies.map((p) => ({
        id: `parody:${p.toLowerCase().replace(WHITESPACE_REGEX, "-")}`,
        title: p,
        namespace: "Parody",
      })),
    } as TagSection);
  }

  if (detail.characters.length > 0) {
    properties.push({
      id: "character",
      title: "Character",
      namespace: "Character",
      tags: detail.characters.map((c) => ({
        id: `character:${c.toLowerCase().replace(WHITESPACE_REGEX, "-")}`,
        title: c,
        namespace: "Character",
      })),
    } as TagSection);
  }

  if (detail.categories.length > 0) {
    properties.push({
      id: "category",
      title: "Category",
      namespace: "Category",
      tags: detail.categories.map((cat) => ({
        id: `category:${cat.toLowerCase().replace(WHITESPACE_REGEX, "-")}`,
        title: cat,
        namespace: "Category",
      })),
    } as TagSection);
  }

  if (detail.languages.length > 0) {
    properties.push({
      id: "language",
      title: "Language",
      namespace: "Language",
      tags: detail.languages.map((lang) => ({
        id: `language:${lang.toLowerCase().replace(WHITESPACE_REGEX, "-")}`,
        title: lang,
        namespace: "Language",
      })),
    } as TagSection);
  }

  const primaryCategory = detail.categories[0]?.toLowerCase() ?? "";
  const isWestern = primaryCategory.includes("western");
  const contentType = isWestern ? ContentType.COMIC : ContentType.MANGA;
  const readingMode = isWestern
    ? ReadingMode.PAGED_COMIC
    : ReadingMode.PAGED_MANGA;

  const summaryLines: string[] = [];
  if (detail.categories.length > 0) {
    summaryLines.push(`Category: ${detail.categories.join(", ")}`);
  }
  if (detail.parodies.length > 0) {
    summaryLines.push(`Parody: ${detail.parodies.join(", ")}`);
  }
  if (detail.characters.length > 0) {
    summaryLines.push(`Characters: ${detail.characters.join(", ")}`);
  }
  if (detail.groups.length > 0) {
    summaryLines.push(`Circle / Group: ${detail.groups.join(", ")}`);
  }
  if (detail.artists.length > 0) {
    summaryLines.push(`Artist: ${detail.artists.join(", ")}`);
  }
  if (detail.languages.length > 0) {
    summaryLines.push(`Language: ${detail.languages.join(", ")}`);
  }
  summaryLines.push(`Pages: ${detail.totalPages}`);

  const additionalDetails: Record<string, string> = {
    Pages: String(detail.totalPages),
  };
  if (detail.categories.length > 0) {
    additionalDetails.Category = detail.categories.join(", ");
  }
  if (detail.languages.length > 0) {
    additionalDetails.Language = detail.languages.join(", ");
  }

  const content: ImHentaiContent = {
    title: display.title,
    coverImage: detail.coverImage,
    webUrl: detail.webUrl,
    rating: ContentRating.ADULT,
    status: ContentStatus.COMPLETED,
    contentType,
    readingMode,
    summary: summaryLines.join("\n"),
    additionalDetails,
    creators: detail.artists,
  };

  if (display.additionalTitles.length > 0) {
    content.additionalTitles = display.additionalTitles;
  }
  if (credits.length > 0) {
    content.credits = credits;
  }
  if (genres.length > 0) {
    content.genres = genres;
  }
  if (properties.length > 0) {
    content.properties = properties;
  }
  if (detail.characters.length > 0) {
    content.characters = detail.characters.map((name) => ({
      name,
      role: "Character",
    }));
  }
  if (detail.relatedItems && detail.relatedItems.length > 0) {
    content.collections = [
      {
        id: "related",
        title: "Related Works",
        items: detail.relatedItems,
      },
    ];
    (content as unknown as Record<string, unknown>).relatedContent =
      detail.relatedItems;
  }

  return content;
}

/**
 * Builds the single Chapter representation for a complete IMHentai gallery release.
 */
export function buildSingleGalleryChapter(
  detail: Pick<
    ImHentaiGalleryDetail,
    "id" | "totalPages" | "languages" | "groups" | "artists"
  >
): Chapter {
  const id = detail.id || "1";
  const langRaw = (detail.languages[0] ?? "en").toLowerCase();
  let language = "en";
  if (langRaw.includes("jap") || langRaw === "jp" || langRaw === "ja") {
    language = "ja";
  } else if (langRaw.includes("chin") || langRaw === "zh") {
    language = "zh";
  } else if (langRaw.includes("span") || langRaw === "es") {
    language = "es";
  } else if (langRaw.includes("fren") || langRaw === "fr") {
    language = "fr";
  } else if (langRaw.includes("germ") || langRaw === "de") {
    language = "de";
  } else if (langRaw.includes("russ") || langRaw === "ru") {
    language = "ru";
  }

  const pageLabel =
    detail.totalPages > 0 ? ` (${detail.totalPages} pages)` : "";

  return {
    id,
    index: 0,
    number: 1,
    title: `Complete Gallery${pageLabel}`,
    language,
    date: new Date(),
    webUrl: `${BASE_URL}/view/${id}/1/`,
  };
}

// ============================================================================
// HTTP & Scraper Client
// ============================================================================

export class ImHentaiScraperClient {
  private readonly client: ReturnType<NetworkClientBuilder["build"]>;
  private readonly galleryCache = new Map<string, CachedGalleryEntry>();

  constructor() {
    const builder = new NetworkClientBuilder()
      .setRateLimit(RATE_LIMIT_PER_SECOND, 1)
      .addRequestInterceptor(async (request: NetworkRequest) => {
        request.headers = {
          ...DEFAULT_HEADERS,
          ...(request.headers ?? {}),
        };
        return request;
      });
    this.client = builder.build();
  }

  public configureImageRequest(request: NetworkRequest): NetworkRequest {
    return {
      ...request,
      headers: {
        ...(request.headers ?? {}),
        ...PAGE_IMAGE_HEADERS,
      },
    };
  }

  public async fetchHtml(url: string): Promise<string> {
    const targetUrl = url.startsWith("http")
      ? url
      : `${BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;

    const response = await this.client.get(targetUrl, {
      headers: DEFAULT_HEADERS,
    });

    if (isCloudflareChallenge(response)) {
      throw new CloudflareError(CLOUDFLARE_RESOLUTION_URL);
    }

    return typeof response.data === "string"
      ? response.data
      : String(response.data ?? "");
  }

  public buildFeedUrl(
    feedKey: string,
    page: number,
    prefs: ImHentaiUserPreferences,
    sortBy?: string
  ): string {
    return buildFeedUrl(feedKey, page, prefs, sortBy);
  }

  public buildSearchUrl(
    params: ImHentaiExploreParams,
    prefs: ImHentaiUserPreferences
  ): string {
    return buildSearchUrl(params, prefs);
  }

  public async fetchFeedItems(
    feedKey: string,
    page: number,
    prefs?: ImHentaiUserPreferences,
    sortBy?: string,
    sortAscending?: boolean
  ): Promise<PagedItemList> {
    const resolvedPrefs = prefs ?? (await getUserPreferences());
    const url = this.buildFeedUrl(feedKey, page, resolvedPrefs, sortBy);
    const html = await this.fetchHtml(url);
    const cards = parseGalleryCards(html);

    if (cards.length === 0) {
      return {
        items: [],
        isLastPage: true,
      };
    }

    let overrideCategories: ReadonlySet<string> | undefined;
    const normFeedCategory = normalizeCategoryToken(feedKey);
    if (normFeedCategory) {
      overrideCategories = new Set([normFeedCategory]);
    }

    const items = filterAndMapGalleryCards(cards, resolvedPrefs, {
      overrideCategories,
    });

    if (sortBy === "title") {
      const dir = sortAscending === false ? -1 : 1;
      items.sort((a, b) => a.title.localeCompare(b.title) * dir);
    }

    const hasNextPage =
      cards.length > 0 &&
      (html.includes(`page=${(page || 1) + 1}`) ||
        html.includes('class="next"') ||
        cards.length >= 20);

    return {
      items,
      isLastPage: !hasNextPage,
    };
  }

  public async fetchSearchResults(
    params: ImHentaiExploreParams,
    prefs?: ImHentaiUserPreferences
  ): Promise<PagedItemList> {
    const resolvedPrefs = prefs ?? (await getUserPreferences());

    // Parameter Safety Guard: if query is empty or whitespace-only, fallback to standard feed
    if (
      !params.query?.trim() &&
      (!params.tags?.include || params.tags.include.length === 0)
    ) {
      const isPopular =
        params.sortBy === "popular" ||
        params.sortBy === "popularity" ||
        params.sortBy === "pp" ||
        params.sortBy === "most_viewed";
      return this.fetchFeedItems(
        isPopular ? BROWSE_FEED_KEYS.POPULAR : BROWSE_FEED_KEYS.LATEST,
        params.page ?? 1,
        resolvedPrefs,
        params.sortBy,
        params.sortAscending
      );
    }

    const url = this.buildSearchUrl(params, resolvedPrefs);
    const html = await this.fetchHtml(url);
    const cards = parseGalleryCards(html);

    if (cards.length === 0) {
      return {
        items: [],
        isLastPage: true,
      };
    }

    let overrideCategories: ReadonlySet<string> | undefined;
    if (params.categories?.include && params.categories.include.length > 0) {
      const set = new Set<string>();
      for (const c of params.categories.include) {
        const norm = normalizeCategoryToken(c);
        if (norm) set.add(norm);
      }
      if (set.size > 0) {
        overrideCategories = set;
      }
    }

    const items = filterAndMapGalleryCards(cards, resolvedPrefs, {
      overrideCategories,
      overrideLanguage: params.language,
      extraExcludedTags: params.tags?.exclude,
      requiredIncludedTags: params.tags?.include,
    });

    if (params.sortBy === "title") {
      const dir = params.sortAscending === false ? -1 : 1;
      items.sort((a, b) => a.title.localeCompare(b.title) * dir);
    }

    const page = params.page ?? 1;
    const hasNextPage =
      cards.length > 0 &&
      (html.includes(`page=${page + 1}`) ||
        html.includes('class="next"') ||
        cards.length >= 20);

    return {
      items,
      isLastPage: !hasNextPage,
    };
  }

  public async fetchGalleryDetail(
    contentId: string
  ): Promise<ImHentaiGalleryDetail> {
    const id = extractGalleryId(contentId);
    const now = Date.now();
    const cached = this.galleryCache.get(id);
    if (cached && now - cached.timestamp < GALLERY_CACHE_TTL_MS) {
      return cached.detail;
    }

    const url = `${BASE_URL}/gallery/${id}/`;
    const html = await this.fetchHtml(url);
    const detail = parseGalleryDetail(html, id);

    if (this.galleryCache.size >= GALLERY_CACHE_MAX_ENTRIES) {
      const oldestKey = this.galleryCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.galleryCache.delete(oldestKey);
      }
    }
    this.galleryCache.set(id, { timestamp: now, detail });
    return detail;
  }

  public async fetchContent(contentId: string): Promise<ImHentaiContent> {
    const [detail, prefs] = await Promise.all([
      this.fetchGalleryDetail(contentId),
      getUserPreferences(),
    ]);
    return mapDetailToContent(detail, prefs);
  }

  public async fetchChapters(contentId: string): Promise<Chapter[]> {
    const id = extractGalleryId(contentId);
    const cached = this.galleryCache.get(id);
    if (cached) {
      return [buildSingleGalleryChapter(cached.detail)];
    }
    const detail = await this.fetchGalleryDetail(id);
    return [buildSingleGalleryChapter(detail)];
  }

  public async fetchChapterPages(
    contentId: string,
    chapterId: string
  ): Promise<ChapterPage[]> {
    const id = extractGalleryId(contentId || chapterId);
    const cached = this.galleryCache.get(id);
    if (
      cached &&
      cached.detail.totalPages > 0 &&
      (cached.detail.baseUrl || cached.detail.loadDir)
    ) {
      return buildChapterPagesFromMeta(cached.detail);
    }

    const detail = await this.fetchGalleryDetail(id);
    return buildChapterPagesFromMeta(detail);
  }
}
