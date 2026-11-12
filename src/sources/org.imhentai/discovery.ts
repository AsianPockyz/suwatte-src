import {
  type Item,
  type PagedItemList,
} from "@suwatte/toolchain";
import * as cheerio from "cheerio";
import {
  BASE_URL,
  BROWSE_FEED_KEYS,
  ContentRating,
  DEFAULT_HEADERS,
  EHENTAI_API_HEADERS,
  EHENTAI_API_URL,
  EHENTAI_BASE_URL,
  EHENTAI_BUFFER_DELAY_MS,
  EHENTAI_GALLERY_LINK_REGEX,
  EHENTAI_HEADERS,
  TARGET_DISCOVERY_YIELD,
} from "./constants.js";
import {
  buildBlacklistSet,
  buildFullLanguageQueryFlags,
  formatGalleryTitleDisplay,
  getUserPreferences,
  isCardMatchingBlacklist,
  isCardMatchingLanguage,
  isItemBlacklisted,
  normalizeCategoryToken,
} from "./preferences.js";
import { extractGalleryCardFromElement } from "./scraper.js";
import type {
  EHentaiGalleryMetadata,
  EHentaiGalleryRef,
  ImHentaiUserPreferences,
} from "./types.js";

declare const setTimeout: (handler: (...args: any[]) => void, timeout?: number) => unknown;

// Resolution cache to prevent redundant IMHentai search queries across shelves
const TITLE_RESOLUTION_CACHE = new Map<string, Item | null>();
const RESOLUTION_CACHE_MAX_ENTRIES = 250;

function cacheResolvedItem(key: string, item: Item | null): void {
  if (TITLE_RESOLUTION_CACHE.size >= RESOLUTION_CACHE_MAX_ENTRIES) {
    const oldest = TITLE_RESOLUTION_CACHE.keys().next().value;
    if (oldest !== undefined) {
      TITLE_RESOLUTION_CACHE.delete(oldest);
    }
  }
  TITLE_RESOLUTION_CACHE.set(key, item);
}

/**
 * Maps a feed key and 0-based page offset to its official E-Hentai endpoint.
 */
export function getEHentaiEndpoint(feedKey: string, offset = 0): string {
  const safeOffset = Math.max(0, offset);

  switch (feedKey) {
    case BROWSE_FEED_KEYS.POPULAR_DAILY:
      return `${EHENTAI_BASE_URL}/toplist.php?tl=11&p=${safeOffset}`;

    case BROWSE_FEED_KEYS.POPULAR_WEEKLY:
      if (safeOffset === 0) {
        return `${EHENTAI_BASE_URL}/popular`;
      }
      return `${EHENTAI_BASE_URL}/?f_sr=on&f_srdd=3&page=${safeOffset}`;

    case BROWSE_FEED_KEYS.POPULAR_MONTHLY:
      return `${EHENTAI_BASE_URL}/toplist.php?tl=12&p=${safeOffset}`;

    case BROWSE_FEED_KEYS.TOP_RATED_DAILY:
      return `${EHENTAI_BASE_URL}/?f_sr=on&f_srdd=5&page=${safeOffset}`;

    case BROWSE_FEED_KEYS.TOP_RATED_WEEKLY:
      return `${EHENTAI_BASE_URL}/?f_sr=on&f_srdd=4&page=${safeOffset}`;

    case BROWSE_FEED_KEYS.TOP_RATED_MONTHLY:
      return `${EHENTAI_BASE_URL}/?f_sr=on&f_srdd=4&page=${safeOffset}`;

    default:
      return `${EHENTAI_BASE_URL}/toplist.php?tl=11&p=${safeOffset}`;
  }
}

/**
 * Extracts unique gallery ID and token pairs from E-Hentai HTML matching: /g/(\d+)/([a-f0-9]+)/
 * Collects up to 25 [gid, token] pairs for the batch metadata API.
 */
export function extractGalleryRefs(html: string): EHentaiGalleryRef[] {
  if (!html) return [];
  const refs: EHentaiGalleryRef[] = [];
  const seenGids = new Set<number>();

  const regex = new RegExp(EHENTAI_GALLERY_LINK_REGEX.source, "gi");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const rawGid = match[1];
    const token = match[2];
    if (!rawGid || !token) continue;

    const gid = parseInt(rawGid, 10);
    if (Number.isNaN(gid) || seenGids.has(gid)) continue;

    seenGids.add(gid);
    refs.push({ gid, token });

    if (refs.length >= 25) {
      break;
    }
  }

  return refs;
}

/**
 * Queries E-Hentai's official JSON API (api.php) in a single batch request
 * to retrieve authoritative metadata (title, category, tags: string[]).
 */
