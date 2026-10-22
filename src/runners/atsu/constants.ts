export const SOURCE_ID = "moe.atsu";
export const SOURCE_NAME = "Atsumaru";
export const SOURCE_VERSION = 2.3;

export const BASE_URL = "https://atsu.moe";
export const API_BASE = "https://atsu.moe/api";
export const SEARCH_ENDPOINT = `${BASE_URL}/collections/manga/documents/search`;
export const STATIC_BASE = `${BASE_URL}/static`;
export const CDN_STATIC_BASE = "https://cdn.atsu.moe/static";

export const REFERER_URL = "https://atsu.moe/";
export const ORIGIN_URL = "https://atsu.moe";
export const CLOUDFLARE_FALLBACK_URL = "https://atsu.moe";
export const FALLBACK_COVER_URL = "https://atsu.moe/favicon.ico";

export const DEFAULT_PAGE_SIZE = 40;
export const RATE_LIMIT_PER_SECOND = 2;

export const MANGA_URL_REGEX = /^https?:\/\/(?:www\.)?atsu\.moe\/manga\/([^/?#]+)/i;
export const NOVEL_URL_REGEX = /^https?:\/\/(?:www\.)?atsu\.moe\/novel\/([^/?#]+)/i;
export const CONTENT_URL_REGEX =
  /^https?:\/\/(?:www\.)?atsu\.moe\/(manga|novel)\/([^/?#]+)/i;

export const DEFAULT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  Referer: REFERER_URL,
  Origin: ORIGIN_URL,
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
});

export const IMAGE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  Referer: REFERER_URL,
  Origin: ORIGIN_URL,
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
});

export const WEBP_ACCEPT_HEADER = "image/webp,image/apng,image/*,*/*;q=0.8";

export const PAGE_IMAGE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  Referer: REFERER_URL,
  Origin: ORIGIN_URL,
});

export const PREF_KEYS = {
  IMAGE_FORMAT: "atsu_pref_image_format",
  DEDUPLICATE_CHAPTERS: "atsu_pref_deduplicate_chapters",
  SCANLATOR_WHITELIST: "atsu_pref_scanlator_whitelist",
  SHOW_NSFW: "atsu_pref_show_nsfw",
  CONTENT_RATINGS: "atsu_pref_content_ratings",
  EXCLUDED_GENRES: "atsu_pref_excluded_genres",
  EXCLUDED_TAGS: "atsu_pref_excluded_tags",
  ENABLED_FORMATS: "atsu_pref_enabled_formats",
} as const;

export const FORMAT_PREFERENCE_OPTIONS = [
  { id: "Manga", title: "Manga (Japanese graphic comics)" },
  { id: "Manhwa", title: "Manhwa (Korean webtoons)" },
  { id: "Manhua", title: "Manhua (Chinese comics)" },
  { id: "Novel", title: "Novel (Light novels and web novels)" },
  { id: "OEL", title: "OEL (Original English Language webcomics)" },
  {
    id: "OTHER",
    title: "OTHER (Anthologies, doujinshi, and miscellaneous works)",
  },
] as const;

export const DEFAULT_ENABLED_FORMATS: readonly string[] = Object.freeze([
  "Manga",
  "Manhwa",
  "Manhua",
]);

export const ALL_ENABLED_FORMATS: readonly string[] = Object.freeze([
  "Manga",
  "Manhwa",
  "Manhua",
  "Novel",
  "OEL",
  "OTHER",
]);

export const CONTENT_RATING_OPTIONS = [
  { id: "Safe", title: "Safe (All Audiences)" },
  { id: "Suggestive", title: "Suggestive (Ecchi / Mild Fanservice)" },
  { id: "Erotica", title: "Erotica / Mature" },
  { id: "Adult", title: "Adult / Pornographic (18+)" },
] as const;

export const DEFAULT_ALLOWED_CONTENT_RATINGS: readonly string[] = Object.freeze([
  "Safe",
  "Suggestive",
]);

export const ALL_CONTENT_RATINGS: readonly string[] = Object.freeze([
  "Safe",
  "Suggestive",
  "Erotica",
  "Adult",
]);

export const NSFW_RATINGS_SET: ReadonlySet<string> = new Set<string>([
  "Erotica",
  "Adult",
]);

export const IMAGE_FORMAT_OPTIONS = [
  { id: "webp", title: "WebP (Bandwidth / Battery Saving)" },
  { id: "original", title: "Original / AVIF (Maximum Resolution)" },
] as const;

export const DEDUPLICATION_MODE_OPTIONS = [
  { id: "all", title: "Show all scanlation groups" },
  { id: "single", title: "Prioritize single release per chapter" },
] as const;

