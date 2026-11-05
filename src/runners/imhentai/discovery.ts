import {
  type Item,
  NetworkClientBuilder,
  type NetworkRequest,
  type PagedItemList,
} from "@suwatte/toolchain";
import * as cheerio from "cheerio";
import {
  BASE_URL,
  BROWSE_FEED_KEYS,
  ContentRating,
  DEFAULT_HEADERS,
  DEFAULT_USER_AGENT,
  EHENTAI_API_HEADERS,
  EHENTAI_API_URL,
  EHENTAI_BASE_URL,
  EHENTAI_GALLERY_LINK_REGEX,
  EHENTAI_HEADERS,
} from "./constants.js";
import {
  buildBlacklistSet,
  decodeHtmlEntities,
  formatGalleryTitleDisplay,
  getUserPreferences,
  isItemBlacklisted,
  normalizeCategoryToken,
  normalizeLanguageToken,
} from "./preferences.js";
import { extractGalleryCardFromElement } from "./scraper.js";
import type {
  EHentaiGalleryMetadata,
  EHentaiGalleryRef,
  ImHentaiUserPreferences,
} from "./types.js";

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
 * Maps a feed key and page number to its official E-Hentai endpoint.
 */
export function getEHentaiEndpoint(
  feedKey: string,
  page: number,
  isEnglishPreferred = true
): string {
  const safePage = Math.max(1, page || 1);
  const pIndex = safePage - 1;
  const langSearch = isEnglishPreferred ? "language:english$" : "";
  const encodedSearch = encodeURIComponent(langSearch);

  switch (feedKey) {
    case BROWSE_FEED_KEYS.POPULAR_DAILY:
      return `${EHENTAI_BASE_URL}/toplist.php?tl=11&p=${pIndex}`;

    case BROWSE_FEED_KEYS.POPULAR_WEEKLY:
      if (safePage === 1) {
        return `${EHENTAI_BASE_URL}/popular`;
      }
      return `${EHENTAI_BASE_URL}/?f_search=${encodedSearch}&f_sr=on&f_srdd=3&page=${pIndex}`;

    case BROWSE_FEED_KEYS.POPULAR_MONTHLY:
      return `${EHENTAI_BASE_URL}/toplist.php?tl=12&p=${pIndex}`;

    case BROWSE_FEED_KEYS.TOP_RATED_DAILY:
      return `${EHENTAI_BASE_URL}/?f_search=${encodedSearch}&f_sr=on&f_srdd=5&page=${pIndex}`;

    case BROWSE_FEED_KEYS.TOP_RATED_WEEKLY:
      return `${EHENTAI_BASE_URL}/?f_search=${encodedSearch}&f_sr=on&f_srdd=4&page=${pIndex}`;

    case BROWSE_FEED_KEYS.TOP_RATED_MONTHLY:
      return `${EHENTAI_BASE_URL}/?f_search=${encodedSearch}&f_sr=on&f_srdd=4&page=${pIndex}`;

    default:
      return `${EHENTAI_BASE_URL}/toplist.php?tl=11&p=${pIndex}`;
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
 * Evaluates whether an E-Hentai gallery metadata entry satisfies:
 * 1. Native English filtering (Language Gate)
 * 2. True Tag Blacklist ($O(1)$)
 * 3. Enabled content category filter
 */
export function evaluateGalleryMetadata(
  meta: EHentaiGalleryMetadata,
  prefs: ImHentaiUserPreferences,
  blacklistSet: ReadonlySet<string>
): boolean {
  if (!meta || !Array.isArray(meta.tags)) {
    return false;
  }

  const normLang = normalizeLanguageToken(prefs.language);
  const isEnglishPreferred = normLang === "en";

  // 1. Language Gate:
  // If user prefers English (default), ensure item.tags.some(t => t === "language:english" || t === "language:translated")
  if (isEnglishPreferred) {
    const hasEnglishTag = meta.tags.some(
      (t) => t === "language:english" || t === "language:translated"
    );
    if (!hasEnglishTag) {
      return false;
    }
  }

  // 2. True Tag Blacklist Check (O(1)):
  if (isItemBlacklisted(meta.tags, blacklistSet)) {
    return false;
  }

  // 3. Category Filter Gate:
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
 * Resolves a clean title against IMHentai's native search endpoint:
 * https://imhentai.xxx/search/?key=${encodeURIComponent(searchTitle)}&apply=Search&en=1
 * Extracts the first matching .thumb card and maps to a Suwatte Item.
 */
export async function resolveTitleOnIMHentai(
  client: NetworkClient,
  searchTitle: string,
  prefs: ImHentaiUserPreferences,
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

  const isEnglish = normalizeLanguageToken(prefs.language) === "en";
  const langParam = isEnglish ? "&en=1" : "";
  const searchUrl = `${BASE_URL}/search/?key=${encodeURIComponent(
    trimmed
  )}&apply=Search${langParam}`;

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
    const $firstThumb = $(".thumb").first();
    if ($firstThumb.length === 0) {
      cacheResolvedItem(cacheKey, null);
      return null;
    }

    const card = extractGalleryCardFromElement($firstThumb, $);
    if (!card || !card.id) {
      cacheResolvedItem(cacheKey, null);
      return null;
    }

    const display = formatGalleryTitleDisplay(
      card.title,
      card.japaneseTitle || japaneseTitle,
      prefs
    );

    const item: Item = {
      id: card.id,
      title: display.title,
      subtitle: display.subtitle ?? card.subtitle,
      coverImage: card.thumbnailUrl,
      webUrl: `${BASE_URL}/gallery/${card.id}/`,
      rating: ContentRating.ADULT,
    };

    cacheResolvedItem(cacheKey, item);
    return item;
  } catch {
    cacheResolvedItem(cacheKey, null);
    return null;
  }
}

/**
 * Fetches, filters, and resolves a single page from E-Hentai.
 */
async function fetchAndResolveEHentaiPage(
  client: NetworkClient,
  feedKey: string,
  pageIndex: number,
  prefs: ImHentaiUserPreferences,
  blacklistSet: ReadonlySet<string>
): Promise<Item[]> {
  const normLang = normalizeLanguageToken(prefs.language);
  const isEnglishPreferred = normLang === "en";
  const endpoint = getEHentaiEndpoint(feedKey, pageIndex, isEnglishPreferred);

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
    return [];
  }

  const refs = extractGalleryRefs(html);
  if (refs.length === 0) {
    return [];
  }

  const metadataList = await fetchEHentaiMetadata(client, refs);
  if (metadataList.length === 0) {
    return [];
  }

  // Filter items in-memory via Language Gate and True Tag Blacklist (O(1))
  const cleanSurviving = metadataList.filter((m) =>
    evaluateGalleryMetadata(m, prefs, blacklistSet)
  );

  if (cleanSurviving.length === 0) {
    return [];
  }

  // Concurrently resolve surviving clean titles back to IMHentai
  const resolvePromises = cleanSurviving.map(async (meta) => {
    const searchTitle = sanitizeSearchTitle(meta.title);
    if (!searchTitle) return null;
    return resolveTitleOnIMHentai(client, searchTitle, prefs, meta.title_jpn);
  });

  const resolved = await Promise.all(resolvePromises);
  const items: Item[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < resolved.length; i++) {
    const it = resolved[i];
    if (it && it.id && !seenIds.has(it.id)) {
      seenIds.add(it.id);
      items.push(it);
    }
  }

  return items;
}

/**
 * Executes a full timeframe discovery query for a feed key, incorporating:
 * 1. E-Hentai leaderboard / search HTML fetching
 * 2. Batch api.php tag extraction
 * 3. O(1) in-memory tag blacklist & language evaluation
 * 4. IMHentai clean title resolution
 * 5. Safe single sequential backfill pass if resolved items < 10
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

  const safePage = Math.max(1, page || 1);
  const items = await fetchAndResolveEHentaiPage(
    client,
    feedKey,
    safePage,
    resolvedPrefs,
    blacklistSet
  );

  // Safe single sequential backfill pass if blacklist filtering reduced items below 10
  if (items.length < 10) {
    try {
      const backfillItems = await fetchAndResolveEHentaiPage(
        client,
        feedKey,
        safePage + 1,
        resolvedPrefs,
        blacklistSet
      );

      const seenIds = new Set(items.map((it) => it.id));
      for (let i = 0; i < backfillItems.length; i++) {
        const it = backfillItems[i];
        if (it && !seenIds.has(it.id)) {
          seenIds.add(it.id);
          items.push(it);
        }
      }
    } catch {
      // Safe fallback: continue with current items
    }
  }

  return {
    items,
    isLastPage: items.length === 0,
  };
}
