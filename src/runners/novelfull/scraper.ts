import {
  type Chapter,
  type Content,
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
} from "@suwatte/toolchain";
import * as cheerio from "cheerio";
import {
  buildAjaxChapterUrl,
  buildChapterUrl,
  buildFeedUrl,
  buildNovelUrl,
  buildSearchUrl,
  detectContentRating,
  extractChapterId,
  extractNovelId,
  isPlaceholderImageUrl,
  isReservedNovelFullPath,
  normalizeImageUrl,
} from "./api.js";
import {
  AJAX_HEADERS,
  BASE_URL,
  BG_IMAGE_URL_REGEX,
  BROWSE_FEED_KEYS,
  CHAPTER_NUMBER_REGEX,
  CLOUDFLARE_RESOLUTION_URL,
  ContentRating,
  DEFAULT_HEADERS,
  DEFAULT_SYNOPSIS_FALLBACK,
  FALLBACK_COVER_URL,
  IMAGE_HEADERS,
  INLINE_NOVEL_ID_REGEX,
  LEADING_NUMBER_REGEX,
  ORIGIN_URL,
  PROMO_LINK_HREF_REGEX,
  RATE_LIMIT_PER_SECOND,
  REFERER_URL,
  TLN_BRACKET_REGEX,
  VOLUME_NUMBER_REGEX,
  WATERMARK_PATTERNS,
  WHITESPACE_REGEX,
} from "./constants.js";
import {
  compileBlacklistContext,
  decodeHtmlEntities,
  getUserPreferences,
  isNovelAllowed,
} from "./preferences.js";
import type {
  NovelFullCard,
  NovelFullChapterEntry,
  NovelFullDetail,
  NovelFullExploreParams,
  NovelFullUserPreferences,
} from "./types.js";

const NOVEL_CACHE_TTL_MS = 30_000;
const NOVEL_CACHE_MAX_ENTRIES = 25;

interface CachedNovelEntry {
  readonly timestamp: number;
  readonly detail: NovelFullDetail;
}

// ============================================================================
// Pre-Compiled Static Regex Pipeline (v1.2 High-Performance Engine)
// ============================================================================

const TAG_SCANNER_REGEX = /<\/?div\b[^>]*>/gi;
const CHAPTER_CONTAINER_START_REGEX =
  /<(?:div|section|article)\b[^>]*(?:id\s*=\s*["'](?:chapter-content|chr-content)["']|class\s*=\s*["'][^"']*\b(?:chapter-c|chr-c|chapter-content|desc-text)\b)[^>]*>/i;
const DESC_FALLBACK_START_REGEX =
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bdesc\b[^"']*>/i;
const P_TAG_EXTRACTOR_REGEX = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
const STRIP_TAGS_REGEX = /<[^>]+>/g;
const PROMO_KEYWORD_REGEX = /\b(?:patreon|discord|paypal|ko-fi|novelfull)\b/i;
const INLINE_ON_HANDLER_REGEX =
  /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const REPEATED_BR_REGEX = /(?:<br\s*\/?>\s*){2,}/gi;
const SINGLE_BR_REGEX = /<br\s*\/?>/gi;
const OPEN_P_DIV_REGEX = /<(?:p|div)\b[^>]*>/gi;
const CLOSE_DIV_REGEX = /<\/div>/gi;
const NESTED_P_REGEX = /<p>\s*<p>/gi;
const NESTED_CLOSE_P_REGEX = /<\/p>\s*<\/p>/gi;
const EMPTY_P_REGEX = /<p>(?:\s|&nbsp;|\u00a0|<br>)*<\/p>/gi;
const HTML_COMMENTS_REGEX = /<!--[\s\S]*?-->/g;
const LINE_BREAK_BLOCK_REGEX = /\r?\n\s*\r?\n|\r?\n/;

const OPTION_TAG_REGEX =
  /<option\b[^>]*\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^>\s]+))[^>]*>([\s\S]*?)<\/option>/gi;

const ENTITIES_NBSP_REGEX = /&nbsp;|\u00a0|&#160;|&#xa0;/gi;
const ENTITIES_APOS_REGEX =
  /&rsquo;|&lsquo;|&#8217;|&#8216;|&#x2019;|&#x2018;|\u2019|\u2018/gi;
const ENTITIES_QUOT_REGEX =
  /&rdquo;|&ldquo;|&#8221;|&#8220;|&#x201d;|&#x201c;|\u201d|\u201c/gi;
const ENTITIES_HELLIP_REGEX = /&hellip;|&#8230;|&#x2026;|\u2026/gi;
const ENTITIES_MDASH_REGEX = /&mdash;|&#8212;|&#x2014;|\u2014/gi;
const ENTITIES_NDASH_REGEX = /&ndash;|&#8211;|&#x2013;|\u2013/gi;

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

// ============================================================================
// 1. Lazy-Load Safe Cover & Thumbnail Extraction
// ============================================================================

/**
 * Extracts an image URL from a single Cheerio `<img>` or container element,
 * strictly checking attributes in priority order:
 * `data-src` -> `data-lazy-src` -> `data-original` -> `src`.
 * Skips placeholder traps (`blank.gif`, `pixel.gif`, `/images/`).
 */
export function extractImageSrcFromImg(
  $el: cheerio.Cheerio
): string | undefined {
  if (!$el || $el.length === 0) return undefined;

  const candidates = [
    $el.attr("data-src"),
    $el.attr("data-lazy-src"),
    $el.attr("data-original"),
    $el.attr("src"),
  ];

  for (let i = 0; i < candidates.length; i++) {
    const raw = candidates[i];
    if (raw && typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed && !isPlaceholderImageUrl(trimmed)) {
        return normalizeImageUrl(trimmed);
      }
    }
  }

  const style = $el.attr("style");
  if (style) {
    const bgMatch = BG_IMAGE_URL_REGEX.exec(style);
    if (bgMatch?.[1]) {
      const bgUrl = bgMatch[1].trim();
      if (bgUrl && !isPlaceholderImageUrl(bgUrl)) {
        return normalizeImageUrl(bgUrl);
      }
    }
  }

  return undefined;
}

/**
 * Defensively extracts a cover/thumbnail URL from a card or detail container,
 * inspecting all child `<img>` elements and lazy-load attributes before falling back.
 */
export function extractCoverFromElement(
  $container: cheerio.Cheerio,
  $: cheerio.CheerioAPI
): string {
  if (!$container || $container.length === 0) {
    return FALLBACK_COVER_URL;
  }

  // 1. If the element itself is an <img> or has lazy attributes, check it directly
  const directSrc = extractImageSrcFromImg($container);
  if (directSrc) {
    return directSrc;
  }

  // 2. Inspect all child <img> elements in DOM order
  const $imgs = $container.find("img");
  for (let i = 0; i < $imgs.length; i++) {
    const $img = $($imgs[i]!);
    const extracted = extractImageSrcFromImg($img);
    if (extracted) {
      return extracted;
    }
  }

  // 3. Inspect any child element carrying data-src / data-lazy-src / data-original / style
  const $lazyChildren = $container.find(
    "[data-src], [data-lazy-src], [data-original], [style*='background']"
  );
  for (let i = 0; i < $lazyChildren.length; i++) {
    const $child = $($lazyChildren[i]!);
    const extracted = extractImageSrcFromImg($child);
    if (extracted) {
      return extracted;
    }
  }

  return FALLBACK_COVER_URL;
}