export const ATSU_GENRES: ReadonlyArray<{ id: string; title: string; nsfw?: boolean }> = [
  { id: "39", title: "Action" },
  { id: "37", title: "Adventure" },
  { id: "180", title: "Boys Love" },
  { id: "6", title: "Comedy" },
  { id: "31", title: "Drama" },
  { id: "36", title: "Fantasy" },
  { id: "4", title: "Girls Love" },
  { id: "45", title: "Historical" },
  { id: "44", title: "Horror" },
  { id: "29", title: "Martial Arts" },
  { id: "32", title: "Mystery" },
  { id: "18", title: "Psychological" },
  { id: "9", title: "Romance" },
  { id: "1", title: "Sci-Fi" },
  { id: "7", title: "Slice of Life" },
  { id: "22", title: "Supernatural" },
  { id: "19", title: "Thriller" },
  { id: "5", title: "Tragedy" },
  { id: "46", title: "Adult", nsfw: true },
  { id: "41", title: "Smut", nsfw: true },
  { id: "10", title: "Hentai", nsfw: true },
];

export const ATSU_THEMES: ReadonlyArray<{ id: string; title: string }> = [
  { id: "94", title: "Isekai" },
  { id: "126", title: "Reincarnation" },
  { id: "3495", title: "Regressor Protagonist" },
  { id: "748", title: "Age Regression" },
  { id: "1010", title: "Transmigration" },
  { id: "249", title: "Time Travel" },
  { id: "3962", title: "Time Traveler" },
  { id: "363", title: "Cultivation" },
  { id: "337", title: "Swordplay" },
  { id: "121", title: "Magic" },
  { id: "528", title: "Necromancy" },
  { id: "236", title: "Super Powers" },
  { id: "883", title: "Special Ability" },
  { id: "267", title: "Video Games" },
  { id: "399", title: "Game Elements" },
  { id: "1171", title: "Level System" },
  { id: "500", title: "Dungeon" },
  { id: "594", title: "Virtual Reality" },
  { id: "42", title: "School Life" },
  { id: "854", title: "Academy" },
  { id: "162", title: "High School" },
  { id: "257", title: "College" },
  { id: "160", title: "Demons" },
  { id: "395", title: "Monsters" },
  { id: "176", title: "Gods" },
  { id: "229", title: "Ghosts" },
  { id: "252", title: "Vampires" },
  { id: "413", title: "Zombies" },
  { id: "12", title: "Gender Bender" },
  { id: "167", title: "Crossdressing" },
  { id: "30", title: "Sports" },
  { id: "11", title: "Mecha" },
  { id: "265", title: "Survival" },
  { id: "230", title: "Military" },
  { id: "353", title: "Mafia" },
  { id: "352", title: "Yakuza" },
  { id: "227", title: "Revenge" },
  { id: "266", title: "Villainess" },
  { id: "419", title: "Anti-Hero" },
  { id: "1064", title: "Weak to Strong" },
  { id: "3236", title: "Overpowered" },
  { id: "67", title: "Strong Male Lead" },
  { id: "69", title: "Strong Female Lead" },
  { id: "20", title: "Harem" },
  { id: "163", title: "Female Harem" },
  { id: "165", title: "Reverse Harem" },
  { id: "125", title: "Love Triangle" },
  { id: "106", title: "Age Gap" },
  { id: "97", title: "Childhood Friends" },
  { id: "226", title: "Unrequited Love" },
  { id: "16", title: "Yaoi" },
  { id: "33", title: "Yuri" },
  { id: "23", title: "Shounen Ai" },
  { id: "47", title: "Shoujo Ai" },
  { id: "118", title: "Omegaverse" },
  { id: "232", title: "Netorare" },
  { id: "262", title: "Gore" },
  { id: "830", title: "Violence" },
  { id: "127", title: "Nobility" },
  { id: "128", title: "Royalty" },
  { id: "450", title: "European Ambience" },
  { id: "261", title: "Urban Fantasy" },
  { id: "642", title: "Fantasy World" },
  { id: "235", title: "Bullying" },
  { id: "313", title: "Tsundere" },
  { id: "315", title: "Yandere" },
  { id: "38", title: "Shounen" },
  { id: "8", title: "Seinen" },
  { id: "40", title: "Shoujo" },
  { id: "43", title: "Josei" },
  { id: "57", title: "Full Color" },
  { id: "93", title: "Longstrip" },
  { id: "74", title: "Based on a Web Novel" },
  { id: "75", title: "Based on a Novel" },
  { id: "76", title: "Based on a Light Novel" },
  { id: "166", title: "Adapted to Anime" },
];

export const ATSU_FORMATS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "all", title: "All" },
  { id: "Manga", title: "Manga" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Manhua", title: "Manhua" },
  { id: "Novel", title: "Novel" },
  { id: "OEL", title: "OEL" },
  { id: "OTHER", title: "OTHER" },
];

export const ATSU_STATUSES: ReadonlyArray<{ id: string; title: string }> = [
  { id: "all", title: "All" },
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Canceled", title: "Cancelled" },
];

export const ATSU_SORT_OPTIONS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "trending", title: "Trending / Popular" },
  { id: "mbRating", title: "Highest Rated" },
  { id: "updatedAt", title: "Latest Updated" },
  { id: "dateAdded", title: "Recently Added" },
  { id: "title_asc", title: "Alphabetical (A-Z)" },
  { id: "title_desc", title: "Alphabetical (Z-A)" },
];
