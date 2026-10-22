import {
  type PopulatedForm,
  type UIForm,
  UIKeyboardType,
  UIPicker,
  UISelect,
  UITextField,
  UIToggle,
} from "@suwatte/toolchain";
import {
  ALL_CONTENT_RATINGS,
  ATSU_GENRES,
  ATSU_THEMES,
  CONTENT_RATING_OPTIONS,
  DEFAULT_ALLOWED_CONTENT_RATINGS,
  DEFAULT_ENABLED_FORMATS,
  FORMAT_PREFERENCE_OPTIONS,
  IMAGE_FORMAT_OPTIONS,
  NSFW_RATINGS_SET,
  PREF_KEYS,
} from "./constants.js";
import type { AtsuUserPreferences, ImageQualityFormat } from "./types.js";

// Pre-allocated static UI option lists to avoid re-mapping on every settings menu open
const UI_IMAGE_FORMAT_OPTIONS = IMAGE_FORMAT_OPTIONS.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

const UI_CONTENT_RATING_OPTIONS = CONTENT_RATING_OPTIONS.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

const UI_GENRE_OPTIONS = ATSU_GENRES.map((g) => ({
  id: g.id,
  title: g.title,
}));

const UI_THEME_OPTIONS = ATSU_THEMES.map((t) => ({
  id: t.id,
  title: t.title,
}));

const UI_FORMAT_PREFERENCE_OPTIONS = FORMAT_PREFERENCE_OPTIONS.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

let memoryPreferences: AtsuUserPreferences = {
  imageFormat: "webp",
  deduplicateChapters: true,
  scanlatorWhitelist: ["Asura", "Official"],
  showNsfw: false,
  contentRatings: [...DEFAULT_ALLOWED_CONTENT_RATINGS],
  excludedGenres: [],
  excludedTags: [],
  enabledFormats: [...DEFAULT_ENABLED_FORMATS],
};

let isHydrated = false;
let inflightHydration: Promise<AtsuUserPreferences> | null = null;

function hasObjectStore(): boolean {
  return typeof ObjectStore !== "undefined" && ObjectStore !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Evaluates in O(1) per element whether any rating in the list unlocks NSFW content.
 */
export function hasNsfwRating(ratings: readonly string[]): boolean {
  for (let i = 0, len = ratings.length; i < len; i++) {
    const r = ratings[i];
    if (r !== undefined && NSFW_RATINGS_SET.has(r)) {
      return true;
    }
  }
  return false;
}

export function parseStringList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const result: string[] = [];
    for (let i = 0, len = raw.length; i < len; i++) {
      const trimmed = String(raw[i]).trim();
      if (trimmed.length > 0) {
        result.push(trimmed);
      }
    }
    return result;
  }
  if (isRecord(raw) && Array.isArray(raw.include)) {
    const inc = raw.include;
    const result: string[] = [];
    for (let i = 0, len = inc.length; i < len; i++) {
      const trimmed = String(inc[i]).trim();
      if (trimmed.length > 0) {
        result.push(trimmed);
      }
    }
    return result;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.charCodeAt(0) === 91 && trimmed.charCodeAt(trimmed.length - 1) === 93) {
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
    const parts = trimmed.split(",");
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

export function parseScanlatorWhitelist(
  raw: string | string[] | null | undefined
): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const result: string[] = [];
    for (let i = 0, len = raw.length; i < len; i++) {
      const entry = String(raw[i]).trim();
      if (entry.length > 0) {
        result.push(entry);
      }
    }
    return result;
  }
  const parts = raw.split(",");
  const result: string[] = [];
  for (let i = 0, len = parts.length; i < len; i++) {
    const entry = parts[i]?.trim();
    if (entry) {
      result.push(entry);
    }
  }
  return result;
}

function normalizeRatingsList(rawList: readonly string[]): string[] {
  const unique = new Set<string>();
  for (let i = 0, len = rawList.length; i < len; i++) {
    const r = rawList[i];
    if (r) {
      unique.add(r === "Pornographic" ? "Adult" : r);
    }
  }
  return Array.from(unique);
}

const FORMAT_TOKENS: ReadonlyMap<string, string> = new Map([
  ["manga", "Manga"],
  ["manhwa", "Manhwa"],
  ["manwha", "Manhwa"],
  ["manhua", "Manhua"],
  ["novel", "Novel"],
  ["oel", "OEL"],
  ["comic", "OEL"],
  ["other", "OTHER"],
]);