export async function fetchEHentaiMetadata(
  client: NetworkClient,
  refs: readonly EHentaiGalleryRef[]
): Promise<EHentaiGalleryMetadata[]> {
  if (!refs || refs.length === 0) {
    return [];
  }

  const gidlist = refs.map((r) => [r.gid, r.token]);
  const requestBody = {
    method: "gdata",
    gidlist,
    namespace: 1,
  };

  try {
    const response = await client.post(EHENTAI_API_URL, {
      body: requestBody,
      headers: EHENTAI_API_HEADERS,
    });

    const data =
      typeof response.data === "string"
        ? JSON.parse(response.data)
        : response.data;

    if (data && Array.isArray(data.gmetadata)) {
      return data.gmetadata as EHentaiGalleryMetadata[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Normalizes an E-Hentai category name to Suwatte's canonical category identifiers.
 */
function normalizeEHentaiCategory(cat: string): string | null {
  const clean = (cat ?? "").trim().toLowerCase();
  if (clean === "doujinshi") return "doujinshi";
  if (clean === "manga") return "manga";
  if (clean === "artist cg" || clean === "image set") return "artistcg";
  if (clean === "game cg") return "gamecg";
  if (clean === "western") return "western";
  if (clean === "cosplay") return "cosplay";
  return normalizeCategoryToken(clean);
}

/**
 * Evaluates whether an E-Hentai gallery metadata entry passes:
 * 1. True Tag Blacklist ($O(1)$) and Trope Exclusions
 * 2. Enabled content category filter
 * (Language filtering is anchored directly to IMHentai query resolution)
 */
export function evaluateGalleryMetadata(
  meta: EHentaiGalleryMetadata,
  prefs: ImHentaiUserPreferences,
  blacklistSet: ReadonlySet<string>
): boolean {
  if (!meta || !Array.isArray(meta.tags)) {
    return false;
  }

  // 1. True Tag Blacklist & Heavy Trope Exclusions Check (O(1)):
  if (isItemBlacklisted(meta.tags, blacklistSet)) {
    return false;
  }

  // 2. Category Filter Gate:
  if (Array.isArray(prefs.categories) && prefs.categories.length > 0) {
    const canonicalCat = normalizeEHentaiCategory(meta.category);
    if (canonicalCat && !prefs.categories.includes(canonicalCat as any)) {
      return false;
    }
  }

  return true;
}

/**
 * Sanitizes an E-Hentai title by stripping bracketed noise, convention indicators,
 * and scanning tags to isolate the core title and maximize hits on IMHentai search.
 */
export function sanitizeSearchTitle(title: string): string {
  if (!title) return "";

  // 1. Strip common language tags and scanning metadata
  let cleaned = title
    .replace(
      /\[(?:english|translated|digital|colorized|decensored|uncensored|raw|ongoing|incomplete|dl(?:site)?|fanza|comic\s*market\s*\d*|comic1[^\)]*|reitaisai[^\)]*)[^\]]*\]/gi,
      " "
    )
    .replace(
      /\((?:c\d+|comic1[^\)]*|reitaisai[^\)]*|fanza|dlsite|m3[^\)]*)[^\)]*\)/gi,
      " "
    );

  // 2. Remove all convention brackets [ ... ] and ( ... )
  const outsideBrackets = cleaned
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^\)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (outsideBrackets.length >= 3) {
    return outsideBrackets;
  }

  // 3. Fallback: if entire title was in brackets, strip bracket symbols only
  const fallback = cleaned
    .replace(/[\[\]\(\)]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return fallback || title.trim();
}

/**
 * Resolves a clean title against IMHentai's native search engine with strict language flags:
 * https://imhentai.xxx/search/?key=${encodeURIComponent(cleanTitle)}&apply=Search&en=1&jp=0...
 * Extracts the first matching .thumb card and maps to a Suwatte Item.
 */