// ============================================================================
// 2. Listing Card Extraction & O(1) Blacklist Filtering
// ============================================================================

/**
 * Extracts a single `NovelFullCard` from a listing row or card element.
 */
export function extractNovelCardFromElement(
  $card: cheerio.Cheerio,
  $: cheerio.CheerioAPI
): NovelFullCard | null {
  if (!$card || $card.length === 0) return null;

  // Locate primary novel link (excluding chapter, genre, author, and reserved links)
  let novelHref = "";
  let rawTitle = "";

  const $titleAnchor = $card
    .find(
      "h3.truyen-title a, h3.novel-title a, .truyen-title a, .novel-title a, h3.title a, .title a, .book-title a, .caption h3 a, .caption a"
    )
    .first();

  if ($titleAnchor.length > 0) {
    novelHref = ($titleAnchor.attr("href") ?? "").trim();
    rawTitle =
      $titleAnchor.text().trim() || ($titleAnchor.attr("title") ?? "").trim();
  }

  if (!novelHref) {
    const $anchors = $card.find("a[href]");
    for (let i = 0; i < $anchors.length; i++) {
      const $a = $($anchors[i]!);
      const href = ($a.attr("href") ?? "").trim();
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
        continue;
      }
      if (
        href.includes("/genre/") ||
        href.includes("/author/") ||
        href.includes("/status/") ||
        href.includes("/search")
      ) {
        continue;
      }
      const cleanPath = href
        .replace(/^https?:\/\/[^/]+/i, "")
        .replace(/^\/+|\/+$/g, "");
      // Skip direct chapter links when looking for the series link if a series link exists
      if (cleanPath.includes("/")) {
        continue;
      }
      const candidateSlug = extractNovelId(href);
      if (candidateSlug && !isReservedNovelFullPath(candidateSlug)) {
        novelHref = href;
        rawTitle =
          rawTitle ||
          $a.attr("title")?.trim() ||
          $a.text().trim() ||
          $a.find("img").attr("alt")?.trim() ||
          "";
        break;
      }
    }
  }

  // If still no novelHref, check if card itself is an <a> or has a chapter link from which we can derive the novel slug
  if (!novelHref) {
    const selfHref = ($card.attr("href") ?? "").trim();
    if (selfHref) {
      novelHref = selfHref;
    } else {
      const firstHref = ($card.find("a[href]").first().attr("href") ?? "").trim();
      if (
        firstHref &&
        !firstHref.includes("/genre/") &&
        !firstHref.includes("/author/")
      ) {
        novelHref = firstHref;
      }
    }
  }

  const id = extractNovelId(novelHref);
  if (!id || isReservedNovelFullPath(id)) {
    return null;
  }

  if (!rawTitle) {
    rawTitle =
      $card.find("h3, h4, .title, .truyen-title").first().text().trim() ||
      $card.find("img").first().attr("alt")?.trim() ||
      $card.attr("title")?.trim() ||
      id.replace(/-/g, " ");
  }

  const title = decodeHtmlEntities(rawTitle);
  if (!title) {
    return null;
  }

  const coverImage = extractCoverFromElement($card, $);

  // Author
  const rawAuthor =
    $card.find(".author, span.author, a[href*='/author/']").first().text().trim() ||
    undefined;
  const author = rawAuthor ? decodeHtmlEntities(rawAuthor) : undefined;

  // Latest chapter
  const rawLatestChapter =
    $card
      .find(
        ".text-info a, .chr-text, .chapter-text, .latest-chapter a, .col-xs-2 a, a[href*='/chapter']"
      )
      .first()
      .text()
      .trim() || undefined;
  const latestChapter = rawLatestChapter
    ? decodeHtmlEntities(rawLatestChapter)
    : undefined;

  // Badges & Status
  const isFull =
    $card.find(".label-full, .label-completed, .full-label").length > 0 ||
    $card.hasClass("full");
  const isHot =
    $card.find(".label-hot, .hot-label").length > 0 || $card.hasClass("hot");
  const isNew =
    $card.find(".label-new, .new-label").length > 0 || $card.hasClass("new");

  const status = isFull ? ContentStatus.COMPLETED : undefined;

  // Genres (from inline genre links or data-genres attribute)
  const genreSet = new Set<string>();
  const dataGenres = $card.attr("data-genres") ?? $card.attr("data-genre");
  if (dataGenres) {
    const parts = dataGenres.split(/[,;]/);
    for (let i = 0; i < parts.length; i++) {
      const g = parts[i]?.trim();
      if (g) genreSet.add(decodeHtmlEntities(g));
    }
  }

  $card.find("a[href*='/genre/'], .genre, .genres a").each((_i, el) => {
    const gText = decodeHtmlEntities($(el).text());
    if (gText) {
      genreSet.add(gText);
    }
  });

  const genres = Array.from(genreSet);
  const rating = detectContentRating(genres);

  return {
    id,
    title,
    coverImage,
    webUrl: buildNovelUrl(id),
    author,
    latestChapter,
    status,
    isHot,
    isFull,
    isNew,
    genres,
    rating,
  };
}

/**
 * Parses all novel listing cards from an HTML string or Cheerio instance,
 * supporting `.col-novel-main`, `.list-novel`, `.list-truyen`, `.book`, `.item`, and `.row`.
 */
export function parseNovelCards(
  htmlOrCheerio: string | cheerio.CheerioAPI,
  $scope?: cheerio.Cheerio
): NovelFullCard[] {
  if (!htmlOrCheerio) {
    return [];
  }

  const $ =
    typeof htmlOrCheerio === "function"
      ? htmlOrCheerio
      : cheerio.load(htmlOrCheerio);

  const cards: NovelFullCard[] = [];
  const seenIds = new Set<string>();

  const pushCard = ($el: cheerio.Cheerio) => {
    const card = extractNovelCardFromElement($el, $);
    if (card && !seenIds.has(card.id)) {
      seenIds.add(card.id);
      cards.push(card);
    }
  };

  if ($scope && $scope.length > 0) {
    const $candidates = $scope.find(
      ".list-novel .row, .list-truyen .row, .col-novel-main .row, .archive .row, .row, .item, .book, .novel-item"
    );
    if ($candidates.length > 0) {
      $candidates.each((_i, el) => pushCard($(el)));
    } else {
      $scope.each((_i, el) => pushCard($(el)));
    }
    return cards;
  }

  // Primary row/item selectors across NovelFull listing and home views
  const $primaryRows = $(
    ".list-novel .row, .list-truyen .row, #list-page .row, .col-novel-main .row, .archive .row, #list-index .row, #intro-index .item, .index-intro .item, #truyen-slide .item, .MultiCarousel .item, .hot-novel .item, .completed-novel .item, .most-popular .item, .novel-item"
  );
  $primaryRows.each((_i, el) => pushCard($(el)));

  // Fallback for standalone `.book`, `.col-novel-main` cards, or `.list-novel` items
  if (cards.length === 0) {
    const $fallbackCards = $(
      ".col-novel-main .book, .list-novel .book, .book, .item, .row"
    );
    $fallbackCards.each((_i, el) => pushCard($(el)));
  }

  return cards;
}