/** Maps any spelling/casing of a format ("manwha", " Comic ") to its canonical name. */
export function normalizeFormatToken(raw: string): string | null {
  return FORMAT_TOKENS.get(raw.trim().toLowerCase()) ?? null;
}

export function normalizeFormatsList(rawInput: unknown): string[] {
  const unique = new Set<string>();
  if (
    isRecord(rawInput) &&
    !Array.isArray(rawInput.include) &&
    !Array.isArray(rawInput.exclude)
  ) {
    for (const [key, val] of Object.entries(rawInput)) {
      if (val === true) {
        const canonical = normalizeFormatToken(key);
        if (canonical) {
          unique.add(canonical);
        }
      }
    }
    return Array.from(unique);
  }

  const rawList = parseStringList(rawInput);
  for (let i = 0, len = rawList.length; i < len; i++) {
    const item = rawList[i];
    if (item) {
      const canonical = normalizeFormatToken(item);
      if (canonical) {
        unique.add(canonical);
      }
    }
  }
  return Array.from(unique);
}

async function hydratePreferencesFromStore(): Promise<AtsuUserPreferences> {
  if (!hasObjectStore()) {
    isHydrated = true;
    return memoryPreferences;
  }

  try {
    const [
      storedFormat,
      storedDedup,
      storedWhitelist,
      storedRatings,
      storedLegacyNsfw,
      storedExcludedGenres,
      storedExcludedTags,
      storedEnabledFormats,
    ] = await Promise.all([
      ObjectStore.string(PREF_KEYS.IMAGE_FORMAT).catch(() => null),
      ObjectStore.get(PREF_KEYS.DEDUPLICATE_CHAPTERS).catch(() => null),
      ObjectStore.get(PREF_KEYS.SCANLATOR_WHITELIST).catch(() => null),
      ObjectStore.get(PREF_KEYS.CONTENT_RATINGS).catch(() => null),
      ObjectStore.boolean(PREF_KEYS.SHOW_NSFW).catch(() => null),
      ObjectStore.get(PREF_KEYS.EXCLUDED_GENRES).catch(() => null),
      ObjectStore.get(PREF_KEYS.EXCLUDED_TAGS).catch(() => null),
      ObjectStore.get(PREF_KEYS.ENABLED_FORMATS).catch(() => null),
    ]);

    const imageFormat: ImageQualityFormat =
      storedFormat === "webp" || storedFormat === "original"
        ? storedFormat
        : memoryPreferences.imageFormat;

    let deduplicateChapters = memoryPreferences.deduplicateChapters;
    if (typeof storedDedup === "boolean") {
      deduplicateChapters = storedDedup;
    } else if (typeof storedDedup === "string") {
      deduplicateChapters = storedDedup === "single" || storedDedup === "true";
    }

    let scanlatorWhitelist = memoryPreferences.scanlatorWhitelist;
    if (typeof storedWhitelist === "string") {
      scanlatorWhitelist = parseScanlatorWhitelist(storedWhitelist);
    } else if (Array.isArray(storedWhitelist)) {
      scanlatorWhitelist = parseStringList(storedWhitelist);
    }

    let contentRatings = memoryPreferences.contentRatings;
    const parsedRatings = parseStringList(storedRatings);
    if (parsedRatings.length > 0) {
      contentRatings = normalizeRatingsList(parsedRatings);
    } else if (storedLegacyNsfw === true) {
      contentRatings = [...ALL_CONTENT_RATINGS];
    }

    const excludedGenres =
      storedExcludedGenres !== null && storedExcludedGenres !== undefined
        ? parseStringList(storedExcludedGenres)
        : memoryPreferences.excludedGenres;

    const excludedTags =
      storedExcludedTags !== null && storedExcludedTags !== undefined
        ? parseStringList(storedExcludedTags)
        : memoryPreferences.excludedTags;

    let enabledFormats =
      memoryPreferences.enabledFormats ?? [...DEFAULT_ENABLED_FORMATS];
    if (storedEnabledFormats !== null && storedEnabledFormats !== undefined) {
      const parsedFormats = normalizeFormatsList(storedEnabledFormats);
      if (parsedFormats.length > 0) {
        enabledFormats = parsedFormats;
      }
    }

    const showNsfw = hasNsfwRating(contentRatings);

    memoryPreferences = {
      imageFormat,
      deduplicateChapters,
      scanlatorWhitelist,
      showNsfw,
      contentRatings,
      excludedGenres,
      excludedTags,
      enabledFormats,
    };
  } catch {
    // Retain current in-memory preferences on store failure
  }

  isHydrated = true;
  return memoryPreferences;
}