export async function resolveTitleOnIMHentai(
  client: NetworkClient,
  searchTitle: string,
  prefs: ImHentaiUserPreferences,
  blacklistSet: ReadonlySet<string>,
  japaneseTitle?: string
): Promise<Item | null> {
  const trimmed = searchTitle.trim();
  if (!trimmed) {
    return null;
  }

  const cacheKey = `${trimmed.toLowerCase()}|${prefs.language}`;
  if (TITLE_RESOLUTION_CACHE.has(cacheKey)) {
    return TITLE_RESOLUTION_CACHE.get(cacheKey) ?? null;
  }

  // Strict language filtering anchored directly to IMHentai query engine
  const langFlags = buildFullLanguageQueryFlags(prefs.language);
  const searchUrl = `${BASE_URL}/search/?key=${encodeURIComponent(
    trimmed
  )}&apply=Search${langFlags}`;

  try {
    const response = await client.get(searchUrl, {
      headers: DEFAULT_HEADERS,
    });

    const html =
      typeof response.data === "string"
        ? response.data
        : String(response.data ?? "");

    if (!html || !html.includes("thumb")) {
      cacheResolvedItem(cacheKey, null);
      return null;
    }

    const $ = cheerio.load(html);
    const $thumbs = $(".thumb");
    if ($thumbs.length === 0) {
      cacheResolvedItem(cacheKey, null);
      return null;
    }

    let matchedItem: Item | null = null;

    // Scan thumbnails for the best language-matching card
    for (let i = 0; i < $thumbs.length; i++) {
      const $thumb = $($thumbs[i]);
      const card = extractGalleryCardFromElement($thumb, $);
      if (!card || !card.id) continue;

      // Verify language alignment and blacklist compliance on IMHentai card
      if (!isCardMatchingLanguage(card, prefs.language)) {
        continue;
      }
      if (isCardMatchingBlacklist(card, blacklistSet)) {
        continue;
      }

      const display = formatGalleryTitleDisplay(
        card.title,
        card.japaneseTitle || japaneseTitle,
        prefs
      );

      matchedItem = {
        id: card.id,
        title: display.title,
        subtitle: display.subtitle ?? card.subtitle,
        coverImage: card.thumbnailUrl,
        webUrl: `${BASE_URL}/gallery/${card.id}/`,
        rating: ContentRating.ADULT,
      };
      break;
    }

    cacheResolvedItem(cacheKey, matchedItem);
    return matchedItem;
  } catch {
    cacheResolvedItem(cacheKey, null);
    return null;
  }
}

/**
 * Throttled Sequential Buffer Loop:
 * Pre-scans E-Hentai rankings sequentially across page_buffer_depth pages
 * and resolves titles against IMHentai until TARGET_YIELD (15 items) is reached.
 */
export async function fetchEHentaiFeedItems(
  client: NetworkClient,
  feedKey: string,
  page: number,
  prefs?: ImHentaiUserPreferences
): Promise<PagedItemList> {
  const resolvedPrefs = prefs ?? (await getUserPreferences());
  const blacklistSet = buildBlacklistSet(
    resolvedPrefs.tropeExclusions,
    resolvedPrefs.customBlacklist
  );

  // Buffer Depth from preferences clamped between 1 and 3
  const rawDepth = parseInt(resolvedPrefs.bufferDepth || "2", 10);
  const bufferDepth = Number.isNaN(rawDepth)
    ? 2
    : Math.min(3, Math.max(1, rawDepth));

  const safePage = Math.max(1, page || 1);
  const baseOffset = (safePage - 1) * bufferDepth;

  const items: Item[] = [];
  const seenIds = new Set<string>();

  for (let b = 0; b < bufferDepth; b++) {
    const currentOffset = baseOffset + b;
    const endpoint = getEHentaiEndpoint(feedKey, currentOffset);

    let html = "";
    try {
      const response = await client.get(endpoint, {
        headers: EHENTAI_HEADERS,
      });
      html =
        typeof response.data === "string"
          ? response.data
          : String(response.data ?? "");
    } catch {
      // Continue to next buffer page if one fails
      continue;
    }

    const refs = extractGalleryRefs(html);
    if (refs.length > 0) {
      const metadataList = await fetchEHentaiMetadata(client, refs);

      // Evaluate E-Hentai tags against trope exclusions and custom tag blacklist
      const surviving = metadataList.filter((m) =>
        evaluateGalleryMetadata(m, resolvedPrefs, blacklistSet)
      );

      if (surviving.length > 0) {
        // Concurrently resolve surviving titles against IMHentai with strict language flags
        const resolvePromises = surviving.map((meta) => {
          const searchTitle = sanitizeSearchTitle(meta.title);
          if (!searchTitle) return Promise.resolve(null);
          return resolveTitleOnIMHentai(
            client,
            searchTitle,
            resolvedPrefs,
            blacklistSet,
            meta.title_jpn
          );
        });

        const resolved = await Promise.all(resolvePromises);
        for (let j = 0; j < resolved.length; j++) {
          const it = resolved[j];
          if (it && it.id && !seenIds.has(it.id)) {
            seenIds.add(it.id);
            items.push(it);
          }
        }
      }
    }

    // Break early if target card yield is achieved
    if (items.length >= TARGET_DISCOVERY_YIELD) {
      break;
    }

    // Server-friendly inter-page pacing delay before next buffer pass
    if (b < bufferDepth - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, EHENTAI_BUFFER_DELAY_MS)
      );
    }
  }

  return {
    items,
    isLastPage: items.length === 0,
  };
}