/**
 * Maps a `NovelFullCard` to a Suwatte `Item` for display in shelves, feeds, and search results.
 */
export function mapCardToItem(card: NovelFullCard): Item {
  const subtitleParts: string[] = [];
  if (card.latestChapter) {
    subtitleParts.push(card.latestChapter);
  } else if (card.author) {
    subtitleParts.push(card.author);
  }
  if (card.isFull && !subtitleParts.includes("Completed")) {
    subtitleParts.push("Completed");
  }

  const item: Item = {
    id: card.id,
    title: card.title,
    coverImage: card.coverImage || FALLBACK_COVER_URL,
    webUrl: card.webUrl || buildNovelUrl(card.id),
    rating: card.rating ?? detectContentRating(card.genres),
  };

  if (subtitleParts.length > 0) {
    item.subtitle = subtitleParts.join(" • ");
  }

  return item;
}

/**
 * Filters raw `NovelFullCard` items using the O(1) Set blacklist context and optional search filters,
 * immediately discarding blacklisted works and mapping allowed entries to Suwatte `Item` objects.
 */
export function filterAndMapNovelCards(
  cards: readonly NovelFullCard[],
  prefs: NovelFullUserPreferences,
  exploreParams?: NovelFullExploreParams
): Item[] {
  if (!Array.isArray(cards) || cards.length === 0) {
    return [];
  }

  const additionalExcludes = exploreParams?.genres?.exclude;
  const ctx = compileBlacklistContext(prefs, additionalExcludes);

  const requiredGenresLower: string[] = [];
  if (
    exploreParams?.genres?.include &&
    exploreParams.genres.include.length > 0
  ) {
    for (let i = 0; i < exploreParams.genres.include.length; i++) {
      const g = exploreParams.genres.include[i]?.trim().toLowerCase();
      if (g && g !== "all") {
        requiredGenresLower.push(g);
      }
    }
  } else if (
    exploreParams?.genre &&
    exploreParams.genre.trim().toLowerCase() !== "all"
  ) {
    requiredGenresLower.push(exploreParams.genre.trim().toLowerCase());
  }

  const statusFilter = exploreParams?.status?.trim().toLowerCase();

  const items: Item[] = [];
  for (let i = 0, len = cards.length; i < len; i++) {
    const card = cards[i];
    if (!card || !card.id) continue;

    // Early exit: O(1) Set lookup against blacklisted genres, slugs, and keywords
    if (!isNovelAllowed(card, ctx)) {
      continue;
    }

    // Optional status filter check when card carries explicit status metadata
    if (statusFilter === "completed" && card.status === ContentStatus.ONGOING) {
      continue;
    }
    if (statusFilter === "ongoing" && card.status === ContentStatus.COMPLETED) {
      continue;
    }

    // Optional genre inclusion check when card carries explicit genre tags
    if (requiredGenresLower.length > 0 && card.genres.length > 0) {
      const cardGenresLower = card.genres.map((g: string) => g.toLowerCase());
      let matchesGenre = false;
      for (let gIdx = 0; gIdx < requiredGenresLower.length; gIdx++) {
        const reqG = requiredGenresLower[gIdx]!;
        if (cardGenresLower.includes(reqG)) {
          matchesGenre = true;
          break;
        }
      }
      if (!matchesGenre) {
        continue;
      }
    }

    items.push(mapCardToItem(card));
  }

  return items;
}

/**
 * Checks whether a listing page is the last page of pagination.
 */
export function isLastListingPage(
  $: cheerio.CheerioAPI,
  itemCount: number
): boolean {
  if (itemCount === 0) {
    return true;
  }

  const $pagination = $(".pagination, ul.pagination");
  if ($pagination.length === 0) {
    return false;
  }

  const $nextLi = $pagination.find("li.next");
  if ($nextLi.length > 0) {
    return $nextLi.hasClass("disabled");
  }

  const $nextLink = $pagination.find(
    "a[rel='next'], a:contains('Next'), a:contains('>'), a:contains('»')"
  );
  if ($nextLink.length > 0) {
    const $parentLi = $nextLink.closest("li");
    return $parentLi.hasClass("disabled");
  }

  return false;
}

// ============================================================================
// 3. Novel Details & 1-Pass Chapter Loading
// ============================================================================

/**
 * Parses a chapter number and optional volume number from a chapter title or slug.
 */
export function parseChapterNumber(
  title: string,
  chapterSlug: string,
  fallbackNumber: number
): { number: number; volume?: number } {
  let volume: number | undefined;
  const volMatch =
    VOLUME_NUMBER_REGEX.exec(title) ?? VOLUME_NUMBER_REGEX.exec(chapterSlug);
  if (volMatch?.[1]) {
    const parsedVol = parseInt(volMatch[1], 10);
    if (Number.isFinite(parsedVol) && parsedVol > 0) {
      volume = parsedVol;
    }
  }

  // 1. Chapter title match: "(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)"
  const titleMatch = title.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
  if (titleMatch?.[1]) {
    const num = parseFloat(titleMatch[1]);
    if (Number.isFinite(num) && num >= 0) {
      return { number: num, volume };
    }
  }

  // 2. Fallback to other episode / part keywords
  const epMatch = title.match(/(?:episode|ep\.?|part)\s*(\d+(?:\.\d+)?)/i);
  if (epMatch?.[1]) {
    const num = parseFloat(epMatch[1]);
    if (Number.isFinite(num) && num >= 0) {
      return { number: num, volume };
    }
  }

  // 3. Chapter slug match: "chapter-123-..."
  const slugText = chapterSlug.replace(/[-_/]/g, " ");
  const slugMatch = slugText.match(
    /(?:chapter|ch\.?|episode|ep\.?|part)\s*(\d+(?:\.\d+)?)/i
  );
  if (slugMatch?.[1]) {
    const num = parseFloat(slugMatch[1]);
    if (Number.isFinite(num) && num >= 0) {
      return { number: num, volume };
    }
  }

  // 4. Leading number in title (e.g. "123 - The Beginning")
  const leadingMatch = LEADING_NUMBER_REGEX.exec(title.trim());
  if (leadingMatch?.[1]) {
    const num = parseFloat(leadingMatch[1]);
    if (Number.isFinite(num) && num >= 0) {
      return { number: num, volume };
    }
  }

  // 5. Standalone or trailing number in slug (e.g. "c123" or "...-123")
  const slugNumMatch = slugText.match(/\b(?:c)?(\d+(?:\.\d+)?)\b/i);
  if (slugNumMatch?.[1]) {
    const num = parseFloat(slugNumMatch[1]);
    if (Number.isFinite(num) && num >= 0) {
      return { number: num, volume };
    }
  }

  return { number: fallbackNumber, volume };
}

/**
 * Parses the `<select>` / `<option>` response from `https://novelfull.com/ajax-chapter-option?novelId=${novelId}`.
 * Employs a single fast regex scan over <option> tags to avoid DOM tree allocation overhead.
 */
