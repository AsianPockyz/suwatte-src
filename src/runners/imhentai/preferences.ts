import {
  type PopulatedForm,
  type UIForm,
  UIPicker,
  UISelect,
} from "@suwatte/toolchain";
import {
  ALL_CATEGORIES,
  CATEGORY_OPTIONS,
  DEFAULT_CATEGORIES,
  DEFAULT_LANGUAGE,
  DEFAULT_TITLE_PREFERENCE,
  LANGUAGE_OPTIONS,
  PREF_KEYS,
  TITLE_PREFERENCE_OPTIONS,
  WHITESPACE_REGEX,
} from "./constants.js";
import type {
  ImHentaiCategoryId,
  ImHentaiGalleryCard,
  ImHentaiLanguageId,
  ImHentaiTitlePreference,
  ImHentaiUserPreferences,
  PreferenceProvider,
} from "./types.js";

// Pre-allocated static UI option arrays to avoid re-allocating on every settings menu open
const UI_CATEGORY_OPTIONS = CATEGORY_OPTIONS.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

const UI_LANGUAGE_OPTIONS = LANGUAGE_OPTIONS.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

const UI_TITLE_PREFERENCE_OPTIONS = TITLE_PREFERENCE_OPTIONS.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

const VALID_CATEGORIES_SET: ReadonlySet<string> = new Set(ALL_CATEGORIES);

let memoryPreferences: ImHentaiUserPreferences = {
  categories: [...DEFAULT_CATEGORIES],
  language: DEFAULT_LANGUAGE,
  titlePreference: DEFAULT_TITLE_PREFERENCE,
};

let isHydrated = false;
let inflightHydration: Promise<ImHentaiUserPreferences> | null = null;

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
});

