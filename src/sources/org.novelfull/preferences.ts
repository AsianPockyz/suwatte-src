import {
  type PopulatedForm,
  type UIForm,
  UIKeyboardType,
  UISelect,
  UITextField,
  UIToggle,
} from "@suwatte/toolchain";
import {
  NON_ALPHANUMERIC_SLUG_REGEX,
  NOVELFULL_GENRES,
  PREF_KEYS,
  WHITESPACE_REGEX,
  WORD_TOKEN_REGEX,
} from "./constants.js";
import type {
  CompiledBlacklistContext,
  NovelFullCard,
  NovelFullUserPreferences,
  PreferenceProvider,
} from "./types.js";

// Pre-allocated static UI option array for excluded genres
const UI_GENRE_OPTIONS = NOVELFULL_GENRES.map((g) => ({
  id: g.id,
  title: g.title,
}));

const GENRE_Lookup_MAP: ReadonlyMap<string, string> = new Map(
  NOVELFULL_GENRES.flatMap((g) => [
    [g.id.toLowerCase(), g.title.toLowerCase()],
    [g.slug.toLowerCase(), g.title.toLowerCase()],
    [
      g.title.toLowerCase().replace(NON_ALPHANUMERIC_SLUG_REGEX, "-"),
      g.title.toLowerCase(),
    ],
  ])
);

let memoryPreferences: NovelFullUserPreferences = {
  sanitizeAds: true,
  formatTln: true,
  normalizeSpacing: true,
  excludedGenres: [],
  customBlacklist: [],
};

let isHydrated = false;
let inflightHydration: Promise<NovelFullUserPreferences> | null = null;

const blacklistContextCache = new WeakMap<
  NovelFullUserPreferences,
  CompiledBlacklistContext
>();

function hasObjectStore(): boolean {
  return typeof ObjectStore !== "undefined" && ObjectStore !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function invalidatePreferencesCache(): void {
  isHydrated = false;
  inflightHydration = null;
}

const HTML_ENTITY_MAP: Readonly<Record<string, string>> = Object.freeze({
  "&amp;": "&",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
  "&rsquo;": "'",
  "&lsquo;": "'",
  "&rdquo;": '"',
  "&ldquo;": '"',
  "&hellip;": "...",
  "&mdash;": "—",
  "&ndash;": "–",
});

const ENTITY_REGEX =
  /&(?:amp|quot|#039|#39|apos|lt|gt|nbsp|rsquo|lsquo|rdquo|ldquo|hellip|mdash|ndash);/gi;
const DECIMAL_ENTITY_REGEX = /&#(\d+);/g;
const HEX_ENTITY_REGEX = /&#x([0-9a-fA-F]+);/g;

/**
 * Decodes HTML entities and normalizes typography entities (&nbsp;, quotes, dashes, ellipsis).
 */
export function decodeHtmlEntities(str: string | undefined | null): string {
  if (!str) return "";
  return str
    .replace(
      ENTITY_REGEX,
      (match) => HTML_ENTITY_MAP[match.toLowerCase()] ?? match
    )
    .replace(DECIMAL_ENTITY_REGEX, (_, code) => {
      const num = Number(code);
      if (num === 160) return " ";
      if (num === 8216 || num === 8217) return "'";
      if (num === 8220 || num === 8221) return '"';
      if (num === 8230) return "...";
      if (num === 8212) return "—";
      if (num === 8211) return "–";
      return String.fromCharCode(num);
    })
    .replace(HEX_ENTITY_REGEX, (_, hex) => {
      const num = parseInt(hex, 16);
      if (num === 0xa0) return " ";
      return String.fromCharCode(num);
    })
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(WHITESPACE_REGEX, " ")
    .trim();
}

export function parseStringList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const result: string[] = [];
    for (let i = 0, len = raw.length; i < len; i++) {
      const s = String(raw[i]).trim();
      if (s.length > 0) {
        result.push(s);
      }
    }
    return result;
  }
  if (isRecord(raw)) {
    const listCandidate = Array.isArray(raw.include)
      ? raw.include
      : Array.isArray(raw.exclude) && raw.exclude.length > 0
        ? raw.exclude
        : null;
    if (listCandidate) {
      const result: string[] = [];
      for (let i = 0, len = listCandidate.length; i < len; i++) {
        const s = String(listCandidate[i]).trim();
        if (s.length > 0) {
          result.push(s);
        }
      }
      return result;
    }
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (
      trimmed.charCodeAt(0) === 91 &&
      trimmed.charCodeAt(trimmed.length - 1) === 93
    ) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const result: string[] = [];
          for (let i = 0, len = parsed.length; i < len; i++) {
            const s = String(parsed[i]).trim();
            if (s.length > 0) {
              result.push(s);
            }
          }
          return result;
        }
      } catch {
        // Fallback to comma split
      }
    }
    const parts = trimmed.split(/[,;\n]+/);
    const result: string[] = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const part = parts[i]?.trim();
      if (part) {
        result.push(part);
      }
    }
    return result;
  }
  return [];
}