export function parseAjaxChapterOptions(
  html: string,
  novelSlug: string
): NovelFullChapterEntry[] {
  if (!html || typeof html !== "string") {
    return [];
  }

  const cleanNovelSlug = extractNovelId(novelSlug);
  const entries: NovelFullChapterEntry[] = [];
  const seenIds = new Set<string>();

  // Single fast regex scan over <option> tags (avoids Cheerio DOM tree overhead)
  OPTION_TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = OPTION_TAG_REGEX.exec(html)) !== null) {
    const rawVal = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    const rawText = decodeHtmlEntities(match[4] ?? "");
    if (!rawVal && !rawText) continue;

    const chapterId = extractChapterId(rawVal || rawText, cleanNovelSlug);
    if (!chapterId || seenIds.has(chapterId)) continue;
    seenIds.add(chapterId);

    const title = rawText || `Chapter ${idx + 1}`;
    const { number, volume } = parseChapterNumber(title, chapterId, idx + 1);
    const webUrl = buildChapterUrl(cleanNovelSlug, rawVal || chapterId);

    entries.push({
      id: chapterId,
      chapterId,
      title,
      number,
      volume,
      webUrl,
    });
    idx++;
  }

  // Fallback to Cheerio only if regex matched 0 options from non-standard HTML
  if (entries.length === 0) {
    const $ = cheerio.load(html);
    const $options = $("option");
    $options.each((i, el) => {
      const $opt = $(el);
      const rawVal = ($opt.attr("value") ?? "").trim();
      const rawText = decodeHtmlEntities($opt.text());
      if (!rawVal && !rawText) return;

      const chapterId = extractChapterId(rawVal || rawText, cleanNovelSlug);
      if (!chapterId || seenIds.has(chapterId)) return;
      seenIds.add(chapterId);

      const title = rawText || `Chapter ${i + 1}`;
      const { number, volume } = parseChapterNumber(title, chapterId, i + 1);
      const webUrl = buildChapterUrl(cleanNovelSlug, rawVal || chapterId);

      entries.push({
        id: chapterId,
        chapterId,
        title,
        number,
        volume,
        webUrl,
      });
    });
  }

  return entries;
}

/**
 * Fallback parser extracting chapters from the on-page `.list-chapter` table when AJAX is unavailable.
 */
export function parseOnPageChapters(
  $: cheerio.CheerioAPI,
  novelSlug: string
): NovelFullChapterEntry[] {
  const entries: NovelFullChapterEntry[] = [];
  const seenIds = new Set<string>();
  const cleanNovelSlug = extractNovelId(novelSlug);

  const $links = $(
    "ul.list-chapter li a, .list-chapter li a, #list-chapter li a, .list-chapter a"
  );

  $links.each((idx, el) => {
    const $a = $(el);
    const href = ($a.attr("href") ?? "").trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
      return;
    }

    const chapterId = extractChapterId(href, cleanNovelSlug);
    if (!chapterId || seenIds.has(chapterId)) return;
    seenIds.add(chapterId);

    const rawText = decodeHtmlEntities(
      $a.find(".chapter-text, .chr-text").text() ||
        $a.text() ||
        $a.attr("title") ||
        `Chapter ${idx + 1}`
    );
    const title = rawText || `Chapter ${idx + 1}`;
    const { number, volume } = parseChapterNumber(title, chapterId, idx + 1);
    const webUrl = buildChapterUrl(cleanNovelSlug, href);

    entries.push({
      id: chapterId,
      chapterId,
      title,
      number,
      volume,
      webUrl,
    });
  });

  return entries;
}

/**
 * Maps `NovelFullChapterEntry[]` to Suwatte `Chapter[]`.
 * Ensures array is returned in strictly chronological ascending order:
 * [Chapter 1, Chapter 2, Chapter 3, ..., Chapter N] with sequential index 0..N-1.
 */
export function mapChapterEntriesToChapters(
  entries: readonly NovelFullChapterEntry[],
  novelSlug: string
): Chapter[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const cleanNovelSlug = extractNovelId(novelSlug);

  // Attach original index for stable tie-breaking
  const indexedEntries = entries.map((entry, originalIndex) => ({
    entry,
    originalIndex,
  }));

  // Determine if original source list was in descending order
  const firstNum = entries[0]?.number ?? 0;
  const lastNum = entries[entries.length - 1]?.number ?? 0;
  const isSourceDescending = firstNum > lastNum;

  // Sort entries in strictly chronological ascending order
  indexedEntries.sort((a, b) => {
    const numA =
      typeof a.entry.number === "number" && Number.isFinite(a.entry.number)
        ? a.entry.number
        : 0;
    const numB =
      typeof b.entry.number === "number" && Number.isFinite(b.entry.number)
        ? b.entry.number
        : 0;

    if (numA !== numB) {
      return numA - numB;
    }

    const volA =
      typeof a.entry.volume === "number" && Number.isFinite(a.entry.volume)
        ? a.entry.volume
        : 0;
    const volB =
      typeof b.entry.volume === "number" && Number.isFinite(b.entry.volume)
        ? b.entry.volume
        : 0;

    if (volA !== volB) {
      return volA - volB;
    }

    // Stable tie-breaker: if source was descending, later original elements came first chronologically
    return isSourceDescending
      ? b.originalIndex - a.originalIndex
      : a.originalIndex - b.originalIndex;
  });

  const total = indexedEntries.length;
  const chapters = new Array<Chapter>(total);

  for (let i = 0; i < total; i++) {
    const { entry } = indexedEntries[i]!;
    const chapterNumber =
      typeof entry.number === "number" &&
      Number.isFinite(entry.number) &&
      entry.number >= 0
        ? entry.number
        : i + 1;

    const chapter: Chapter = {
      id: entry.id,
      index: i,
      number: chapterNumber,
      title: entry.title || `Chapter ${chapterNumber}`,
      language: "en",
      webUrl: entry.webUrl || buildChapterUrl(cleanNovelSlug, entry.id),
      date: entry.date ?? new Date(1700000000000 + i * 60000),
      data: {
        chapterId: entry.chapterId,
        contentId: cleanNovelSlug,
        webUrl: entry.webUrl || buildChapterUrl(cleanNovelSlug, entry.id),
      },
    };

    if (
      typeof entry.volume === "number" &&
      Number.isFinite(entry.volume) &&
      entry.volume > 0
    ) {
      chapter.volume = entry.volume;
    }

    chapters[i] = chapter;
  }

  return chapters;
}

/**
 * Extracts the numeric `novelId` from a NovelFull detail page DOM or HTML string.
 */
export function extractNumericNovelId(
  $: cheerio.CheerioAPI,
  html?: string
): string | undefined {
  const fromRatingDiv =
    $("div#rating[data-novel-id]").attr("data-novel-id")?.trim() ||
    $("#rating").attr("data-novel-id")?.trim() ||
    $("[data-novel-id]").first().attr("data-novel-id")?.trim() ||
    $("input#truyen-id").val()?.trim() ||
    $("input[name='novelId']").val()?.trim();

  if (fromRatingDiv && /^\d+$/.test(fromRatingDiv)) {
    return fromRatingDiv;
  }

  if (html) {
    const regexMatch = INLINE_NOVEL_ID_REGEX.exec(html);
    if (regexMatch?.[1]) {
      return regexMatch[1];
    }
  }

  return undefined;
}