const ENTITY_REGEX = /&(?:amp|quot|#039|#39|apos|lt|gt|nbsp);/g;
const DECIMAL_ENTITY_REGEX = /&#(\d+);/g;
const HEX_ENTITY_REGEX = /&#x([0-9a-fA-F]+);/g;

/**
 * Robustly decodes HTML entities and normalizes excessive whitespace.
 */
export function decodeHtmlEntities(str: string | undefined | null): string {
  if (!str) return "";
  return str
    .replace(ENTITY_REGEX, (match) => HTML_ENTITY_MAP[match] ?? match)
    .replace(DECIMAL_ENTITY_REGEX, (_, code) =>
      String.fromCharCode(Number(code))
    )
    .replace(HEX_ENTITY_REGEX, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
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
  if (isRecord(raw) && Array.isArray(raw.include)) {
    const inc = raw.include;
    const result: string[] = [];
    for (let i = 0, len = inc.length; i < len; i++) {
      const s = String(inc[i]).trim();
      if (s.length > 0) {
        result.push(s);
      }
    }
    return result;
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

export function normalizeCategoryToken(
  raw: string | undefined | null
): ImHentaiCategoryId | null {
  if (!raw || typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  if (!lower) return null;
  if (lower === "doujinshi" || lower === "d") return "doujinshi";
  if (lower === "manga" || lower === "serialized manga" || lower === "m") {
    return "manga";
  }
  if (
    lower === "western" ||
    lower === "western adult comics" ||
    lower === "western comics" ||
    lower === "w"
  ) {
    return "western";
  }
  if (
    lower === "imageset" ||
    lower === "image set" ||
    lower === "image sets" ||
    lower === "i"
  ) {
    return "imageset";
  }
  if (
    lower === "artistcg" ||
    lower === "artist cg" ||
    lower === "artist cg / image sets" ||
    lower === "a"
  ) {
    return "artistcg";
  }
  if (lower === "gamecg" || lower === "game cg" || lower === "g") {
    return "gamecg";
  }
  if (lower === "cosplay" || lower === "cosplay packs" || lower === "c") {
    return "cosplay";
  }
  return VALID_CATEGORIES_SET.has(lower)
    ? (lower as ImHentaiCategoryId)
    : null;
}

export function normalizeCategoriesList(raw: unknown): ImHentaiCategoryId[] {
  const list = parseStringList(raw);
  const unique = new Set<ImHentaiCategoryId>();
  for (let i = 0, len = list.length; i < len; i++) {
    const item = list[i];
    if (item) {
      const norm = normalizeCategoryToken(item);
      if (norm) {
        unique.add(norm);
      }
    }
  }
  return Array.from(unique);
}

export function normalizeLanguageToken(raw: unknown): ImHentaiLanguageId {
  if (typeof raw !== "string") return DEFAULT_LANGUAGE;
  const lower = raw.trim().toLowerCase();
  if (lower === "en" || lower === "english") return "en";
  if (lower === "jp" || lower === "ja" || lower === "japanese") return "jp";
  if (lower === "es" || lower === "spanish") return "es";
  if (lower === "fr" || lower === "french") return "fr";
  if (lower === "kr" || lower === "ko" || lower === "korean") return "kr";
  if (lower === "de" || lower === "german") return "de";
  if (lower === "ru" || lower === "russian") return "ru";
  if (lower === "zh" || lower === "chinese") return "zh";
  if (lower === "all" || lower === "all languages") return "all";
  return DEFAULT_LANGUAGE;
}

export function normalizeTitlePreference(
  raw: unknown
): ImHentaiTitlePreference {
  if (typeof raw !== "string") return DEFAULT_TITLE_PREFERENCE;
  const lower = raw.trim().toLowerCase();
  if (lower === "japanese" || lower === "jp" || lower === "ja") {
    return "japanese";
  }
  return "english";
}

async function hydratePreferencesFromStore(): Promise<ImHentaiUserPreferences> {
  if (!hasObjectStore()) {
    isHydrated = true;
    return memoryPreferences;
  }

  try {
    const [
      storedCategories,
      legacyCategories,
      storedLanguage,
      legacyLanguage,
      storedTitlePref,
      legacyTitlePref,
    ] = await Promise.all([
      ObjectStore.get(PREF_KEYS.CATEGORIES).catch(() => null),
      ObjectStore.get(PREF_KEYS.LEGACY_CATEGORIES).catch(() => null),
      ObjectStore.string(PREF_KEYS.LANGUAGE).catch(() => null),
      ObjectStore.string(PREF_KEYS.LEGACY_LANGUAGE).catch(() => null),
      ObjectStore.string(PREF_KEYS.TITLE_PREFERENCE).catch(() => null),
      ObjectStore.string(PREF_KEYS.LEGACY_TITLE_PREFERENCE).catch(() => null),
    ]);

    let categories = memoryPreferences.categories;
    const rawCat = storedCategories ?? legacyCategories;
    if (rawCat !== null && rawCat !== undefined) {
      const parsed = normalizeCategoriesList(rawCat);
      if (parsed.length > 0) {
        categories = parsed;
      }
    }

    const rawLang = storedLanguage ?? legacyLanguage;
    const language =
      rawLang !== null && rawLang !== undefined
        ? normalizeLanguageToken(rawLang)
        : memoryPreferences.language;

    const rawTitle = storedTitlePref ?? legacyTitlePref;
    const titlePreference =
      rawTitle !== null && rawTitle !== undefined
        ? normalizeTitlePreference(rawTitle)
        : memoryPreferences.titlePreference;

    memoryPreferences = {
      categories,
      language,
      titlePreference,
    };
  } catch {
    // Retain in-memory preferences if ObjectStore read fails
  }

  isHydrated = true;
  return memoryPreferences;
}

/**
 * Memoizes user preferences per lifecycle to avoid reading ObjectStore in tight loops.
 */
export async function getUserPreferences(): Promise<ImHentaiUserPreferences> {
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
 * Evaluates whether a gallery card matches the active preferred language.
 */
export function isCardMatchingLanguage(
  card: Pick<ImHentaiGalleryCard, "language" | "tags" | "title" | "subtitle">,
  preferredLanguage: ImHentaiLanguageId | string
): boolean {
  if (!preferredLanguage || preferredLanguage === "all") {
    return true;
  }

  const targetLang = normalizeLanguageToken(preferredLanguage);
  if (targetLang === "all") {
    return true;
  }

  // 1. Explicit language badge
  if (card.language) {
    const cardLang = normalizeLanguageToken(card.language);
    if (cardLang !== targetLang) {
      return false;
    }
  }

  // 2. Conflicting language tags
  const tags = card.tags;
  if (Array.isArray(tags)) {
    for (let i = 0, len = tags.length; i < len; i++) {
      const raw = tags[i];
      if (!raw) continue;
      const tagLower = raw.trim().toLowerCase();

      if (targetLang === "en") {
        if (
          tagLower === "japanese" ||
          tagLower === "raw" ||
          tagLower === "untranslated" ||
          tagLower === "chinese" ||
          tagLower === "spanish" ||
          tagLower === "french" ||
          tagLower === "german" ||
          tagLower === "russian"
        ) {
          return false;
        }
      } else if (targetLang === "jp") {
        if (
          tagLower === "english" ||
          tagLower === "chinese" ||
          tagLower === "spanish" ||
          tagLower === "french" ||
          tagLower === "german" ||
          tagLower === "russian"
        ) {
          return false;
        }
      } else if (targetLang === "zh") {
        if (
          tagLower === "english" ||
          tagLower === "japanese" ||
          tagLower === "spanish" ||
          tagLower === "french" ||
          tagLower === "german" ||
          tagLower === "russian"
        ) {
          return false;
        }
      }
    }
  }

  // 3. Conflicting language tokens in title
  const title = (card.title ?? "").toLowerCase();
  if (targetLang === "en") {
    if (
      title.includes("[japanese]") ||
      title.includes("(japanese)") ||
      title.includes("[jp]") ||
      title.includes("[raw]") ||
      title.includes("(raw)") ||
      title.includes("[chinese]") ||
      title.includes("(chinese)") ||
      title.includes("[chi]") ||
      title.includes("[zh]") ||
      title.includes("[spanish]") ||
      title.includes("[french]") ||
      title.includes("[german]") ||
      title.includes("[russian]")
    ) {
      return false;
    }
  } else if (targetLang === "jp") {
    if (
      title.includes("[english]") ||
      title.includes("(english)") ||
      title.includes("[eng]") ||
      title.includes("[chinese]") ||
      title.includes("(chinese)")
    ) {
      return false;
    }
  } else if (targetLang === "zh") {
    if (
      title.includes("[english]") ||
      title.includes("(english)") ||
      title.includes("[eng]") ||
      title.includes("[japanese]") ||
      title.includes("(japanese)") ||
      title.includes("[jp]") ||
      title.includes("[raw]")
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Builds full 1/0 language query flags conforming to IMHentai native search parameter protocol:
 * - English only: &en=1&jp=0&es=0&fr=0&kr=0&de=0&ru=0
 * - Japanese only: &en=0&jp=1&es=0&fr=0&kr=0&de=0&ru=0
 * - All Languages: &en=1&jp=1&es=1&fr=1&kr=1&de=1&ru=1
 */
export function buildFullLanguageQueryFlags(rawLanguage?: unknown): string {
  const norm = normalizeLanguageToken(rawLanguage ?? "english");
  const LANG_KEYS = ["en", "jp", "es", "fr", "kr", "de", "ru"] as const;

  if (norm === "all") {
    return LANG_KEYS.map((k) => `&${k}=1`).join("");
  }

  const selectedKey = (LANG_KEYS as readonly string[]).includes(norm)
    ? norm
    : "en";

  return LANG_KEYS.map((k) => `&${k}=${k === selectedKey ? 1 : 0}`).join("");
}

/**
 * Builds full 1/0 category query flags conforming to IMHentai native search parameter protocol:
 * - d: Doujinshi
 * - m: Manga
 * - w: Western
 * - i: Image Set
 * - a: Artist CG
 * - g: Game CG
 * If a category is selected/enabled, set its parameter to 1; otherwise set it to 0.
 */
export function buildFullCategoryQueryFlags(
  activeFilter?: unknown,
  prefsCategories?: readonly unknown[] | null
): string {
  const CAT_KEYS = ["d", "m", "w", "i", "a", "g"] as const;
  const KEY_MAP: Record<string, (typeof CAT_KEYS)[number]> = {
    doujinshi: "d",
    d: "d",
    manga: "m",
    m: "m",
    western: "w",
    w: "w",
    imageset: "i",
    "image set": "i",
    "image sets": "i",
    i: "i",
    artistcg: "a",
    "artist cg": "a",
    a: "a",
    gamecg: "g",
    "game cg": "g",
    g: "g",
  };

  const activeKeys = new Set<string>();

  if (typeof activeFilter === "string" && activeFilter.trim().length > 0) {
    const clean = activeFilter.trim().toLowerCase();
    if (clean === "all" || clean === "all categories") {
      for (const k of CAT_KEYS) activeKeys.add(k);
    } else {
      const mapped = KEY_MAP[clean];
      if (mapped) {
        activeKeys.add(mapped);
      }
    }
  } else if (Array.isArray(activeFilter) && activeFilter.length > 0) {
    for (const c of activeFilter) {
      const clean = String(c).trim().toLowerCase();
      const mapped = KEY_MAP[clean];
      if (mapped) activeKeys.add(mapped);
    }
  } else if (
    isRecord(activeFilter) &&
    Array.isArray((activeFilter as Record<string, unknown>).include)
  ) {
    const inc = (activeFilter as Record<string, unknown>).include as unknown[];
    for (const c of inc) {
      const clean = String(c).trim().toLowerCase();
      const mapped = KEY_MAP[clean];
      if (mapped) activeKeys.add(mapped);
    }
  }

  // Fallback to user's enabled_categories preferences if no category was specified in the filter
  if (activeKeys.size === 0) {
    const baseCats =
      Array.isArray(prefsCategories) && prefsCategories.length > 0
        ? prefsCategories
        : DEFAULT_CATEGORIES;
    for (const c of baseCats) {
      const clean = String(c).trim().toLowerCase();
      const mapped = KEY_MAP[clean];
      if (mapped) activeKeys.add(mapped);
    }
  }

  return CAT_KEYS.map((k) => `&${k}=${activeKeys.has(k) ? 1 : 0}`).join("");
}

/**
 * Builds query string parameters combining native 1/0 category and language flags.
 */
export function buildPreferenceQueryFlags(
  prefs: ImHentaiUserPreferences,
  overrideCategories?: readonly string[] | unknown,
  overrideLanguage?: string
): string {
  const catFlags = buildFullCategoryQueryFlags(
    overrideCategories,
    prefs.categories
  );
  const langFlags = buildFullLanguageQueryFlags(
    overrideLanguage ?? prefs.language
  );
  return `${catFlags}${langFlags}`;
}

/**
 * Formats primary and subtitle strings according to user's Title Preference setting,
 * decoding HTML entities and trimming whitespace.
 */
export function formatGalleryTitleDisplay(
  englishTitle: string,
  japaneseSubtitle: string | undefined,
  prefs: ImHentaiUserPreferences
): { title: string; subtitle?: string; additionalTitles: string[] } {
  const cleanEn = decodeHtmlEntities(englishTitle);
  const cleanJp = decodeHtmlEntities(japaneseSubtitle ?? "");

  if (prefs.titlePreference === "japanese" && cleanJp.length > 0) {
    return {
      title: cleanJp,
      subtitle: cleanEn.length > 0 ? cleanEn : undefined,
      additionalTitles: cleanEn.length > 0 ? [cleanEn] : [],
    };
  }

  return {
    title: cleanEn.length > 0 ? cleanEn : cleanJp,
    subtitle: cleanJp.length > 0 ? cleanJp : undefined,
    additionalTitles: cleanJp.length > 0 ? [cleanJp] : [],
  };
}

export async function buildSettingsForm(): Promise<UIForm> {
  const prefs = await getUserPreferences();

  return {
    sections: [
      {
        header: "Allowed Categories",
        footer:
          "Select which content categories to include in browse feeds and search queries (&d=1, &m=1, &w=1, &i=1, &c=1).",
        views: [
          UISelect({
            id: PREF_KEYS.CATEGORIES,
            title: "Allowed Categories",
            options: UI_CATEGORY_OPTIONS,
            exclude: false,
            currentValue: {
              include:
                prefs.categories.length > 0
                  ? prefs.categories
                  : [...DEFAULT_CATEGORIES],
              exclude: [],
            },
            defaultValue: {
              include: [...DEFAULT_CATEGORIES],
              exclude: [],
            },
          }),
        ],
      },
      {
        header: "Languages",
        footer:
          "Filter galleries by preferred translation language (&en=1, &jp=1, &zh=1) or display All Languages.",
        views: [
          UIPicker({
            id: PREF_KEYS.LANGUAGE,
            title: "Preferred Language",
            options: UI_LANGUAGE_OPTIONS,
            currentValue: prefs.language,
            defaultValue: DEFAULT_LANGUAGE,
          }),
        ],
      },
      {
        header: "Title Formatting",
        footer:
          "Choose whether to display the English title as the primary title (with Japanese in the subtitle) or prioritize the original Japanese title.",
        views: [
          UIPicker({
            id: PREF_KEYS.TITLE_PREFERENCE,
            title: "Title Preference",
            options: UI_TITLE_PREFERENCE_OPTIONS,
            currentValue: prefs.titlePreference,
            defaultValue: DEFAULT_TITLE_PREFERENCE,
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

  let { categories, language, titlePreference } = memoryPreferences;

  const storeAvailable = hasObjectStore();
  const writeTasks: Array<Promise<unknown>> = [];

  const rawCategories =
    data[PREF_KEYS.CATEGORIES] ??
    data[PREF_KEYS.LEGACY_CATEGORIES] ??
    data["enabled_categories"] ??
    data["categories"];
  if (rawCategories !== undefined && rawCategories !== null) {
    const parsed = normalizeCategoriesList(rawCategories);
    categories = parsed.length > 0 ? parsed : [...DEFAULT_CATEGORIES];
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.CATEGORIES, categories).catch(() => {}),
        ObjectStore.set(PREF_KEYS.LEGACY_CATEGORIES, categories).catch(() => {})
      );
    }
  }

  const rawLanguage =
    data[PREF_KEYS.LANGUAGE] ??
    data[PREF_KEYS.LEGACY_LANGUAGE] ??
    data["content_languages"] ??
    data["language"];
  if (typeof rawLanguage === "string") {
    language = normalizeLanguageToken(rawLanguage);
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.LANGUAGE, language).catch(() => {}),
        ObjectStore.set(PREF_KEYS.LEGACY_LANGUAGE, language).catch(() => {})
      );
    }
  }

  const rawTitlePref =
    data[PREF_KEYS.TITLE_PREFERENCE] ??
    data[PREF_KEYS.LEGACY_TITLE_PREFERENCE] ??
    data["title_language_preference"] ??
    data["title_preference"];
  if (typeof rawTitlePref === "string") {
    titlePreference = normalizeTitlePreference(rawTitlePref);
    if (storeAvailable) {
      writeTasks.push(
        ObjectStore.set(PREF_KEYS.TITLE_PREFERENCE, titlePreference).catch(
          () => {}
        ),
        ObjectStore.set(
          PREF_KEYS.LEGACY_TITLE_PREFERENCE,
          titlePreference
        ).catch(() => {})
      );
    }
  }

  memoryPreferences = {
    categories,
    language,
    titlePreference,
  };
  isHydrated = true;

  if (writeTasks.length > 0) {
    await Promise.all(writeTasks);
  }
}

export class ImHentaiPreferenceProvider implements PreferenceProvider {
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
