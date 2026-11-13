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
  cleanAndDeduplicateTitle,
  cleanTitle,
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
  CLOUDFLARE_RESOLUTION_URL,
  ContentRating,
  DEFAULT_HEADERS,
  DEFAULT_SYNOPSIS_FALLBACK,
  FALLBACK_COVER_URL,
  IMAGE_HEADERS,
  INLINE_NOVEL_ID_REGEX,
  ORIGIN_URL,
  RATE_LIMIT_PER_SECOND,
  REFERER_URL,
  SURGICAL_AD_DOM_SELECTOR,
  TLN_BRACKET_REGEX,
  VALID_HTML_TAGS,
  VOLUME_NUMBER_REGEX,
  WATERMARK_PATTERNS,
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

const CHAPTER_CONTAINER_START_REGEX =
  /<(?:div|section|article)\b[^>]*(?:id\s*=\s*["'](?:chapter-content|chr-content)["']|class\s*=\s*["'][^"']*\b(?:chapter-c|chr-c|chapter-content|desc-text)\b)[^>]*>/i;
const DESC_FALLBACK_START_REGEX =
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bdesc\b[^"']*>/i;
const STRIP_TAGS_REGEX = /<[^>]+>/g;
const INLINE_ON_HANDLER_REGEX =
  /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const EMPTY_P_REGEX = /<p>(?:\s|&nbsp;|\u00a0|<br\s*\/?>)*<\/p>/gi;
const HTML_COMMENTS_REGEX = /<!--[\s\S]*?-->/g;
const BLOCK_BOUNDARY_REGEX =
  /<\/?(?:p|div|center|blockquote|section|article|h[1-6]|hr)\b[^>]*>|<br\s*\/?>|\r?\n/gi;
const HORIZONTAL_SPACE_COLLAPSE_REGEX = /[ \t]{2,}/g;
const STANDALONE_NAV_LEAK_REGEX =
  /^(?:prev(?:ious)?\s+chapter|next\s+chapter|table\s+of\s+contents)$/i;

const DUPLICATE_CHAPTER_HEADER_REGEX =
  /^(?:(?:volume|vol\.?|book)\s+\d+[\s,:;\-–—]*)?(?:(?:chapter|ch\.?|episode|ep\.?)\s*\d+(?:[.,]\d+)?(?:\s*[:\-–—|]\s*\S.*)?|c\.?\s*\d+(?:\.\d+)?\s*[:\-–—]\s*\S.*)$/i;
const LEADING_CHAPTER_TITLE_REGEX =
  /^(?:(?:volume|vol\.?|book)\s+\d+[\s,:;\-–—]*)?(?:chapter|ch\.?|c\.?)\s*\d+(?:,\d{3})*(?:\.\d+)?/i;
const LEADING_CHAPTER_TITLE_WITH_SEP_REGEX =
  /^((?:(?:volume|vol\.?|book)\s+\d+[\s,:;\-–—]*)?(?:chapter|ch\.?|c\.?)\s*\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*([:\-–—|])\s*|\s+)([\s\S]*)$/i;
const LEADING_INLINE_TAG_HEADER_REGEX =
  /^<(?:b|strong|em|i|span)\b[^>]*>([\s\S]*?)<\/(?:b|strong|em|i|span)>\s*([\s\S]*)$/i;
const CHAPTER_TITLE_MARKERS: readonly string[] = [
  'class="chapter-title"',
  "class='chapter-title'",
  'class="chapter-title ',
  "class='chapter-title ",
];
const CHAPTER_TITLE_CLASS_REGEX =
  /<([a-z0-9]+)\b[^>]*\bclass\s*=\s*(?:"[^"]*\bchapter-title\b[^"]*"|'[^']*\bchapter-title\b[^']*')[^>]*>/i;
const TITLE_ATTR_REGEX = /\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const SENTENCE_END_BEFORE_PROSE_REGEX =
  /([.!?…])(["”'’]?)\s+([A-Z“"'‘\[&])/g;
const ABBREV_END_REGEX =
  /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Ch|Vol|No|Ep|Pt)\.$/i;
const WORD_SCAN_REGEX = /\S+/g;
const STRAY_AMP_REGEX =
  /&(?!(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);)/gi;
const TITLE_CONNECTORS_SET: ReadonlySet<string> = new Set([
  "of",
  "the",
  "a",
  "an",
  "in",
  "on",
  "at",
  "to",
  "for",
  "and",
  "or",
  "nor",
  "but",
  "by",
  "with",
  "from",
  "as",
  "into",
  "onto",
  "upon",
  "vs",
  "v",
]);
const NON_TITLE_PROSE_STARTERS_SET: ReadonlySet<string> = new Set([
  "of",
  "was",
  "is",
  "are",
  "were",
  "had",
  "has",
  "have",
  "will",
  "would",
  "could",
  "should",
  "shall",
  "can",
  "may",
  "might",
  "must",
  "and",
  "but",
  "or",
  "nor",
  "so",
  "yet",
  "that",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "where",
  "while",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "on",
  "to",
  "with",
  "about",
  "after",
  "before",
  "during",
  "through",
  "until",
  "since",
  "became",
  "ended",
  "began",
  "started",
  "continued",
  "remained",
  "turned",
  "made",
  "took",
  "gave",
  "went",
  "came",
]);
const SCENE_BREAK_REGEX =
  /^(?:\*(?:\s*\*){2,}|-(?:\s*-){2,}|~(?:\s*~){2,}|=(?:\s*=){2,}|o0o|0o0)$/i;
const CALLOUT_BRACKET_REGEX = /^\[[^\]]{3,160}\]$/;
const CALLOUT_RAW_ANGLE_REGEX = /^<[^>]{2,160}>$/;
const STAT_PIPE_REGEX = /\|.*\|/;
const STAT_HEADER_REGEX =
  /^(?:Name|Level|Realm|HP|MP|Class|Title)\s*:/i;

const BACK_TO_BACK_QUOTE_SPLIT_REGEX =
  /([.!?…]["”'’](?:<\/(?:span|em|i|b|strong|u)>)?)\s+((?:<(?:span|em|i|b|strong|u)(?:\s+[^>]*)?>)?["“'‘])/g;
const BACK_TO_BACK_TELEPATHY_SPLIT_REGEX =
  /([.!?…]["”'’]?&gt;)\s+(&lt;[^&]|["“'‘][A-Za-z0-9])/g;
const QUOTE_TO_TELEPATHY_SPLIT_REGEX =
  /([.!?…]["”'’])\s+(&lt;[A-Za-z0-9“"'‘])/g;
const LONG_DIALOGUE_BEAT_SPLIT_REGEX =
  /([.!?…,]["”']\s+[^"“”<>\n]{2,160}?[.!?…])\s+(["“'][A-Z])/g;

const HTML_TAG_OR_ENTITY_REGEX = /(<[^>]+>|&[a-zA-Z0-9#]+;)/g;
const DOUBLE_HYPHEN_REGEX = /---?/g;
const TRIPLE_DOT_REGEX = /\.\.\./g;

const ANGLE_BRACKET_PAIR_REGEX = /<([^<>]+)>/g;
const CLOSING_HTML_TAG_REGEX = /^\/\s*([a-zA-Z][a-zA-Z0-9]*)\s*$/;
const OPENING_HTML_TAG_REGEX =
  /^([a-zA-Z][a-zA-Z0-9]*)(?:\s+([\s\S]*?))?\s*\/?$/;
const SINGLE_LETTER_HTML_TAGS: ReadonlySet<string> = new Set([
  "a",
  "b",
  "i",
  "p",
  "s",
  "u",
]);
const VALID_HTML_ATTRS_REGEX =
  /^(?:[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?(?:\s+|$))+$/;
const UNCLOSED_OPEN_BRACKET_REGEX = /<(?![^<>]*>)/g;

const EXPLICIT_CHAPTER_MARKER_REGEX =
  /(?:\b(?:chapter|ch\.?)|^c\.?)\s*(\d+(?:\.\d+)?)/i;
const LEADING_CHAPTER_NUMBER_REGEX = /^(\d+(?:\.\d+)?)\s*[:\-\.]/;
const URL_CHAPTER_NUMBER_REGEX = /(?:chapter|ch)[-_](\d+(?:[\.-]\d+)?)/i;
const STANDALONE_NUMBER_REGEX = /\b(\d+(?:\.\d+)?)\b/;

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
 * Bulletproof Comma-Safe Chapter Number Parsing:
 * Multi-stage chapter number extraction handling comma-separated values (e.g. Chapter 1,000).
 */
export function parseChapterNumber(
  title: string,
  rawUrl: string,
  fallbackIdx = 0
): number {
  // Strip thousands commas before inspecting title ("Chapter 1,000: Battle" -> "Chapter 1000: Battle")
  const cleanTitle = (title ?? "").replace(/,/g, "").trim();

  // Priority 1: Explicit chapter markers in title so "Chapter 10: 2 Years Later" parses as 10
  const explicitMatch = EXPLICIT_CHAPTER_MARKER_REGEX.exec(cleanTitle);
  if (explicitMatch?.[1]) {
    const val = parseFloat(explicitMatch[1]);
    if (Number.isFinite(val)) return val;
  }

  // Priority 2: Leading digits in title ("1000: Title", "1541 - 911: Return")
  const leadMatch = LEADING_CHAPTER_NUMBER_REGEX.exec(cleanTitle);
  if (leadMatch?.[1]) {
    const val = parseFloat(leadMatch[1]);
    if (Number.isFinite(val)) return val;
  }

  // Priority 3: URL slug fallback for non-numeric titles ("Prologue" + /chapter-1-slug.html)
  const urlMatch = URL_CHAPTER_NUMBER_REGEX.exec(rawUrl ?? "");
  if (urlMatch?.[1]) {
    const val = parseFloat(urlMatch[1].replace("-", "."));
    if (Number.isFinite(val)) return val;
  }

  // Priority 4: Any standalone number in title
  const anyNum = STANDALONE_NUMBER_REGEX.exec(cleanTitle);
  if (anyNum?.[1]) {
    const val = parseFloat(anyNum[1]);
    if (Number.isFinite(val)) return val;
  }

  return typeof fallbackIdx === "number" && Number.isFinite(fallbackIdx)
    ? fallbackIdx
    : 0;
}

/**
 * Parses optional volume number from chapter title or URL slug.
 */
export function parseVolumeNumber(
  title: string,
  rawUrl: string
): number | undefined {
  const volMatch =
    VOLUME_NUMBER_REGEX.exec(title) ?? VOLUME_NUMBER_REGEX.exec(rawUrl);
  if (volMatch?.[1]) {
    const parsedVol = parseInt(volMatch[1], 10);
    if (Number.isFinite(parsedVol) && parsedVol > 0) {
      return parsedVol;
    }
  }
  return undefined;
}

export const extractChapterNumber = parseChapterNumber;

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
    const number = parseChapterNumber(title, rawVal || chapterId, idx + 1);
    const volume = parseVolumeNumber(title, rawVal || chapterId);
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
      const number = parseChapterNumber(title, rawVal || chapterId, i + 1);
      const volume = parseVolumeNumber(title, rawVal || chapterId);
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
    const number = parseChapterNumber(title, href, idx + 1);
    const volume = parseVolumeNumber(title, href);
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
 * Ensures array is returned in standard descending order (Atsumaru blueprint):
 * [Latest Chapter ... Chapter 1] with sequential index 0..N-1.
 */
export function mapChapterEntriesToChapters(
  entries: readonly NovelFullChapterEntry[],
  novelSlug: string
): Chapter[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const cleanNovelSlug = extractNovelId(novelSlug);
  const seenIds = new Set<string>();
  const indexedEntries: Array<{ chapter: Chapter; origIdx: number }> = [];

  for (let i = 0, len = entries.length; i < len; i++) {
    const entry = entries[i];
    if (!entry) continue;

    const rawId = entry.chapterId || entry.id || "";
    const chapterId =
      extractChapterId(rawId, cleanNovelSlug) || String(entry.id || "").trim();
    if (!chapterId || seenIds.has(chapterId)) continue;
    seenIds.add(chapterId);

    const parsedNumber =
      typeof entry.number === "number" &&
      Number.isFinite(entry.number) &&
      entry.number >= 0
        ? entry.number
        : parseChapterNumber(entry.title || "", rawId, i + 1);
    const chapterNumber =
      Number.isFinite(parsedNumber) && parsedNumber >= 0 ? parsedNumber : i + 1;

    const webUrl = entry.webUrl || buildChapterUrl(cleanNovelSlug, chapterId);
    const chapter: Chapter = {
      id: chapterId,
      index: 0,
      number: chapterNumber,
      title: entry.title || `Chapter ${chapterNumber}`,
      language: "en",
      webUrl,
      ...(entry.date ? { date: entry.date } : {}),
      data: {
        chapterId,
        contentId: cleanNovelSlug,
        webUrl,
      },
    };

    if (
      typeof entry.volume === "number" &&
      Number.isFinite(entry.volume) &&
      entry.volume > 0
    ) {
      chapter.volume = entry.volume;
    }

    indexedEntries.push({ chapter, origIdx: i });
  }

  // 1. Sort descending: Highest chapter number first (Atsumaru blueprint),
  // breaking ties deterministically by original chronological order.
  indexedEntries.sort((a, b) => {
    if (b.chapter.number !== a.chapter.number) {
      return b.chapter.number - a.chapter.number;
    }
    return b.origIdx - a.origIdx;
  });

  // 2. Assign sequential indices 0..N-1 in a single pass
  const chapters = new Array<Chapter>(indexedEntries.length);
  for (let idx = 0, len = indexedEntries.length; idx < len; idx++) {
    const ch = indexedEntries[idx]!.chapter;
    ch.index = idx;
    chapters[idx] = ch;
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
  const ogTitle = $("meta[property='og:title']").attr("content")?.trim() || "";
  const domTitle = $("h3.title").first().text().trim();

  const rawTitle = ogTitle || domTitle || id.replace(/-/g, " ");
  const title =
    cleanTitle(decodeHtmlEntities(rawTitle)) ||
    id.replace(/-/g, " ") ||
    "Untitled Novel";

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
    title: cleanAndDeduplicateTitle(detail.title),
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

const CHAPTER_CONTAINER_MARKERS: readonly string[] = [
  'id="chapter-content"',
  "id='chapter-content'",
  'id="chr-content"',
  "id='chr-content'",
  'class="chapter-c"',
  "class='chapter-c'",
  'class="chapter-c ',
  "class='chapter-c ",
];

function extractContainerTagName(
  html: string,
  openTagStart: number
): "div" | "section" | "article" | null {
  const prefix = html.slice(openTagStart + 1, openTagStart + 9).toLowerCase();
  if (prefix.startsWith("div")) {
    const ch = prefix.charCodeAt(3);
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 62) {
      return "div";
    }
  } else if (prefix.startsWith("section")) {
    const ch = prefix.charCodeAt(7);
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 62) {
      return "section";
    }
  } else if (prefix.startsWith("article")) {
    const ch = prefix.charCodeAt(7);
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 62) {
      return "article";
    }
  }
  return null;
}

/**
 * Extracts raw chapter body fragment from the full HTML page using fast `indexOf` slicing,
 * avoiding full-document DOM parsing of headers, navbars, scripts, and footers.
 */
function extractChapterFragment(html: string): string {
  let earliestMarkerIdx = -1;
  for (let i = 0; i < CHAPTER_CONTAINER_MARKERS.length; i++) {
    const idx = html.indexOf(CHAPTER_CONTAINER_MARKERS[i]!);
    if (idx !== -1 && (earliestMarkerIdx === -1 || idx < earliestMarkerIdx)) {
      earliestMarkerIdx = idx;
    }
  }

  if (earliestMarkerIdx !== -1) {
    const openTagStart = html.lastIndexOf("<", earliestMarkerIdx);
    const openTagEnd = html.indexOf(">", earliestMarkerIdx);
    if (openTagStart !== -1 && openTagEnd !== -1 && openTagStart < earliestMarkerIdx) {
      const tagName = extractContainerTagName(html, openTagStart);
      if (tagName) {
        return extractElementSliceByIndexOf(html, openTagEnd + 1, tagName);
      }
    }
  }

  const startMatch = CHAPTER_CONTAINER_START_REGEX.exec(html);
  if (startMatch) {
    const startIndex = startMatch.index + startMatch[0].length;
    const tagName = extractContainerTagName(html, startMatch.index) ?? "div";
    return extractElementSliceByIndexOf(html, startIndex, tagName);
  }

  const descMatch = DESC_FALLBACK_START_REGEX.exec(html);
  if (descMatch) {
    const startIndex = descMatch.index + descMatch[0].length;
    return extractElementSliceByIndexOf(html, startIndex, "div");
  }

  return html;
}

function extractElementSliceByIndexOf(
  html: string,
  startIndex: number,
  tagName: "div" | "section" | "article"
): string {
  let depth = 1;
  let cursor = startIndex;
  const len = html.length;
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}`;
  const tokenLen = openToken.length;

  while (cursor < len) {
    const nextClose = html.indexOf(closeToken, cursor);
    if (nextClose === -1) {
      break;
    }

    const nextOpen = html.indexOf(openToken, cursor);
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const afterCode = html.charCodeAt(nextOpen + tokenLen);
      if (
        afterCode === 32 ||
        afterCode === 62 ||
        afterCode === 9 ||
        afterCode === 10 ||
        afterCode === 13 ||
        afterCode === 47
      ) {
        const tagEnd = html.indexOf(">", nextOpen + tokenLen);
        if (tagEnd === -1) {
          break;
        }
        if (tagName === "div") {
          const headerSlice = html.slice(
            nextOpen,
            Math.min(tagEnd + 1, nextOpen + 160)
          );
          if (
            headerSlice.includes('id="chapter-nav"') ||
            headerSlice.includes("id='chapter-nav'") ||
            headerSlice.includes('class="chapter-nav') ||
            headerSlice.includes("class='chapter-nav")
          ) {
            return html.slice(startIndex, nextOpen);
          }
        }
        if (html.charCodeAt(tagEnd - 1) !== 47) {
          depth++;
        }
        cursor = tagEnd + 1;
      } else {
        cursor = nextOpen + tokenLen;
      }
    } else {
      const closeEnd = html.indexOf(">", nextClose + tokenLen + 1);
      if (closeEnd === -1) {
        break;
      }
      depth--;
      if (depth === 0) {
        return html.slice(startIndex, nextClose);
      }
      cursor = closeEnd + 1;
    }
  }

  const navFallbackIdx = html.indexOf('id="chapter-nav"', startIndex);
  if (navFallbackIdx !== -1) {
    const navTagStart = html.lastIndexOf("<div", navFallbackIdx);
    if (navTagStart >= startIndex) {
      return html.slice(startIndex, navTagStart);
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

interface CheerioDomNode {
  type?: string;
  data?: string;
  children?: CheerioDomNode[];
}

function isValidHtmlTagToken(rawInner: string): boolean {
  const inner = rawInner.trim();
  if (!inner) return false;
  if (inner.startsWith("!--") && inner.endsWith("--")) return true;

  const closeMatch = CLOSING_HTML_TAG_REGEX.exec(inner);
  if (closeMatch?.[1]) {
    return VALID_HTML_TAGS.has(closeMatch[1].toLowerCase());
  }

  const openMatch = OPENING_HTML_TAG_REGEX.exec(inner);
  if (!openMatch?.[1]) return false;

  const tagName = openMatch[1].toLowerCase();
  if (!VALID_HTML_TAGS.has(tagName)) return false;

  const attrSegment = (openMatch[2] ?? "").trim();
  if (!attrSegment) return true;

  if (SINGLE_LETTER_HTML_TAGS.has(tagName) && !attrSegment.includes("=")) {
    return false;
  }

  return VALID_HTML_ATTRS_REGEX.test(attrSegment);
}

/**
 * Escapes any `<...>` sequence whose tag name is not in `VALID_HTML_TAGS` (or does not
 * have valid HTML attribute syntax) to `&lt;...&gt;` before Cheerio parses the HTML.
 */
export function escapeNonHtmlBrackets(html: string): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  let current = html;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    const next = current.replace(
      ANGLE_BRACKET_PAIR_REGEX,
      (full: string, inner: string) => {
        if (isValidHtmlTagToken(inner)) {
          return full;
        }
        changed = true;
        return `&lt;${inner}&gt;`;
      }
    );
    current = next;
    if (!changed) break;
  }

  return current.replace(UNCLOSED_OPEN_BRACKET_REGEX, "&lt;");
}

function encodeTextNodeBrackets(node: CheerioDomNode | undefined): void {
  if (!node) return;
  if (node.type === "text" && typeof node.data === "string") {
    if (node.data.includes("<") || node.data.includes(">")) {
      node.data = node.data.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    return;
  }
  const children = node.children;
  if (Array.isArray(children)) {
    for (let i = 0, len = children.length; i < len; i++) {
      encodeTextNodeBrackets(children[i]);
    }
  }
}

const OPENING_QUOTE_CHARS: ReadonlySet<string> = new Set([
  "",
  " ",
  "\t",
  "\n",
  "\r",
  "(",
  "[",
  "{",
  "/",
  ":",
  "<",
  "“",
  "‘",
  "—",
  "–",
]);

function isAlphaNumChar(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code >= 128
  );
}

function isInsideHtmlTag(str: string, offset: number): boolean {
  const lastOpen = str.lastIndexOf("<", offset);
  if (lastOpen === -1) return false;
  const lastClose = str.lastIndexOf(">", offset);
  return lastOpen > lastClose;
}

function splitSegmentWithBoundary(
  input: string,
  regex: RegExp,
  out: string[]
): void {
  regex.lastIndex = 0;
  let lastPos = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    if (isInsideHtmlTag(input, match.index)) {
      continue;
    }
    const leftGroup = match[1] ?? "";
    const rightGroup = match[2] ?? "";
    const splitAt = match.index + leftGroup.length;
    const left = input.slice(lastPos, splitAt).trim();
    if (left) {
      out.push(left);
    }
    lastPos = match.index + match[0].length - rightGroup.length;
  }
  const remainder = input.slice(lastPos).trim();
  if (remainder) {
    out.push(remainder);
  }
}

function splitDialogueBlock(block: string, plainTextLen: number): string[] {
  let parts: string[] = [block];

  const applySplitRegex = (regex: RegExp) => {
    const nextParts: string[] = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      splitSegmentWithBoundary(parts[i]!, regex, nextParts);
    }
    parts = nextParts;
  };

  if (
    block.includes('"') ||
    block.includes("”") ||
    block.includes("'") ||
    block.includes("’")
  ) {
    applySplitRegex(BACK_TO_BACK_QUOTE_SPLIT_REGEX);
  }

  if (block.includes("&gt;")) {
    applySplitRegex(BACK_TO_BACK_TELEPATHY_SPLIT_REGEX);
  }

  if (block.includes("&lt;")) {
    applySplitRegex(QUOTE_TO_TELEPATHY_SPLIT_REGEX);
  }

  if (plainTextLen > 220) {
    applySplitRegex(LONG_DIALOGUE_BEAT_SPLIT_REGEX);
  }

  return parts;
}

function isStandaloneAngleCallout(textOnly: string): boolean {
  if (
    textOnly.startsWith("&lt;") &&
    textOnly.endsWith("&gt;") &&
    textOnly.length >= 10 &&
    textOnly.length <= 168
  ) {
    return (
      textOnly.indexOf("&lt;", 4) === -1 &&
      textOnly.indexOf("&gt;", 4) === textOnly.length - 4
    );
  }
  return CALLOUT_RAW_ANGLE_REGEX.test(textOnly);
}

function isCalloutBlock(textOnly: string): boolean {
  if (CALLOUT_BRACKET_REGEX.test(textOnly)) {
    return true;
  }
  if (isStandaloneAngleCallout(textOnly)) {
    return true;
  }
  if (textOnly.length <= 260 && STAT_PIPE_REGEX.test(textOnly)) {
    return true;
  }
  if (textOnly.length <= 220 && STAT_HEADER_REGEX.test(textOnly)) {
    return true;
  }
  return false;
}

function isDuplicateChapterHeader(textOnly: string): boolean {
  return textOnly.length <= 160 && DUPLICATE_CHAPTER_HEADER_REGEX.test(textOnly);
}

/**
 * Fast `indexOf`-based extraction of the page-level `.chapter-title` fallback text
 * before slicing `#chapter-content`.
 */
export function extractPageChapterTitle(html: string): string | null {
  if (!html || typeof html !== "string") {
    return null;
  }

  let markerIdx = -1;
  for (let i = 0; i < CHAPTER_TITLE_MARKERS.length; i++) {
    const idx = html.indexOf(CHAPTER_TITLE_MARKERS[i]!);
    if (idx !== -1 && (markerIdx === -1 || idx < markerIdx)) {
      markerIdx = idx;
    }
  }

  if (markerIdx === -1) {
    const rawIdx = html.indexOf("chapter-title");
    if (rawIdx === -1) {
      return null;
    }
    const windowStart = Math.max(0, rawIdx - 120);
    const windowEnd = Math.min(html.length, rawIdx + 120);
    const match = CHAPTER_TITLE_CLASS_REGEX.exec(
      html.slice(windowStart, windowEnd)
    );
    if (!match) {
      return null;
    }
    markerIdx = windowStart + match.index;
  }

  const openTagStart = html.lastIndexOf("<", markerIdx);
  const openTagEnd = html.indexOf(">", markerIdx);
  if (openTagStart === -1 || openTagEnd === -1 || openTagEnd <= openTagStart) {
    return null;
  }

  const openTagSlice = html.slice(openTagStart + 1, openTagEnd);
  const spaceIdx = openTagSlice.search(/\s/);
  const tagName = (
    spaceIdx === -1 ? openTagSlice : openTagSlice.slice(0, spaceIdx)
  )
    .trim()
    .toLowerCase();
  if (!tagName) {
    return null;
  }

  const closeTag = `</${tagName}>`;
  const searchLimit = Math.min(html.length, openTagEnd + 1024);
  let closeIdx = html.indexOf(closeTag, openTagEnd + 1);
  if (closeIdx === -1 || closeIdx > searchLimit) {
    closeIdx = html
      .slice(openTagEnd + 1, searchLimit)
      .toLowerCase()
      .indexOf(closeTag);
    if (closeIdx !== -1) {
      closeIdx += openTagEnd + 1;
    }
  }

  let rawTitle = "";
  if (closeIdx !== -1) {
    rawTitle = html
      .slice(openTagEnd + 1, closeIdx)
      .replace(STRIP_TAGS_REGEX, " ");
  }

  let decoded = decodeHtmlEntities(rawTitle);
  if (!decoded) {
    const attrMatch = TITLE_ATTR_REGEX.exec(openTagSlice);
    const attrVal = attrMatch?.[1] ?? attrMatch?.[2] ?? "";
    decoded = decodeHtmlEntities(attrVal);
  }

  if (!decoded || decoded.length > 160) {
    return null;
  }
  return decoded;
}

function escapeChapterTitleText(
  title: string,
  isAlreadyEntitySafe: boolean,
  smartTypography: boolean
): string {
  let escaped = isAlreadyEntitySafe
    ? title
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(STRAY_AMP_REGEX, "&amp;")
    : title
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

  if (smartTypography) {
    escaped = applySmartTypographyToHtml(escaped);
  }
  return escaped.trim();
}

function formatChapterHeadingHtml(
  titleText: string,
  isAlreadyEntitySafe: boolean,
  smartTypography: boolean
): string {
  const safeTitle = escapeChapterTitleText(
    titleText,
    isAlreadyEntitySafe,
    smartTypography
  );
  return `<h2><strong>${safeTitle}</strong></h2><hr />`;
}

function sliceHtmlFromTextOffset(block: string, textOffset: number): string {
  if (!block.includes("<")) {
    return block.slice(textOffset).trim();
  }
  let pos = 0;
  let visibleCount = 0;
  const len = block.length;
  let prevSpace = true;

  while (pos < len && visibleCount < textOffset) {
    const code = block.charCodeAt(pos);
    if (code === 60) {
      const closeIdx = block.indexOf(">", pos);
      if (closeIdx === -1) break;
      pos = closeIdx + 1;
      continue;
    }
    const isSpace = code === 32 || code === 9 || code === 10 || code === 13;
    if (isSpace) {
      if (!prevSpace) {
        visibleCount++;
        prevSpace = true;
      }
      pos++;
    } else {
      prevSpace = false;
      visibleCount++;
      pos++;
    }
  }

  while (pos < len) {
    const code = block.charCodeAt(pos);
    if (code === 32 || code === 9 || code === 10 || code === 13) {
      pos++;
      continue;
    }
    if (code === 60 && block.charCodeAt(pos + 1) === 47) {
      const closeIdx = block.indexOf(">", pos);
      if (closeIdx !== -1) {
        pos = closeIdx + 1;
        continue;
      }
    }
    break;
  }

  return block.slice(pos).trim();
}

function isLowercaseWord(word: string): boolean {
  for (let i = 0; i < word.length; i++) {
    const ch = word.charAt(i);
    if (ch >= "a" && ch <= "z") return true;
    if (ch >= "A" && ch <= "Z") return false;
    if (ch >= "0" && ch <= "9") return false;
  }
  return false;
}

function stripEdgePunctuationLower(word: string): string {
  return word.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").toLowerCase();
}

interface ExtractedChapterTitleResult {
  titleText: string;
  remainderBlock: string | null;
}

function extractOrSplitLeadingChapterTitle(
  block: string,
  textOnly: string,
  fallbackTitle: string | null
): ExtractedChapterTitleResult | null {
  if (!LEADING_CHAPTER_TITLE_REGEX.test(textOnly)) {
    return null;
  }

  const partsMatch = LEADING_CHAPTER_TITLE_WITH_SEP_REGEX.exec(textOnly);
  if (!partsMatch) {
    return {
      titleText: textOnly.trim(),
      remainderBlock: null,
    };
  }

  const prefix = (partsMatch[1] ?? "").trim();
  const sep = partsMatch[2] ?? "";
  const rest = (partsMatch[3] ?? "").trim();

  if (!rest) {
    return {
      titleText: prefix,
      remainderBlock: null,
    };
  }

  const restStart = textOnly.indexOf(rest, prefix.length);

  // If no explicit separator after chapter number, reject obvious prose starters like "Chapter 3 of the manual..."
  if (!sep) {
    const firstWordMatch = /^\S+/.exec(rest);
    const firstWord = firstWordMatch?.[0] ?? "";
    const firstWordBare = stripEdgePunctuationLower(firstWord);
    if (
      rest.charAt(0) === "," ||
      rest.charAt(0) === ";" ||
      NON_TITLE_PROSE_STARTERS_SET.has(firstWordBare) ||
      isLowercaseWord(firstWord)
    ) {
      return null;
    }
  }

  // Priority 1: Inline wrapper tag around the chapter title (e.g. <strong>Chapter 2239: Title</strong> Prose...)
  if (block.charCodeAt(0) === 60) {
    const inlineMatch = LEADING_INLINE_TAG_HEADER_REGEX.exec(block);
    if (inlineMatch) {
      const innerText = (inlineMatch[1] ?? "")
        .replace(STRIP_TAGS_REGEX, "")
        .replace(ENTITIES_NBSP_REGEX, " ")
        .trim();
      const afterTag = (inlineMatch[2] ?? "").trim();
      if (
        innerText &&
        innerText.length <= 140 &&
        LEADING_CHAPTER_TITLE_REGEX.test(innerText)
      ) {
        return {
          titleText: innerText,
          remainderBlock: afterTag || null,
        };
      }
    }
  }

  // Priority 2: Exact prefix match against page-level .chapter-title fallback
  if (
    fallbackTitle &&
    textOnly.length > fallbackTitle.length &&
    textOnly.toLowerCase().startsWith(fallbackTitle.toLowerCase())
  ) {
    const afterFallback = textOnly.slice(fallbackTitle.length);
    const trimmedAfter = afterFallback.replace(/^[\s.:;\-–—|]+/, "").trim();
    if (!trimmedAfter) {
      return {
        titleText: textOnly.slice(0, fallbackTitle.length).trim(),
        remainderBlock: null,
      };
    }
    const splitOffset = textOnly.indexOf(trimmedAfter, fallbackTitle.length);
    if (splitOffset !== -1) {
      return {
        titleText: textOnly.slice(0, fallbackTitle.length).trim(),
        remainderBlock: sliceHtmlFromTextOffset(block, splitOffset),
      };
    }
  }

  // Priority 3: Sentence boundary within first 120 chars (e.g. "Chapter 2239: The Void Lord. Noah stepped forward.")
  SENTENCE_END_BEFORE_PROSE_REGEX.lastIndex = 0;
  let sentMatch: RegExpExecArray | null;
  while ((sentMatch = SENTENCE_END_BEFORE_PROSE_REGEX.exec(rest)) !== null) {
    const endPunct = sentMatch[1] ?? "";
    const endQuote = sentMatch[2] ?? "";
    const punctEndInRest = sentMatch.index + endPunct.length + endQuote.length;
    if (restStart + punctEndInRest > 130) {
      break;
    }
    const beforeBoundary = rest.slice(0, sentMatch.index + 1);
    if (endPunct === "." && ABBREV_END_REGEX.test(beforeBoundary)) {
      continue;
    }
    const nextCharInRest =
      sentMatch.index + sentMatch[0].length - (sentMatch[3]?.length ?? 1);
    const titleEndInRest =
      endPunct === "." && !endQuote
        ? sentMatch.index
        : punctEndInRest;
    const titleText = textOnly
      .slice(0, restStart + titleEndInRest)
      .trim()
      .replace(/[:\-–—|]+$/, "")
      .trim();
    return {
      titleText: titleText || prefix,
      remainderBlock: sliceHtmlFromTextOffset(block, restStart + nextCharInRest),
    };
  }

  // Priority 4: Glued quote or bracket callout starting prose after the title
  const quoteOrBracketMatch = /\s+(?=["“]|&lt;|\[)/.exec(rest);
  if (
    quoteOrBracketMatch &&
    restStart + quoteOrBracketMatch.index <= 125
  ) {
    const splitAt = restStart + quoteOrBracketMatch.index;
    const nextStart =
      splitAt + quoteOrBracketMatch[0].length;
    return {
      titleText: textOnly.slice(0, splitAt).trim(),
      remainderBlock: sliceHtmlFromTextOffset(block, nextStart),
    };
  }

  // Priority 5: Glued Title-Case title immediately before a prose sentence ("Chapter 2239: The Void Lord Noah stepped forward.")
  const hasSentenceEnding =
    /[.!?…”"'’]$/.test(textOnly) ||
    textOnly.endsWith("&gt;") ||
    textOnly.length > 90;

  if (hasSentenceEnding) {
    const tokens: Array<{
      word: string;
      bareLower: string;
      start: number;
      end: number;
    }> = [];
    WORD_SCAN_REGEX.lastIndex = 0;
    let tokMatch: RegExpExecArray | null;
    while ((tokMatch = WORD_SCAN_REGEX.exec(rest)) !== null) {
      const w = tokMatch[0];
      tokens.push({
        word: w,
        bareLower: stripEdgePunctuationLower(w),
        start: tokMatch.index,
        end: tokMatch.index + w.length,
      });
    }

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!;
      if (isLowercaseWord(tok.word) && !TITLE_CONNECTORS_SET.has(tok.bareLower)) {
        let starterIdx = i - 1;
        while (
          starterIdx > 0 &&
          TITLE_CONNECTORS_SET.has(tokens[starterIdx]!.bareLower)
        ) {
          starterIdx--;
        }

        if (starterIdx <= 0 && !sep) {
          return null;
        }

        const splitOffsetInRest =
          starterIdx >= 0 ? tokens[starterIdx]!.start : 0;
        if (restStart + splitOffsetInRest <= 130) {
          const titleRaw =
            splitOffsetInRest === 0
              ? prefix
              : textOnly.slice(0, restStart + splitOffsetInRest).trim();
          const cleanHeading = titleRaw.replace(/[:\-–—|]+$/, "").trim();
          return {
            titleText: cleanHeading || prefix,
            remainderBlock: sliceHtmlFromTextOffset(
              block,
              restStart + splitOffsetInRest
            ),
          };
        }
        break;
      }
    }
  }

  // Standalone chapter title without glued prose
  if (textOnly.length <= 140) {
    return {
      titleText: textOnly.trim(),
      remainderBlock: null,
    };
  }

  return null;
}

function normalizeHeaderForDupCheck(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatProseSegment(
  prose: string,
  initialPrevChar: string
): { formatted: string; lastChar: string } {
  if (!prose) {
    return { formatted: prose, lastChar: initialPrevChar };
  }

  let text = prose;
  if (text.includes("--")) {
    text = text.replace(DOUBLE_HYPHEN_REGEX, "—");
  }
  if (text.includes("...")) {
    text = text.replace(TRIPLE_DOT_REGEX, "…");
  }

  if (!text.includes('"') && !text.includes("'")) {
    return {
      formatted: text,
      lastChar: text.charAt(text.length - 1) || initialPrevChar,
    };
  }

  let out = "";
  let prev = initialPrevChar;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const ch = text.charAt(i);
    const next = i + 1 < len ? text.charAt(i + 1) : "";
    if (ch === '"') {
      let isOpen = false;
      if (prev === "—" || prev === "–" || prev === "-") {
        isOpen = isAlphaNumChar(next) || next === "'" || next === "‘";
      } else if (OPENING_QUOTE_CHARS.has(prev)) {
        isOpen = true;
      }
      const smart = isOpen ? "“" : "”";
      out += smart;
      prev = smart;
    } else if (ch === "'") {
      let isOpen = false;
      if (isAlphaNumChar(prev)) {
        isOpen = false;
      } else if (prev === "—" || prev === "–" || prev === "-") {
        isOpen = isAlphaNumChar(next) || next === '"' || next === "“";
      } else if (OPENING_QUOTE_CHARS.has(prev)) {
        isOpen = isAlphaNumChar(next) || next === '"' || next === "“";
      }
      const smart = isOpen ? "‘" : "’";
      out += smart;
      prev = smart;
    } else {
      out += ch;
      prev = ch;
    }
  }

  return { formatted: out, lastChar: prev };
}

/**
 * Applies smart curly quotes, em-dashes, and ellipses strictly to prose segments,
 * leaving HTML tag attributes and HTML entities (`&quot;`, `&lt;`, `&gt;`) untouched.
 */
export function applySmartTypographyToHtml(html: string): string {
  if (!html) return "";
  HTML_TAG_OR_ENTITY_REGEX.lastIndex = 0;
  let result = "";
  let lastIndex = 0;
  let prevChar = "";
  let match: RegExpExecArray | null;

  while ((match = HTML_TAG_OR_ENTITY_REGEX.exec(html)) !== null) {
    if (match.index > lastIndex) {
      const proseChunk = html.slice(lastIndex, match.index);
      const { formatted, lastChar } = formatProseSegment(proseChunk, prevChar);
      result += formatted;
      prevChar = lastChar;
    }
    const token = match[0];
    result += token;
    if (token.charCodeAt(0) === 60) {
      if (
        token.charCodeAt(1) !== 47 &&
        (!prevChar || OPENING_QUOTE_CHARS.has(prevChar))
      ) {
        prevChar = "";
      }
    } else if (token === "&lt;") {
      prevChar = "<";
    } else if (token === "&gt;") {
      prevChar = ">";
    } else if (token === "&nbsp;") {
      prevChar = " ";
    } else if (token === "&mdash;") {
      prevChar = "—";
    } else if (token === "&ndash;") {
      prevChar = "–";
    } else {
      prevChar = "a";
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < html.length) {
    result += formatProseSegment(html.slice(lastIndex), prevChar).formatted;
  }

  return result;
}

/**
 * High-Performance Chapter Text Sanitization & Typography Pipeline for `getChapterText()`.
 * 1. Fast `indexOf` fragment extraction (skips 100KB+ of navbar/footer DOM).
 * 2. Escapes non-HTML `<...>` brackets before Cheerio parses so dialogue is never swallowed.
 * 3. Surgical Cheerio DOM removal for ad/script nodes only (preserves centered & span prose).
 * 4. Re-encodes literal `<` and `>` inside text nodes as `&lt;`/`&gt;` for Suwatte's HTML reader.
 * 5. Single-pass reader formatting: duplicate header removal, paragraph normalization,
 *    multi-speaker dialogue splitting, system/telepathy/stat callouts, and smart typography.
 */
export function sanitizeChapterHtml(
  rawHtml: string,
  prefs?: Partial<NovelFullUserPreferences>
): string {
  if (!rawHtml || typeof rawHtml !== "string") {
    return "<p>No chapter text available.</p>";
  }

  const styleChapterHeader = prefs?.styleChapterHeader !== false;
  const sanitizeAds = prefs?.sanitizeAds !== false;
  const formatTln = prefs?.formatTln !== false;
  const normalizeSpacing = prefs?.normalizeSpacing !== false;
  const splitDialogue = prefs?.splitDialogue !== false;
  const formatCallouts = prefs?.formatCallouts !== false;
  const smartTypography = prefs?.smartTypography !== false;

  // 1. Fast page-level .chapter-title fallback extraction & indexOf slice of #chapter-content
  const fallbackChapterTitle = styleChapterHeader
    ? extractPageChapterTitle(rawHtml)
    : null;
  const rawFragment = extractChapterFragment(rawHtml);
  const withoutComments = rawFragment.replace(HTML_COMMENTS_REGEX, "");
  const escapedHtml = escapeNonHtmlBrackets(withoutComments);

  // 2. Parse only the isolated chapter fragment (avoids full 100KB+ document tree)
  const $ = cheerio.load(`<div id="nf-frag">${escapedHtml}</div>`);
  const $container = $("#nf-frag");

  // Always strip executable/unsafe elements; when sanitizeAds is enabled, remove surgical ad selectors only
  $container.find("script, style, iframe, noscript").remove();
  if (sanitizeAds) {
    $container.find(SURGICAL_AD_DOM_SELECTOR).remove();
  }

  // Keep literal < and > inside prose encoded as &lt; / &gt; when serializing back to HTML
  encodeTextNodeBrackets($container[0] as unknown as CheerioDomNode);

  let bodyHtml = ($container.html() ?? "").replace(INLINE_ON_HANDLER_REGEX, "");

  if (sanitizeAds) {
    bodyHtml = stripAggregatorWatermarks(bodyHtml);
  }

  if (normalizeSpacing || smartTypography) {
    bodyHtml = normalizeTypographyAndEntities(bodyHtml);
  }

  if (formatTln) {
    bodyHtml = formatTranslatorNotes(bodyHtml);
  }

  if (normalizeSpacing) {
    const rawBlocks = bodyHtml.split(BLOCK_BOUNDARY_REGEX);
    const outputBlocks: string[] = [];
    let checkedLeadingHeader = false;
    let checkedDuplicateSecond = false;
    let extractedHeaderNorm: string | null = null;

    for (let i = 0, len = rawBlocks.length; i < len; i++) {
      let block = rawBlocks[i]
        ?.replace(HORIZONTAL_SPACE_COLLAPSE_REGEX, " ")
        .trim();
      if (!block) continue;

      let textOnly = block
        .replace(STRIP_TAGS_REGEX, "")
        .replace(ENTITIES_NBSP_REGEX, " ")
        .trim();
      if (!textOnly) continue;

      if (sanitizeAds && STANDALONE_NAV_LEAK_REGEX.test(textOnly)) {
        continue;
      }

      if (!checkedLeadingHeader) {
        checkedLeadingHeader = true;
        if (styleChapterHeader) {
          const splitHeader = extractOrSplitLeadingChapterTitle(
            block,
            textOnly,
            fallbackChapterTitle
          );
          if (splitHeader) {
            outputBlocks.push(
              formatChapterHeadingHtml(
                splitHeader.titleText,
                true,
                smartTypography
              )
            );
            extractedHeaderNorm = normalizeHeaderForDupCheck(
              splitHeader.titleText
            );
            if (!splitHeader.remainderBlock) {
              continue;
            }
            block = splitHeader.remainderBlock
              .replace(HORIZONTAL_SPACE_COLLAPSE_REGEX, " ")
              .trim();
            textOnly = block
              .replace(STRIP_TAGS_REGEX, "")
              .replace(ENTITIES_NBSP_REGEX, " ")
              .trim();
            if (!textOnly) {
              continue;
            }
            checkedDuplicateSecond = true;
          } else if (fallbackChapterTitle) {
            outputBlocks.push(
              formatChapterHeadingHtml(
                fallbackChapterTitle,
                false,
                smartTypography
              )
            );
            extractedHeaderNorm =
              normalizeHeaderForDupCheck(fallbackChapterTitle);
          }
        }
      } else if (!checkedDuplicateSecond) {
        checkedDuplicateSecond = true;
        if (
          styleChapterHeader &&
          extractedHeaderNorm &&
          (normalizeHeaderForDupCheck(textOnly) === extractedHeaderNorm ||
            isDuplicateChapterHeader(textOnly))
        ) {
          continue;
        }
      }

      if (smartTypography && SCENE_BREAK_REGEX.test(textOnly)) {
        outputBlocks.push("<hr />");
        continue;
      }

      const subBlocks = splitDialogue
        ? splitDialogueBlock(block, textOnly.length)
        : [block];

      for (let j = 0, subLen = subBlocks.length; j < subLen; j++) {
        const sub = subBlocks[j]!;
        const subTextOnly =
          subLen === 1
            ? textOnly
            : sub
                .replace(STRIP_TAGS_REGEX, "")
                .replace(ENTITIES_NBSP_REGEX, " ")
                .trim();
        if (!subTextOnly) continue;

        if (smartTypography && SCENE_BREAK_REGEX.test(subTextOnly)) {
          outputBlocks.push("<hr />");
          continue;
        }

        const formattedSub = smartTypography
          ? applySmartTypographyToHtml(sub)
          : sub;

        if (formatCallouts && isCalloutBlock(subTextOnly)) {
          outputBlocks.push(`<blockquote><p>${formattedSub}</p></blockquote>`);
        } else {
          outputBlocks.push(`<p>${formattedSub}</p>`);
        }
      }
    }

    bodyHtml = outputBlocks.join("\n\n");
  } else {
    bodyHtml = bodyHtml.replace(EMPTY_P_REGEX, "").trim();
    if (smartTypography) {
      bodyHtml = applySmartTypographyToHtml(bodyHtml);
    }
    if (styleChapterHeader && fallbackChapterTitle && bodyHtml) {
      const leadingPlain = bodyHtml
        .slice(0, 200)
        .replace(STRIP_TAGS_REGEX, "")
        .trim();
      if (!LEADING_CHAPTER_TITLE_REGEX.test(leadingPlain)) {
        bodyHtml = `${formatChapterHeadingHtml(fallbackChapterTitle, false, smartTypography)}\n\n${bodyHtml}`;
      }
    }
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
    const content = mapDetailToContent(detail, prefs);
    content.title = cleanTitle(content.title);
    return content;
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

    let chapters: Chapter[] = [];
    if (detail.numericNovelId) {
      try {
        const ajaxUrl = buildAjaxChapterUrl(detail.numericNovelId);
        const ajaxHtml = await this.fetchHtml(ajaxUrl, AJAX_HEADERS);
        const ajaxEntries = parseAjaxChapterOptions(ajaxHtml, slug);
        if (ajaxEntries.length > 0) {
          chapters = mapChapterEntriesToChapters(ajaxEntries, slug);
        }
      } catch (error) {
        if (error instanceof CloudflareError) {
          throw error;
        }
        // Fall through to on-page .list-chapter fallback
      }
    }

    if (chapters.length === 0) {
      chapters = mapChapterEntriesToChapters(detail.onPageChapters, slug);
    }

    return chapters;
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

export { cleanAndDeduplicateTitle, cleanTitle };