/**
 * Parses full novel metadata (`NovelFullDetail`) from a NovelFull detail page HTML.
 */
export function parseNovelDetail(
  html: string,
  contentIdOrUrl: string
): NovelFullDetail {
  const $ = cheerio.load(html);
  const id = extractNovelId(contentIdOrUrl);

  // 1. Title (.title, h3)
  const rawTitle =
    $("div.desc > h3.title").text().trim() ||
    $("h3.title").first().text().trim() ||
    $(".col-novel-main h3").first().text().trim() ||
    $(".books .desc h3.title").first().text().trim() ||
    $("meta[property='og:title']").attr("content")?.trim() ||
    id.replace(/-/g, " ");

  const cleanedTitle = decodeHtmlEntities(rawTitle)
    .replace(/\s*-\s*Read Novel Online Free.*$/i, "")
    .replace(/\s*-\s*NovelFull.*$/i, "")
    .trim();

  const title = cleanedTitle || id.replace(/-/g, " ") || "Untitled Novel";

  // 2. High-res Cover Art (.book img, .info-holder .book img)
  const $coverContainer = $(
    ".books .book, .info-holder .book, .book, .info-holder, .col-info-desc"
  ).first();
  const coverImage =
    $coverContainer.length > 0
      ? extractCoverFromElement($coverContainer, $)
      : normalizeImageUrl($("meta[property='og:image']").attr("content"));

  // 3. Authors (.info a[href*="author"])
  const authorSet = new Set<string>();
  $(".info a[href*='author'], .info-novel a[href*='author']").each((_i, el) => {
    const aText = decodeHtmlEntities($(el).text());
    if (aText) authorSet.add(aText);
  });

  if (authorSet.size === 0) {
    $(".info div, .info li, .info p").each((_i, el) => {
      const text = decodeHtmlEntities($(el).text());
      if (/^author\s*:/i.test(text)) {
        const afterColon = text.replace(/^author\s*:\s*/i, "").trim();
        if (afterColon) {
          const parts = afterColon.split(/[,;]/);
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i]?.trim();
            if (p) authorSet.add(p);
          }
        }
      }
    });
  }
  const authors = Array.from(authorSet);

  // 4. Genres (.info div:contains("Genre") a, .info a[href*="/genre/"])
  const genreSet = new Set<string>();
  $(
    ".info div:contains('Genre') a, .info a[href*='/genre/'], .info-novel a[href*='/genre/'], .info a[href*='genre']"
  ).each((_i, el) => {
    const gText = decodeHtmlEntities($(el).text()).trim();
    if (gText) genreSet.add(gText);
  });

  if (genreSet.size === 0) {
    $(".info div, .info li, .info p").each((_i, el) => {
      const text = decodeHtmlEntities($(el).text());
      if (/^genre(?:s)?\s*:/i.test(text)) {
        const afterColon = text.replace(/^genre(?:s)?\s*:\s*/i, "").trim();
        const parts = afterColon.split(/[,;]/);
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i]?.trim();
          if (p) genreSet.add(p);
        }
      }
    });
  }
  const genres = Array.from(genreSet);

  // 5. Status (.info span, .info a[href*="status"])
  let statusText =
    $(".info a[href*='status']").first().text().trim() ||
    $(".info span.text-primary, .info span.text-success, .info span")
      .last()
      .text()
      .trim() ||
    "";

  if (!statusText || /^author|^genre|^source|^alternative/i.test(statusText)) {
    $(".info div, .info li, .info p").each((_i, el) => {
      const text = decodeHtmlEntities($(el).text());
      if (/^status\s*:/i.test(text)) {
        statusText = text.replace(/^status\s*:\s*/i, "").trim();
      }
    });
  }

  const statusLower = statusText.toLowerCase();
  let status = ContentStatus.UNKNOWN;
  if (statusLower.includes("completed") || statusLower.includes("full")) {
    status = ContentStatus.COMPLETED;
  } else if (statusLower.includes("ongoing")) {
    status = ContentStatus.ONGOING;
  } else if (statusLower.includes("hiatus")) {
    status = ContentStatus.HIATUS;
  } else if (
    statusLower.includes("cancelled") ||
    statusLower.includes("canceled") ||
    statusLower.includes("dropped")
  ) {
    status = ContentStatus.CANCELLED;
  }

  // 6. Alternative Titles & Source
  const additionalTitles: string[] = [];
  let source: string | undefined;
  $(".info div, .info li, .info p").each((_i, el) => {
    const text = decodeHtmlEntities($(el).text());
    if (/^alternative(?:\s+names?)?\s*:/i.test(text)) {
      const rawAlts = text
        .replace(/^alternative(?:\s+names?)?\s*:\s*/i, "")
        .trim();
      const parts = rawAlts.split(/[,;]/);
      for (let i = 0; i < parts.length; i++) {
        const alt = parts[i]?.trim();
        if (alt && alt.toLowerCase() !== title.toLowerCase()) {
          additionalTitles.push(alt);
        }
      }
    } else if (/^source\s*:/i.test(text)) {
      const rawSource = text.replace(/^source\s*:\s*/i, "").trim();
      if (rawSource) {
        source = rawSource;
      }
    }
  });

  // 7. Synopsis (.desc-text)
  const $desc = $(".desc-text, #tab-description, [itemprop='description']").first();
  let summary = "";
  if ($desc.length > 0) {
    const $descClone = $desc.clone();
    $descClone.find("script, style, iframe, .ads").remove();
    const rawDescHtml = $descClone.html() ?? $descClone.text() ?? "";
    const withLineBreaks = rawDescHtml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ");
    summary = decodeHtmlEntities(withLineBreaks);
  }
  if (!summary) {
    summary =
      decodeHtmlEntities($("meta[name='description']").attr("content")) ||
      DEFAULT_SYNOPSIS_FALLBACK;
  }

  // 8. Rating Score
  let ratingValue: number | undefined;
  const rawScore =
    $("[itemprop='ratingValue']").first().text().trim() ||
    $("#rateVal").attr("value")?.trim() ||
    $("#rating").attr("data-score")?.trim();
  if (rawScore) {
    const parsedScore = parseFloat(rawScore);
    if (Number.isFinite(parsedScore) && parsedScore > 0) {
      ratingValue = parsedScore;
    }
  }

  // 9. Numeric Novel ID & On-Page Fallback Chapters
  const numericNovelId = extractNumericNovelId($, html);
  const onPageChapters = parseOnPageChapters($, id);

  // 10. Related / Same Author Novels if present
  const $relatedScope = $(
    ".list-side .row, .col-truyen-side .row, .related-novels .item"
  );
  const relatedItems =
    $relatedScope.length > 0 ? parseNovelCards($, $relatedScope) : [];

  return {
    id,
    numericNovelId,
    title,
    additionalTitles,
    coverImage,
    webUrl: buildNovelUrl(id),
    authors,
    genres,
    source,
    status,
    summary,
    ratingValue,
    contentRating: detectContentRating(genres),
    onPageChapters,
    relatedItems,
  };
}