function parseBooleanPref(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const lower = raw.trim().toLowerCase();
    if (lower === "true" || lower === "1" || lower === "yes") return true;
    if (lower === "false" || lower === "0" || lower === "no") return false;
  }
  if (typeof raw === "number") {
    return raw !== 0;
  }
  return fallback;
}

async function hydratePreferencesFromStore(): Promise<NovelFullUserPreferences> {
  if (!hasObjectStore()) {
    isHydrated = true;
    return memoryPreferences;
  }

  try {
    const [
      storedSanitizeAds,
      storedFormatTln,
      storedNormalizeSpacing,
      storedExcludedGenres,
      storedCustomBlacklist,
    ] = await Promise.all([
      ObjectStore.get(PREF_KEYS.SANITIZE_ADS).catch(() => null),
      ObjectStore.get(PREF_KEYS.FORMAT_TLN).catch(() => null),
      ObjectStore.get(PREF_KEYS.NORMALIZE_SPACING).catch(() => null),
      ObjectStore.get(PREF_KEYS.EXCLUDED_GENRES).catch(() => null),
      ObjectStore.get(PREF_KEYS.CUSTOM_BLACKLIST).catch(() => null),
    ]);

    const sanitizeAds =
      storedSanitizeAds !== null && storedSanitizeAds !== undefined
        ? parseBooleanPref(storedSanitizeAds, memoryPreferences.sanitizeAds)
        : memoryPreferences.sanitizeAds;

    const formatTln =
      storedFormatTln !== null && storedFormatTln !== undefined
        ? parseBooleanPref(storedFormatTln, memoryPreferences.formatTln)
        : memoryPreferences.formatTln;

    const normalizeSpacing =
      storedNormalizeSpacing !== null && storedNormalizeSpacing !== undefined
        ? parseBooleanPref(
            storedNormalizeSpacing,
            memoryPreferences.normalizeSpacing
          )
        : memoryPreferences.normalizeSpacing;

    const excludedGenres =
      storedExcludedGenres !== null && storedExcludedGenres !== undefined
        ? parseStringList(storedExcludedGenres)
        : memoryPreferences.excludedGenres;

    const customBlacklist =
      storedCustomBlacklist !== null && storedCustomBlacklist !== undefined
        ? parseStringList(storedCustomBlacklist)
        : memoryPreferences.customBlacklist;

    memoryPreferences = {
      sanitizeAds,
      formatTln,
      normalizeSpacing,
      excludedGenres,
      customBlacklist,
    };
  } catch {
    // Retain current in-memory preferences if ObjectStore read fails
  }

  isHydrated = true;
  return memoryPreferences;
}

/**
 * Returns memoized user preferences, reading from ObjectStore at most once per lifecycle.
 */
export async function getUserPreferences(): Promise<NovelFullUserPreferences> {
  if (isHydrated) {
    return memoryPreferences;
  }
  if (inflightHydration) {
    return inflightHydration;
  }
  inflightHydration = hydratePreferencesFromStore().finally(() => {
    inflightHydration = null;
  });
  return inflightHydration;
}

/**
 * Compiles an O(1) Set lookup context for evaluating genre and keyword exclusions.
 * Memoizes via WeakMap when called without filter overrides.
 */