/**
 * Returns the memoized user preferences, hydrating from ObjectStore once per lifecycle
 * and updating in-place when preferences are submitted.
 */
export async function getUserPreferences(): Promise<AtsuUserPreferences> {
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

export async function getImageFormatPreference(): Promise<ImageQualityFormat> {
  return (await getUserPreferences()).imageFormat;
}

export async function getShowNsfwPreference(): Promise<boolean> {
  return (await getUserPreferences()).showNsfw;
}

export async function buildSettingsForm(): Promise<UIForm> {
  const prefs = await getUserPreferences();
  const whitelistString = prefs.scanlatorWhitelist.join(", ");

  return {
    sections: [
      {
        header: "Reader & Image Settings",
        footer:
          "Select WebP to conserve bandwidth and battery, or Original / AVIF for maximum image resolution.",
        views: [
          UIPicker({
            id: PREF_KEYS.IMAGE_FORMAT,
            title: "Image Quality / Format",
            options: UI_IMAGE_FORMAT_OPTIONS,
            currentValue: prefs.imageFormat,
            defaultValue: "webp",
          }),
        ],
      },
      {
        header: "Chapter & Scanlator Management",
        footer:
          "Prioritize a single release per chapter or display all scanlation groups. Whitelisted scanlators (comma-separated) are prioritized first.",
        views: [
          UIToggle({
            id: PREF_KEYS.DEDUPLICATE_CHAPTERS,
            title:
              "Chapter Deduplication (Prioritize single release per chapter)",
            currentValue: prefs.deduplicateChapters,
            defaultValue: true,
          }),
          UITextField({
            id: PREF_KEYS.SCANLATOR_WHITELIST,
            title: "Preferred Scanlator Whitelist",
            placeholder: "e.g. Asura, Official, Flame, Alpha",
            keyboardType: UIKeyboardType.ALPHANUMERIC,
            currentValue: whitelistString,
            defaultValue: "Asura, Official",
          }),
        ],
      },
      {
        header: "Content Maturity Ratings",
        footer:
          "Choose which maturity levels to display. Series matching unselected ratings will be filtered out from all feeds, categories, and search results.",
        views: [
          UISelect({
            id: PREF_KEYS.CONTENT_RATINGS,
            title: "Allowed Content Ratings",
            options: UI_CONTENT_RATING_OPTIONS,
            exclude: false,
            currentValue: { include: prefs.contentRatings, exclude: [] },
            defaultValue: {
              include: [...DEFAULT_ALLOWED_CONTENT_RATINGS],
              exclude: [],
            },
          }),
        ],
      },
      {
        header: "Content Exclusions / Filter Blacklist",
        footer:
          "Permanently blacklist series containing selected genres or tags from browse categories, search results, and home feeds.",
        views: [
          UISelect({
            id: PREF_KEYS.EXCLUDED_GENRES,
            title: "Excluded Genres",
            options: UI_GENRE_OPTIONS,
            exclude: false,
            currentValue: { include: prefs.excludedGenres, exclude: [] },
            defaultValue: { include: [], exclude: [] },
          }),
          UISelect({
            id: PREF_KEYS.EXCLUDED_TAGS,
            title: "Excluded Tags & Themes",
            options: UI_THEME_OPTIONS,
            exclude: false,
            currentValue: { include: prefs.excludedTags, exclude: [] },
            defaultValue: { include: [], exclude: [] },
          }),
        ],
      },
      {
        header: "Format & Medium Preferences",
        footer:
          "Select which publication formats and mediums to include in catalog feeds, browse directories, and search results. Enable Manga, Manhwa, Manhua, Novel, OEL, or OTHER in any combination.",
        views: [
          UISelect({
            id: PREF_KEYS.ENABLED_FORMATS,
            title: "Enabled Formats & Mediums",
            options: UI_FORMAT_PREFERENCE_OPTIONS,
            exclude: false,
            currentValue: {
              include: prefs.enabledFormats ?? [...DEFAULT_ENABLED_FORMATS],
              exclude: [],
            },
            defaultValue: {
              include: [...DEFAULT_ENABLED_FORMATS],
              exclude: [],
            },
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
    imageFormat,
    deduplicateChapters,
    scanlatorWhitelist,
    showNsfw,
    contentRatings,
    excludedGenres,
    excludedTags,
    enabledFormats,
  } = memoryPreferences;
  if (!enabledFormats || enabledFormats.length === 0) {
    enabledFormats = [...DEFAULT_ENABLED_FORMATS];
  }

  const storeAvailable = hasObjectStore();
  const writeTasks: Array<Promise<unknown>> = [];

  const rawFormat = data[PREF_KEYS.IMAGE_FORMAT];
  if (typeof rawFormat === "string") {
    imageFormat = rawFormat === "original" ? "original" : "webp";
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.IMAGE_FORMAT, imageFormat).catch(() => {})
      );
    }
  }

  const rawDedup = data[PREF_KEYS.DEDUPLICATE_CHAPTERS];
  if (typeof rawDedup === "boolean") {
    deduplicateChapters = rawDedup;
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.DEDUPLICATE_CHAPTERS, rawDedup).catch(
          () => {}
        )
      );
    }
  }

  const rawWhitelist = data[PREF_KEYS.SCANLATOR_WHITELIST];
  if (typeof rawWhitelist === "string") {
    scanlatorWhitelist = parseScanlatorWhitelist(rawWhitelist);
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.SCANLATOR_WHITELIST, rawWhitelist).catch(
          () => {}
        )
      );
    }
  }

  const rawRatings = data[PREF_KEYS.CONTENT_RATINGS];
  if (rawRatings !== undefined && rawRatings !== null) {
    const rawList = parseStringList(rawRatings);
    contentRatings = normalizeRatingsList(rawList);
    showNsfw = hasNsfwRating(contentRatings);
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.CONTENT_RATINGS, contentRatings).catch(
          () => {}
        ),
        ObjectStore.set(PREF_KEYS.SHOW_NSFW, showNsfw).catch(() => {})
      );
    }
  } else {
    const rawShowNsfw = data[PREF_KEYS.SHOW_NSFW];
    if (typeof rawShowNsfw === "boolean") {
      showNsfw = rawShowNsfw;
      contentRatings = rawShowNsfw
        ? [...ALL_CONTENT_RATINGS]
        : [...DEFAULT_ALLOWED_CONTENT_RATINGS];
      if (storeAvailable) {
        writeTasks.push(
          ObjectStore.set(PREF_KEYS.SHOW_NSFW, rawShowNsfw).catch(() => {}),
          ObjectStore.set(PREF_KEYS.CONTENT_RATINGS, contentRatings).catch(
            () => {}
          )
        );
      }
    }
  }

  const rawExcludedGenres = data[PREF_KEYS.EXCLUDED_GENRES];
  if (rawExcludedGenres !== undefined && rawExcludedGenres !== null) {
    excludedGenres = parseStringList(rawExcludedGenres);
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.EXCLUDED_GENRES, excludedGenres).catch(
          () => {}
        )
      );
    }
  }

  const rawExcludedTags = data[PREF_KEYS.EXCLUDED_TAGS];
  if (rawExcludedTags !== undefined && rawExcludedTags !== null) {
    excludedTags = parseStringList(rawExcludedTags);
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.EXCLUDED_TAGS, excludedTags).catch(() => {})
      );
    }
  }

  const rawEnabledFormats =
    data[PREF_KEYS.ENABLED_FORMATS] ?? data["atsu_pref_formats"];
  if (rawEnabledFormats !== undefined && rawEnabledFormats !== null) {
    const parsedFormats = normalizeFormatsList(rawEnabledFormats);
    enabledFormats =
      parsedFormats.length > 0 ? parsedFormats : [...DEFAULT_ENABLED_FORMATS];
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.ENABLED_FORMATS, enabledFormats).catch(
          () => {}
        )
      );
    }
  }

  // Assign a fresh immutable snapshot reference so WeakMap caches update immediately
  memoryPreferences = {
    imageFormat,
    deduplicateChapters,
    scanlatorWhitelist,
    showNsfw,
    contentRatings,
    excludedGenres,
    excludedTags,
    enabledFormats,
  };
  isHydrated = true;

  if (writeTasks.length > 0) {
    await Promise.all(writeTasks);
  }
}