/**
 * Converts a parsed `NovelFullDetail` into Suwatte's `Content` object with `ContentType.NOVEL`.
 */
export function mapDetailToContent(
  detail: NovelFullDetail,
  prefs: NovelFullUserPreferences
): Content {
  const credits: Credit[] = detail.authors.map((authorName) => ({
    name: authorName,
    role: "Author",
  }));

  const genreTags: Tag[] = detail.genres.map((genreName) => ({
    id: genreName,
    title: genreName,
    rating: detectContentRating([genreName]),
  }));

  const properties: TagSection[] = [];
  if (genreTags.length > 0) {
    properties.push({
      id: "genres",
      title: "Genres",
      tags: genreTags,
    });
  }

  const additionalDetails: Record<string, string> = {
    Format: "Web Novel",
  };
  if (detail.authors.length > 0) {
    additionalDetails["Author"] = detail.authors.join(", ");
  }
  if (detail.source) {
    additionalDetails["Source"] = detail.source;
  }

  const collections: ItemCollection[] = [];
  if (detail.relatedItems.length > 0) {
    const filteredRelated = filterAndMapNovelCards(detail.relatedItems, prefs);
    if (filteredRelated.length > 0) {
      collections.push({
        id: "related_novels",
        title: "Related Novels",
        items: filteredRelated,
      });
    }
  }

  const content: Content = {
    title: detail.title,
    coverImage: detail.coverImage || FALLBACK_COVER_URL,
    webUrl: detail.webUrl,
    rating: detail.contentRating,
    status: detail.status,
    contentType: ContentType.NOVEL,
    readingMode: ReadingMode.VERTICAL,
    summary: detail.summary || DEFAULT_SYNOPSIS_FALLBACK,
    additionalDetails,
    ...(detail.additionalTitles.length > 0
      ? { additionalTitles: detail.additionalTitles }
      : {}),
    ...(credits.length > 0 ? { credits } : {}),
    ...(genreTags.length > 0 ? { genres: genreTags } : {}),
    ...(properties.length > 0 ? { properties } : {}),
    ...(collections.length > 0 ? { collections } : {}),
    ...(detail.ratingValue !== undefined
      ? { statistics: { rating: detail.ratingValue } }
      : {}),
  };

  return content;
}

// ============================================================================
// 4. Native Novel Text Reader & Sanitization Engine (getChapterText)
// ============================================================================

/**
 * Extracts raw chapter body fragment from the full HTML page using fast string scanning,
 * avoiding parsing the whole 100KB document tree.
 */
function extractChapterFragment(html: string): string {
  const startMatch = CHAPTER_CONTAINER_START_REGEX.exec(html);
  if (!startMatch) {
    const descMatch = DESC_FALLBACK_START_REGEX.exec(html);
    if (!descMatch) return html;
    const startIndex = descMatch.index + descMatch[0].length;
    return extractDivSlice(html, startIndex);
  }
  const startIndex = startMatch.index + startMatch[0].length;
  return extractDivSlice(html, startIndex);
}

function extractDivSlice(html: string, startIndex: number): string {
  let depth = 1;
  TAG_SCANNER_REGEX.lastIndex = startIndex;
  let match: RegExpExecArray | null;
  while ((match = TAG_SCANNER_REGEX.exec(html)) !== null) {
    if (match[0].startsWith("</")) {
      depth--;
      if (depth === 0) {
        return html.slice(startIndex, match.index);
      }
    } else if (!match[0].endsWith("/>")) {
      depth++;
    }
  }
  return html.slice(startIndex);
}

/**
 * Normalizes HTML entities and typography symbols in chapter HTML using pre-compiled regex:
 * - `&nbsp;` -> `" "`
 * - `&rsquo;` / `&lsquo;` -> `'`
 * - `&rdquo;` / `&ldquo;` -> `"`
 * - `&hellip;` -> `...`
 * - `&mdash;` -> `—`
 */
export function normalizeTypographyAndEntities(html: string): string {
  return html
    .replace(ENTITIES_NBSP_REGEX, " ")
    .replace(ENTITIES_APOS_REGEX, "'")
    .replace(ENTITIES_QUOT_REGEX, '"')
    .replace(ENTITIES_HELLIP_REGEX, "...")
    .replace(ENTITIES_MDASH_REGEX, "—")
    .replace(ENTITIES_NDASH_REGEX, "–");
}

/**
 * Formats bracketed or parenthesized Translator Notes (TLNs) into Markdown callouts:
 * `/(?:\[|\()TL(?: Note)?:\s*(.*?)(?:\]|\))/gi` -> `> 💡 **Translator Note:** $1`
 */
export function formatTranslatorNotes(textOrHtml: string): string {
  return textOrHtml.replace(
    TLN_BRACKET_REGEX,
    (_match, noteBody: string) => `> 💡 **Translator Note:** ${noteBody.trim()}`
  );
}

/**
 * Strips recurring aggregator watermarks, donation pitches, and Discord/Patreon/PayPal links.
 */