export function compileBlacklistContext(
  prefs: NovelFullUserPreferences,
  additionalExcludedGenres?: readonly string[]
): CompiledBlacklistContext {
  const hasAdditional =
    Array.isArray(additionalExcludedGenres) &&
    additionalExcludedGenres.length > 0;

  if (!hasAdditional) {
    const cached = blacklistContextCache.get(prefs);
    if (cached) {
      return cached;
    }
  }

  const excludedGenreSet = new Set<string>();
  const excludedKeywordSet = new Set<string>();
  const excludedPhrasesSet = new Set<string>();

  const addGenreToken = (rawGenre: string) => {
    const clean = rawGenre.trim().toLowerCase();
    if (!clean) return;
    excludedGenreSet.add(clean);
    const slug = clean.replace(NON_ALPHANUMERIC_SLUG_REGEX, "-").replace(/^-|-$/g, "");
    if (slug) {
      excludedGenreSet.add(slug);
    }
    const mapped = GENRE_Lookup_MAP.get(clean) ?? GENRE_Lookup_MAP.get(slug);
    if (mapped) {
      excludedGenreSet.add(mapped);
      const mappedSlug = mapped
        .replace(NON_ALPHANUMERIC_SLUG_REGEX, "-")
        .replace(/^-|-$/g, "");
      if (mappedSlug) {
        excludedGenreSet.add(mappedSlug);
      }
    }
    if (!clean.includes(" ")) {
      excludedKeywordSet.add(clean);
    } else {
      excludedPhrasesSet.add(clean);
      if (slug) excludedPhrasesSet.add(slug);
    }
  };

  if (Array.isArray(prefs.excludedGenres)) {
    for (let i = 0, len = prefs.excludedGenres.length; i < len; i++) {
      const g = prefs.excludedGenres[i];
      if (g) addGenreToken(g);
    }
  }

  if (hasAdditional && additionalExcludedGenres) {
    for (let i = 0, len = additionalExcludedGenres.length; i < len; i++) {
      const g = additionalExcludedGenres[i];
      if (g) addGenreToken(g);
    }
  }

  if (Array.isArray(prefs.customBlacklist)) {
    for (let i = 0, len = prefs.customBlacklist.length; i < len; i++) {
      const rawKw = prefs.customBlacklist[i];
      if (!rawKw) continue;
      const clean = rawKw.trim().toLowerCase();
      if (!clean) continue;

      excludedKeywordSet.add(clean);
      excludedPhrasesSet.add(clean);

      const slug = clean
        .replace(NON_ALPHANUMERIC_SLUG_REGEX, "-")
        .replace(/^-|-$/g, "");
      if (slug) {
        excludedKeywordSet.add(slug);
        excludedPhrasesSet.add(slug);
      }
    }
  }

  const excludedPhrases = Array.from(excludedPhrasesSet);
  const hasExclusions =
    excludedGenreSet.size > 0 ||
    excludedKeywordSet.size > 0 ||
    excludedPhrases.length > 0;

  const compiled: CompiledBlacklistContext = {
    excludedGenreSet,
    excludedKeywordSet,
    excludedPhrases,
    hasExclusions,
  };

  if (!hasAdditional) {
    blacklistContextCache.set(prefs, compiled);
  }

  return compiled;
}

/**
 * Evaluates in O(1) Set lookups whether a novel card passes the user's genre and keyword exclusions.
 * Checks genre arrays, URL slugs, and titles with immediate early exit.
 */
export function isNovelAllowed(
  card: Pick<NovelFullCard, "id" | "title" | "genres">,
  ctx: CompiledBlacklistContext
): boolean {
  if (!ctx.hasExclusions) {
    return true;
  }

  // 1. O(1) Set lookup against novel's genre tags
  const genres = card.genres;
  if (Array.isArray(genres) && ctx.excludedGenreSet.size > 0) {
    for (let i = 0, len = genres.length; i < len; i++) {
      const rawGenre = genres[i];
      if (!rawGenre) continue;
      const lower = rawGenre.trim().toLowerCase();
      if (ctx.excludedGenreSet.has(lower)) {
        return false;
      }
      const slug = lower
        .replace(NON_ALPHANUMERIC_SLUG_REGEX, "-")
        .replace(/^-|-$/g, "");
      if (slug && ctx.excludedGenreSet.has(slug)) {
        return false;
      }
    }
  }

  // 2. O(1) Set lookup against URL slug and slug word tokens
  const slugLower = (card.id ?? "").trim().toLowerCase();
  if (slugLower) {
    if (
      ctx.excludedKeywordSet.has(slugLower) ||
      ctx.excludedGenreSet.has(slugLower)
    ) {
      return false;
    }
    const slugTokens = slugLower.split("-");
    for (let i = 0, len = slugTokens.length; i < len; i++) {
      const tok = slugTokens[i];
      if (
        tok &&
        (ctx.excludedKeywordSet.has(tok) || ctx.excludedGenreSet.has(tok))
      ) {
        return false;
      }
    }
  }

  // 3. O(1) Set lookup against title word tokens + phrase matching
  const titleLower = (card.title ?? "").trim().toLowerCase();
  if (titleLower) {
    if (ctx.excludedKeywordSet.has(titleLower)) {
      return false;
    }

    const wordRegex = new RegExp(WORD_TOKEN_REGEX.source, "g");
    let match: RegExpExecArray | null;
    while ((match = wordRegex.exec(titleLower)) !== null) {
      const word = match[0];
      if (
        word &&
        (ctx.excludedKeywordSet.has(word) || ctx.excludedGenreSet.has(word))
      ) {
        return false;
      }
    }

    const phrases = ctx.excludedPhrases;
    for (let i = 0, len = phrases.length; i < len; i++) {
      const phrase = phrases[i];
      if (phrase && (titleLower.includes(phrase) || slugLower.includes(phrase))) {
        return false;
      }
    }
  }

  return true;
}