export function stripAggregatorWatermarks(textOrHtml: string): string {
  let cleaned = textOrHtml;
  for (let i = 0, len = WATERMARK_PATTERNS.length; i < len; i++) {
    const pattern = WATERMARK_PATTERNS[i]!;
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned;
}

/**
 * High-Performance Chapter Text Sanitization & Typography Pipeline for `getChapterText()`.
 * 1. Fast fragment extraction (skips 100KB of navbar/footer DOM).
 * 2. Single-pass isolated Cheerio cleanup for ads, scripts, and promo links.
 * 3. Pre-compiled static regex pipeline for watermarks, TLN, smart quotes, and entity normalization.
 * 4. Zero-allocation paragraph extraction without secondary Cheerio loading.
 */
export function sanitizeChapterHtml(
  rawHtml: string,
  prefs?: Partial<NovelFullUserPreferences>
): string {
  if (!rawHtml || typeof rawHtml !== "string") {
    return "<p>No chapter text available.</p>";
  }

  const sanitizeAds = prefs?.sanitizeAds !== false;
  const formatTln = prefs?.formatTln !== false;
  const normalizeSpacing = prefs?.normalizeSpacing !== false;

  // 1. Fast slice extraction of chapter content container
  const rawFragment = extractChapterFragment(rawHtml);
  const withoutComments = rawFragment.replace(HTML_COMMENTS_REGEX, "");

  // 2. Parse only the isolated chapter fragment (avoids full 100KB document tree)
  const $ = cheerio.load(`<div id="nf-frag">${withoutComments}</div>`);
  const $container = $("#nf-frag");

  // Always strip executable/unsafe elements
  $container
    .find("script, style, iframe, noscript, object, embed, form, input, button")
    .remove();

  if (sanitizeAds) {
    // Strip aggregator ad containers & centered promo blocks
    $container
      .find(
        ".ads, .ads-holder, .ads-content, .ad, ins, div[align='center'], [class*='ads-'], [id*='ads-']"
      )
      .remove();

    // Strip aggregator donation & promo anchor links
    $container.find("a").each((_i, el) => {
      const $a = $(el);
      const href = ($a.attr("href") ?? "").trim();
      const text = $a.text().trim();
      if (
        PROMO_LINK_HREF_REGEX.test(href) ||
        PROMO_LINK_HREF_REGEX.test(text) ||
        PROMO_KEYWORD_REGEX.test(text)
      ) {
        $a.remove();
      }
    });
  }

  let bodyHtml = $container.html() ?? "";

  // 3. Pre-compiled static regex pipeline
  bodyHtml = bodyHtml.replace(INLINE_ON_HANDLER_REGEX, "");

  if (sanitizeAds) {
    bodyHtml = stripAggregatorWatermarks(bodyHtml);
  }

  if (normalizeSpacing) {
    bodyHtml = normalizeTypographyAndEntities(bodyHtml);
  }

  if (formatTln) {
    bodyHtml = formatTranslatorNotes(bodyHtml);
  }

  if (normalizeSpacing) {
    bodyHtml = bodyHtml
      .replace(REPEATED_BR_REGEX, "</p>\n\n<p>")
      .replace(SINGLE_BR_REGEX, "<br>")
      .replace(OPEN_P_DIV_REGEX, "<p>")
      .replace(CLOSE_DIV_REGEX, "</p>")
      .replace(NESTED_P_REGEX, "<p>")
      .replace(NESTED_CLOSE_P_REGEX, "</p>")
      .replace(EMPTY_P_REGEX, "");

    // Extract paragraph blocks with pre-compiled regex (NO second cheerio.load!)
    const paragraphs: string[] = [];
    P_TAG_EXTRACTOR_REGEX.lastIndex = 0;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = P_TAG_EXTRACTOR_REGEX.exec(bodyHtml)) !== null) {
      const inner = pMatch[1]?.trim() ?? "";
      const textOnly = inner.replace(STRIP_TAGS_REGEX, "").trim();
      if (inner && textOnly) {
        paragraphs.push(`<p>${inner}</p>`);
      }
    }

    if (paragraphs.length === 0) {
      const blocks = bodyHtml
        .split(LINE_BREAK_BLOCK_REGEX)
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.length > 0 &&
            line.replace(STRIP_TAGS_REGEX, "").trim().length > 0
        );
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i]!;
        paragraphs.push(b.startsWith("<p>") ? b : `<p>${b}</p>`);
      }
    }

    if (paragraphs.length > 0) {
      bodyHtml = normalizeTypographyAndEntities(paragraphs.join("\n\n"));
    } else {
      bodyHtml = normalizeTypographyAndEntities(bodyHtml.trim());
    }
  } else {
    bodyHtml = bodyHtml.replace(EMPTY_P_REGEX, "").trim();
  }

  if (!bodyHtml) {
    return "<p>No chapter text available.</p>";
  }

  return bodyHtml;
}

// ============================================================================
// 5. NovelFullScraperClient
// ============================================================================

export interface HomeShelvesData {
  spotlight: Item[];
  hotNovels: Item[];
  latestReleases: Item[];
  completedMasterpieces: Item[];
  mostPopular: Item[];
}