export async function buildSettingsForm(): Promise<UIForm> {
  const prefs = await getUserPreferences();
  const customBlacklistStr = prefs.customBlacklist.join(", ");

  return {
    sections: [
      {
        header: "Reading & Typography Enhancements",
        footer:
          "Configure NovelFull's native chapter text sanitization engine, translator note callouts, and paragraph typography.",
        views: [
          UIToggle({
            id: PREF_KEYS.SANITIZE_ADS,
            title: "Strip Aggregator Promos & Watermarks",
            currentValue: prefs.sanitizeAds,
            defaultValue: true,
          }),
          UIToggle({
            id: PREF_KEYS.FORMAT_TLN,
            title: "Format Translator Notes into Callouts",
            currentValue: prefs.formatTln,
            defaultValue: true,
          }),
          UIToggle({
            id: PREF_KEYS.NORMALIZE_SPACING,
            title: "Normalize Paragraph Spacing & Punctuation",
            currentValue: prefs.normalizeSpacing,
            defaultValue: true,
          }),
        ],
      },
      {
        header: "Content Exclusions / Blacklist",
        footer:
          "Permanently hide novels matching excluded genres or negative keywords across all Discover shelves, category tabs, and search results.",
        views: [
          UISelect({
            id: PREF_KEYS.EXCLUDED_GENRES,
            title: "Excluded Genres",
            options: UI_GENRE_OPTIONS,
            exclude: false,
            currentValue: {
              include: prefs.excludedGenres,
              exclude: [],
            },
            defaultValue: {
              include: [],
              exclude: [],
            },
          }),
          UITextField({
            id: PREF_KEYS.CUSTOM_BLACKLIST,
            title: "Custom Keyword Blacklist",
            placeholder: "e.g. mtl, machine translation, harem, system",
            keyboardType: UIKeyboardType.ALPHANUMERIC,
            currentValue: customBlacklistStr,
            defaultValue: "",
          }),
        ],
      },
    ],
  };
}

export async function updateUserPreferences(
  data: PopulatedForm
): Promise<void> {
  if (!isRecord(data)) {
    return;
  }

  let {
    sanitizeAds,
    formatTln,
    normalizeSpacing,
    excludedGenres,
    customBlacklist,
  } = memoryPreferences;

  const storeAvailable = hasObjectStore();
  const writeTasks: Array<Promise<unknown>> = [];

  if (data[PREF_KEYS.SANITIZE_ADS] !== undefined) {
    sanitizeAds = parseBooleanPref(data[PREF_KEYS.SANITIZE_ADS], sanitizeAds);
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.SANITIZE_ADS, sanitizeAds).catch(() => {})
      );
    }
  }

  if (data[PREF_KEYS.FORMAT_TLN] !== undefined) {
    formatTln = parseBooleanPref(data[PREF_KEYS.FORMAT_TLN], formatTln);
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.FORMAT_TLN, formatTln).catch(() => {})
      );
    }
  }

  if (data[PREF_KEYS.NORMALIZE_SPACING] !== undefined) {
    normalizeSpacing = parseBooleanPref(
      data[PREF_KEYS.NORMALIZE_SPACING],
      normalizeSpacing
    );
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.NORMALIZE_SPACING, normalizeSpacing).catch(
          () => {}
        )
      );
    }
  }

  if (
    data[PREF_KEYS.EXCLUDED_GENRES] !== undefined &&
    data[PREF_KEYS.EXCLUDED_GENRES] !== null
  ) {
    excludedGenres = parseStringList(data[PREF_KEYS.EXCLUDED_GENRES]);
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.EXCLUDED_GENRES, excludedGenres).catch(
          () => {}
        )
      );
    }
  }

  if (
    data[PREF_KEYS.CUSTOM_BLACKLIST] !== undefined &&
    data[PREF_KEYS.CUSTOM_BLACKLIST] !== null
  ) {
    customBlacklist = parseStringList(data[PREF_KEYS.CUSTOM_BLACKLIST]);
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(
          PREF_KEYS.CUSTOM_BLACKLIST,
          customBlacklist.join(", ")
        ).catch(() => {})
      );
    }
  }

  memoryPreferences = {
    sanitizeAds,
    formatTln,
    normalizeSpacing,
    excludedGenres,
    customBlacklist,
  };
  isHydrated = true;

  if (writeTasks.length > 0) {
    await Promise.all(writeTasks);
  }
}

export class NovelFullPreferenceProvider implements PreferenceProvider {
  async getSettingsPage(): Promise<UIForm | null> {
    return buildSettingsForm();
  }

  async getPreferenceMenu(): Promise<UIForm | null> {
    return buildSettingsForm();
  }

  async onFormSubmitted(_id: string, data: PopulatedForm): Promise<void> {
    await updateUserPreferences(data);
  }
}