export class NovelFullScraperClient {
  public readonly client: NetworkClient;
  private readonly novelCache = new Map<string, CachedNovelEntry>();
  private readonly inflightDetailRequests = new Map<
    string,
    Promise<NovelFullDetail>
  >();

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
      if (isCloudflareChallenge(response)) {
        throw new CloudflareError(CLOUDFLARE_RESOLUTION_URL);
      }
      return response;
    });

    this.client = builder.build();
  }

  public async configureImageRequest(
    request: NetworkRequest
  ): Promise<NetworkRequest> {
    request.headers = {
      ...IMAGE_HEADERS,
      ...(request.headers ?? {}),
      Referer: REFERER_URL,
      Origin: ORIGIN_URL,
    };
    return request;
  }

  public async fetchHtml(
    url: string,
    headers: Readonly<Record<string, string>> = DEFAULT_HEADERS
  ): Promise<string> {
    let response: NetworkResponse;
    try {
      response = await this.client.get(url, {
        headers: { ...headers },
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
        throw new CloudflareError(CLOUDFLARE_RESOLUTION_URL);
      }
      throw new Error(`Network request failed for ${url}: ${message}`);
    }

    if (isCloudflareChallenge(response)) {
      throw new CloudflareError(CLOUDFLARE_RESOLUTION_URL);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`NovelFull returned HTTP ${response.status} for ${url}`);
    }

    return typeof response.data === "string" ? response.data : "";
  }

  /**
   * Scrapes the multi-shelf home dashboard from `https://novelfull.com` and category feeds concurrently.
   */
  public async fetchHomeShelves(
    preloadedPrefs?: NovelFullUserPreferences
  ): Promise<HomeShelvesData> {
    const prefs = preloadedPrefs ?? (await getUserPreferences());

    const [
      homeHtml,
      hotHtml,
      latestHtml,
      completedHtml,
      popularHtml,
    ] = await Promise.all([
      this.fetchHtml(BASE_URL).catch(() => ""),
      this.fetchHtml(buildFeedUrl(BROWSE_FEED_KEYS.HOT_NOVEL, 1)).catch(
        () => ""
      ),
      this.fetchHtml(buildFeedUrl(BROWSE_FEED_KEYS.LATEST_RELEASES, 1)).catch(
        () => ""
      ),
      this.fetchHtml(buildFeedUrl(BROWSE_FEED_KEYS.COMPLETED_NOVELS, 1)).catch(
        () => ""
      ),
      this.fetchHtml(buildFeedUrl(BROWSE_FEED_KEYS.MOST_POPULAR, 1)).catch(
        () => ""
      ),
    ]);

    let homeSpotlightCards: NovelFullCard[] = [];
    let homeHotCards: NovelFullCard[] = [];
    let homeLatestCards: NovelFullCard[] = [];
    let homeCompletedCards: NovelFullCard[] = [];
    let homePopularCards: NovelFullCard[] = [];
    let allHomeCards: NovelFullCard[] = [];

    if (homeHtml) {
      const $home = cheerio.load(homeHtml);
      allHomeCards = parseNovelCards($home);

      const $spotlightScope = $home(
        "#intro-index, .index-intro, .featured-novel, .spotlight, .carousel"
      );
      if ($spotlightScope.length > 0) {
        homeSpotlightCards = parseNovelCards($home, $spotlightScope);
      }

      const $hotScope = $home("#intro-index, .hot-novel, .index-intro");
      if ($hotScope.length > 0) {
        homeHotCards = parseNovelCards($home, $hotScope);
      }

      const $latestScope = $home(
        "#list-index, .list-index, .latest-release, .latest-novel"
      );
      if ($latestScope.length > 0) {
        homeLatestCards = parseNovelCards($home, $latestScope);
      }

      const $completedScope = $home(
        "#truyen-slide, .MultiCarousel, .completed-novel, .novel-completed"
      );
      if ($completedScope.length > 0) {
        homeCompletedCards = parseNovelCards($home, $completedScope);
      }

      const $popularScope = $home(".most-popular, .top-novel, .popular-novel");
      if ($popularScope.length > 0) {
        homePopularCards = parseNovelCards($home, $popularScope);
      }
    }

    const hotFeedCards = hotHtml ? parseNovelCards(hotHtml) : [];
    const latestFeedCards = latestHtml ? parseNovelCards(latestHtml) : [];
    const completedFeedCards = completedHtml
      ? parseNovelCards(completedHtml)
      : [];
    const popularFeedCards = popularHtml ? parseNovelCards(popularHtml) : [];

    const effectiveHotCards =
      hotFeedCards.length > 0
        ? hotFeedCards
        : homeHotCards.length > 0
          ? homeHotCards
          : allHomeCards;

    const effectiveSpotlightCards =
      homeSpotlightCards.length > 0
        ? homeSpotlightCards
        : effectiveHotCards.slice(0, 10);

    const effectiveLatestCards =
      latestFeedCards.length > 0
        ? latestFeedCards
        : homeLatestCards.length > 0
          ? homeLatestCards
          : allHomeCards;

    const effectiveCompletedCards =
      completedFeedCards.length > 0
        ? completedFeedCards
        : homeCompletedCards.length > 0
          ? homeCompletedCards
          : allHomeCards;

    const effectivePopularCards =
      popularFeedCards.length > 0
        ? popularFeedCards
        : homePopularCards.length > 0
          ? homePopularCards
          : effectiveHotCards;

    return {
      spotlight: filterAndMapNovelCards(effectiveSpotlightCards, prefs).slice(
        0,
        10
      ),
      hotNovels: filterAndMapNovelCards(effectiveHotCards, prefs),
      latestReleases: filterAndMapNovelCards(effectiveLatestCards, prefs),
      completedMasterpieces: filterAndMapNovelCards(
        effectiveCompletedCards,
        prefs
      ),
      mostPopular: filterAndMapNovelCards(effectivePopularCards, prefs),
    };
  }

  /**
   * Fetches a paginated category feed (`Hot Novel`, `Latest Releases`, `Most Popular`, `Completed Novels`).
   * Guarantees returning `{ items: [] }` on empty results, never `null` or `undefined`.
   */
  public async fetchFeedItems(
    feedKey: string,
    page = 1,
    preloadedPrefs?: NovelFullUserPreferences,
    sortBy?: string
  ): Promise<PagedItemList> {
    const prefs = preloadedPrefs ?? (await getUserPreferences());
    const url = buildFeedUrl(feedKey, page, sortBy);

    const html = await this.fetchHtml(url);
    if (!html) {
      return { items: [], isLastPage: true };
    }

    const $ = cheerio.load(html);
    const rawCards = parseNovelCards($);
    if (rawCards.length === 0) {
      return { items: [], isLastPage: true };
    }

    const items = filterAndMapNovelCards(rawCards, prefs);
    const isLastPage = isLastListingPage($, rawCards.length);

    return {
      items,
      isLastPage,
    };
  }

  /**
   * Executes search or filtered browse queries with O(1) blacklist exclusion.
   * Guarantees returning `{ items: [] }` on empty results, never `null` or `undefined`.
   */
  public async fetchSearchResults(
    params: NovelFullExploreParams,
    preloadedPrefs?: NovelFullUserPreferences
  ): Promise<PagedItemList> {
    const prefs = preloadedPrefs ?? (await getUserPreferences());
    const url = buildSearchUrl(params);

    const html = await this.fetchHtml(url);
    if (!html) {
      return { items: [], isLastPage: true };
    }

    const $ = cheerio.load(html);
    const rawCards = parseNovelCards($);
    if (rawCards.length === 0) {
      return { items: [], isLastPage: true };
    }

    const items = filterAndMapNovelCards(rawCards, prefs, params);
    const isLastPage = isLastListingPage($, rawCards.length);

    return {
      items,
      isLastPage,
    };
  }

  /**
   * Fetches and caches parsed `NovelFullDetail` so back-to-back `getContent` and `getChapters`
   * calls share the same HTML parse without redundant network requests.
   */
  public async fetchNovelDetail(contentId: string): Promise<NovelFullDetail> {
    const slug = extractNovelId(contentId);
    if (!slug) {
      throw new Error("Invalid novel contentId.");
    }

    const now = Date.now();
    const cached = this.novelCache.get(slug);
    if (cached && now - cached.timestamp < NOVEL_CACHE_TTL_MS) {
      return cached.detail;
    }

    const inflight = this.inflightDetailRequests.get(slug);
    if (inflight) {
      return inflight;
    }

    const requestPromise = (async (): Promise<NovelFullDetail> => {
      const url = buildNovelUrl(slug);
      const html = await this.fetchHtml(url);
      const detail = parseNovelDetail(html, slug);

      if (this.novelCache.size >= NOVEL_CACHE_MAX_ENTRIES) {
        const oldestKey = this.novelCache.keys().next().value;
        if (oldestKey !== undefined) {
          this.novelCache.delete(oldestKey);
        }
      }
      this.novelCache.set(slug, {
        timestamp: Date.now(),
        detail,
      });
      return detail;
    })();

    this.inflightDetailRequests.set(slug, requestPromise);
    try {
      return await requestPromise;
    } finally {
      this.inflightDetailRequests.delete(slug);
    }
  }

  /**
   * Fetches full `Content` details for a novel.
   */
  public async fetchContent(contentId: string): Promise<Content> {
    const [prefs, detail] = await Promise.all([
      getUserPreferences(),
      this.fetchNovelDetail(contentId),
    ]);
    return mapDetailToContent(detail, prefs);
  }

  /**
   * High-velocity 1-pass chapter list loader:
   * 1. Extracts numeric `novelId` from `div#rating[data-novel-id]` on the novel page (using cache if available).
   * 2. Issues a single AJAX GET request to `https://novelfull.com/ajax-chapter-option?novelId=${novelId}`.
   * 3. Falls back to the on-page `.list-chapter` table if `novelId` is missing or the AJAX call fails.
   */
  public async fetchChapters(contentId: string): Promise<Chapter[]> {
    const slug = extractNovelId(contentId);
    const detail = await this.fetchNovelDetail(slug);

    if (detail.numericNovelId) {
      try {
        const ajaxUrl = buildAjaxChapterUrl(detail.numericNovelId);
        const ajaxHtml = await this.fetchHtml(ajaxUrl, AJAX_HEADERS);
        const ajaxEntries = parseAjaxChapterOptions(ajaxHtml, slug);
        if (ajaxEntries.length > 0) {
          return mapChapterEntriesToChapters(ajaxEntries, slug);
        }
      } catch (error) {
        if (error instanceof CloudflareError) {
          throw error;
        }
        // Fall through to on-page .list-chapter fallback
      }
    }

    return mapChapterEntriesToChapters(detail.onPageChapters, slug);
  }

  /**
   * Fetches and sanitizes a novel chapter's HTML text from `https://novelfull.com/${contentId}/${chapterId}.html`.
   */
  public async fetchChapterText(
    contentId: string,
    chapterId: string
  ): Promise<SourceChapterText> {
    const url = buildChapterUrl(contentId, chapterId);
    const [prefs, html] = await Promise.all([
      getUserPreferences(),
      this.fetchHtml(url),
    ]);

    const body = sanitizeChapterHtml(html, prefs);
    return {
      format: SourceChapterTextFormat.HTML,
      body,
      resources: [],
    };
  }
}
