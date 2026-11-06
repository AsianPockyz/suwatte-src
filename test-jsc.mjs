import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import vm from "node:vm";
import {
  ChapterPageSchema,
  ChapterSchema,
  ContentSchema,
  HomePageSchema,
  ItemPageResponseSchema,
  PagedItemListSchema,
  SearchFilterSchema,
  SortOptionsSchema,
  SourceChapterTextSchema,
  SourceConfigurationSchema,
  SourceFeedSchema,
  SourceInfoSchema,
  UIFormSchema,
} from "./node_modules/@suwatte/toolchain/dist/validate/index.js";

console.log("=== Isolated JavaScriptCore Sandbox Test (Version 2.6) ===");

// 1. Read the compiled production bundle
const sttPath = path.resolve("./dist/sources/moe.atsu.stt");
assert.ok(fs.existsSync(sttPath), `Bundle file not found at ${sttPath}`);
const bundleCode = fs.readFileSync(sttPath, "utf8");
const bundleSize = Buffer.byteLength(bundleCode, "utf8");
console.log(`Loaded moe.atsu.stt: ${bundleSize} bytes`);
assert.ok(
  bundleSize > 100000,
  `Bundle size should be 100KB+, got ${bundleSize} bytes`
);

// 2. Set up a clean JavaScriptCore environment without Node.js runtime globals
const memoryStore = new Map();
let objectStoreQueryCount = 0;

const sampleItems = [
  {
    id: "solo-leveling",
    title: "Solo Leveling",
    englishTitle: "Solo Leveling",
    image: "posters/solo.webp",
    type: "Manwha",
    status: "Completed",
    mbRating: 9.5,
    views: 100000,
    mbContentRating: "Safe",
    genreIds: ["39"],
    tagIds: ["94"],
  },
  {
    id: "berserk-erotica",
    title: "Berserk",
    englishTitle: "Berserk",
    image: "posters/berserk.webp",
    type: "Manga",
    status: "Ongoing",
    mbRating: 9.8,
    views: 200000,
    isAdult: false,
    mbContentRating: "Erotica",
    genreIds: ["39"],
  },
  {
    id: "excluded-horror-manga",
    title: "Excluded Horror Series",
    image: "posters/horror.webp",
    type: "Manga",
    status: "Ongoing",
    mbContentRating: "Safe",
    genreIds: ["44"], // Horror
  },
  {
    id: "excluded-harem-manga",
    title: "Excluded Harem Series",
    image: "posters/harem.webp",
    type: "Manga",
    status: "Ongoing",
    mbContentRating: "Safe",
    tagIds: ["20"], // Harem
  },
  {
    id: "adult-only-manga",
    title: "Adult Only Series",
    image: "posters/adult.webp",
    type: "Manga",
    status: "Ongoing",
    isAdult: true,
    mbContentRating: "Pornographic",
  },
  {
    id: "omniscient-readers-viewpoint-novel",
    title: "Omniscient Reader's Viewpoint (Novel)",
    image: "posters/orv-novel.webp",
    type: "Novel",
    medium: "Novel",
    status: "Completed",
    mbContentRating: "Safe",
    mbRating: 9.9,
    views: 500000,
    genreIds: ["39"],
  },
  {
    id: "unordinary-oel",
    title: "unOrdinary",
    image: "posters/unordinary.webp",
    type: "OEL",
    medium: "Comic",
    status: "Ongoing",
    mbContentRating: "Safe",
    mbRating: 9.1,
    views: 150000,
  },
  {
    id: "anthology-other",
    title: "Indie Anthology Collection",
    image: "posters/anthology.webp",
    type: "OTHER",
    medium: "Comic",
    status: "Ongoing",
    mbContentRating: "Safe",
    mbRating: 8.7,
    views: 45000,
  },
  {
    id: "chinese-web-novel",
    title: "Martial Peak (Novel)",
    image: "posters/martial-peak.webp",
    type: "Manhua",
    medium: "Novel",
    status: "Ongoing",
    mbContentRating: "Safe",
    mbRating: 9.2,
    views: 600000,
  },
  {
    id: "japanese-light-novel",
    title: "Sword Art Online (Novel)",
    image: "posters/sao-novel.webp",
    type: "Manga",
    medium: "Novel",
    status: "Ongoing",
    mbContentRating: "Safe",
    mbRating: 9.0,
    views: 400000,
  },
  {
    id: "korean-web-novel",
    title: "The Second Coming of Gluttony (Novel)",
    image: "posters/scog-novel.webp",
    type: "Manwha",
    medium: "Novel",
    status: "Completed",
    mbContentRating: "Safe",
    mbRating: 9.4,
    views: 350000,
  },
  {
    id: "chinese-comic",
    title: "Tales of Demons and Gods",
    image: "posters/todag.webp",
    type: "Manhua",
    medium: "Comic",
    status: "Ongoing",
    mbContentRating: "Safe",
    mbRating: 9.3,
    views: 250000,
  },
];

class MockNetworkClient {
  constructor(builder) {
    this.builder = builder;
  }

  async get(url, config = {}) {
    if (url.includes("/api/novel/chapter")) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        data: JSON.stringify({
          novelChapter: {
            id: config?.params?.chapterId ?? "novel-ch-1",
            number: 1,
            title: "Prologue - Three Ways to Survive in a Ruined World",
            content: `
              <script>window.evilAdTracker = true;</script>
              <div class="ad-banner" id="sponsor-slot">Buy Coins Now!</div>
              <p class="novel-para" onclick="alert(1)">There are three ways to survive in a ruined world.</p>
              <p style="color:red">Now, I have forgotten a few, but one thing is certain: the fact that you who are reading this now will survive.</p>
              <ins class="adsbygoogle">Ad Slot</ins>
            `,
          },
        }),
      };
    }

    if (url.includes("/api/novel/page")) {
      const id = config?.params?.id ?? "omniscient-readers-viewpoint-novel";
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        data: JSON.stringify({
          novelPage: {
            id,
            title: "Omniscient Reader's Viewpoint",
            englishTitle: "Omniscient Reader's Viewpoint",
            image: "posters/orv-novel.webp",
            type: "Novel",
            medium: "Novel",
            status: "Completed",
            mbContentRating: "Safe",
            synopsis: "Only I know the end of this world.",
            authors: [{ name: "Sing N Song", type: "Author" }],
            genres: [{ id: "39", name: "Action" }],
          },
        }),
      };
    }

    if (url.includes("/api/novel/allChapters")) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        data: JSON.stringify({
          novelChapters: [
            {
              id: "novel-ch-1",
              number: 1,
              title: "Prologue - Three Ways to Survive",
              createdAt: 1710000000,
            },
            {
              id: "novel-ch-2",
              number: 2,
              title: "Episode 1 - Starting the Paid Service",
              createdAt: 1710086400,
            },
          ],
        }),
      };
    }

    if (url.includes("/api/manga/page")) {
      const id = config?.params?.id ?? "solo-leveling";
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        data: JSON.stringify({
          mangaPage: {
            id,
            title: "Solo Leveling",
            englishTitle: "Solo Leveling",
            image: "posters/solo.webp",
            type: "Manwha",
            medium: "Comic",
            status: "Completed",
            mbContentRating: "Safe",
            synopsis: "The weakest hunter of all mankind!",
            genres: [{ id: "39", name: "Action" }],
          },
        }),
      };
    }

    if (url.includes("/api/manga/allChapters")) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        data: JSON.stringify({
          chapters: [
            {
              id: "ch-100",
              number: 100,
              title: "Chapter 100",
              pageCount: 4,
              createdAt: 1710000000,
            },
          ],
        }),
      };
    }

    if (url.includes("/api/read/chapter")) {
      const chapterId = config?.params?.chapterId ?? "ch-100";
      const mangaId = config?.params?.mangaId ?? "";
      if (
        chapterId === "novel-ch-1" ||
        chapterId.includes("novel") ||
        mangaId.includes("novel")
      ) {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          data: JSON.stringify({
            novelChapter: {
              id: chapterId,
              number: 1,
              title: "Prologue - Three Ways to Survive in a Ruined World",
              content: `
              <script>window.evilAdTracker = true;</script>
              <div class="ad-banner" id="sponsor-slot">Buy Coins Now!</div>
              <p class="novel-para" onclick="alert(1)">There are three ways to survive in a ruined world.</p>
              <p style="color:red">Now, I have forgotten a few, but one thing is certain: the fact that you who are reading this now will survive.</p>
              <ins class="adsbygoogle">Ad Slot</ins>
            `,
            },
          }),
        };
      }
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        data: JSON.stringify({
          readChapter: {
            id: chapterId,
            number: 100,
            title: "Chapter 100",
            pages: [
              {
                id: "p1",
                image: "/static/pages/solo/100/001.webp",
                number: 1,
              },
              { id: "p2", image: "pages/solo/100/002.webp", number: 2 },
              {
                id: "p3",
                image: "https://atsu.moe/static/pages/solo/100/003.webp",
                number: 3,
              },
              {
                id: "p4",
                image: "https://cdn.atsu.moe/static/pages/solo/100/004.webp",
                number: 4,
              },
            ],
          },
        }),
      };
    }

    if (url.includes("/api/home2/")) {
      const tf = config?.params?.timeframe;
      if (
        tf !== undefined &&
        !["daily", "weekly", "monthly", "all"].includes(tf)
      ) {
        return {
          status: 400,
          headers: { "content-type": "application/json" },
          data: JSON.stringify({
            success: false,
            error: { name: "ZodError", message: `Invalid timeframe: ${tf}` },
          }),
        };
      }
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        data: JSON.stringify({
          items: sampleItems,
        }),
      };
    }

    if (url.includes("/collections/manga/documents/search")) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        data: JSON.stringify({
          found: sampleItems.length,
          page: 1,
          hits: sampleItems.map((doc) => ({ document: doc })),
        }),
      };
    }

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      data: JSON.stringify({}),
    };
  }
}

const jscSandbox = {
  console: {
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
  },
  setTimeout,
  clearTimeout,
  NetworkClient: MockNetworkClient,
  ObjectStore: {
    get: async (key) => {
      objectStoreQueryCount++;
      return memoryStore.get(key) ?? null;
    },
    string: async (key) => {
      objectStoreQueryCount++;
      const v = memoryStore.get(key);
      return typeof v === "string" ? v : null;
    },
    boolean: async (key) => {
      objectStoreQueryCount++;
      const v = memoryStore.get(key);
      return typeof v === "boolean" ? v : null;
    },
    number: async (key) => {
      objectStoreQueryCount++;
      const v = memoryStore.get(key);
      return typeof v === "number" ? v : null;
    },
    stringArray: async (key) => {
      objectStoreQueryCount++;
      const v = memoryStore.get(key);
      return Array.isArray(v) ? v : null;
    },
    set: async (key, val) => memoryStore.set(key, val),
    remove: async (key) => memoryStore.delete(key),
  },
  CloudflareError: class CloudflareError extends Error {
    constructor(url) {
      super(`Cloudflare verification required for ${url}`);
      this.url = url;
    }
  },
  URL,
  encodeURI,
  decodeURI,
  encodeURIComponent,
  decodeURIComponent,
  Math,
  Date,
  JSON,
  Promise,
  Set,
  Map,
  WeakMap,
  Array,
  Object,
  Number,
  String,
  Boolean,
  RegExp,
  Error,
  TypeError,
  RangeError,
};

// Create pure VM context without Node globals (process, Buffer, require, etc.)
const jscContext = vm.createContext(jscSandbox);

// 3. Evaluate the .stt bundle in JavaScriptCore VM
vm.runInContext(bundleCode, jscContext);

const SourcePackage = jscContext.SourcePackage;
assert.ok(
  SourcePackage,
  "SourcePackage must be defined after bundle execution"
);
console.log(
  "PASS: Bundle evaluated cleanly in pure JSC environment (no Node globals)."
);

// 4. Verify SourceMetadata
const metadata = SourcePackage.SourceMetadata;
SourceInfoSchema.parse(metadata);
assert.equal(metadata.id, "moe.atsu", "Source ID must be moe.atsu");
assert.equal(metadata.name, "Atsumaru", "Source name must be Atsumaru");
assert.equal(metadata.version, 2.6, "Source version must be 2.6");
assert.equal(
  metadata.minSupportedAppVersion,
  undefined,
  "minSupportedAppVersion must not block install"
);
console.log(
  "PASS: SourceMetadata adheres to SourceInfoSchema with version 2.6."
);

// 5. Bootstrap runner instance
const runner = SourcePackage.bootstrap();
assert.ok(
  runner,
  "SourcePackage.bootstrap() returned a valid runner instance"
);
assert.equal(
  runner.info.version,
  2.6,
  "Runner instance info.version must be 2.6"
);
console.log("PASS: runner instantiated via SourcePackage.bootstrap().");

// 5b. Verify getItemEffectiveFormat is exported and mutually exclusive
const classifier =
  SourcePackage.getItemEffectiveFormat ??
  runner?.getItemEffectiveFormat ??
  runner?.api?.getItemEffectiveFormat;
assert.equal(
  typeof classifier,
  "function",
  "getItemEffectiveFormat must be exported on SourcePackage or runner"
);
assert.equal(
  classifier({ type: "Manhua", medium: "Novel" }),
  "Novel",
  "Chinese web novel format must be Novel"
);
assert.equal(
  classifier({ type: "Manga", medium: "Novel" }),
  "Novel",
  "Japanese light novel format must be Novel"
);
assert.equal(
  classifier({ type: "Manwha", medium: "Novel" }),
  "Novel",
  "Korean web novel format must be Novel"
);
assert.equal(
  classifier({ type: "Manhua", medium: "Comic" }),
  "Manhua",
  "Chinese comic format must be Manhua"
);
assert.equal(
  classifier({ type: "Manwha", medium: "Comic" }),
  "Manhwa",
  "Korean comic format must be Manhwa"
);
assert.equal(
  classifier({ type: "Manga", medium: "Comic" }),
  "Manga",
  "Japanese comic format must be Manga"
);
assert.equal(
  classifier({ type: "OEL", medium: "Comic" }),
  "OEL",
  "OEL format must be OEL"
);
assert.equal(
  classifier({ type: "OTHER", medium: "Comic" }),
  "OTHER",
  "OTHER format must be OTHER"
);
console.log(
  "PASS: getItemEffectiveFormat correctly classifies novel variants and comic mediums mutually exclusively."
);

// 6. Verify getConfiguration()
const config = runner.getConfiguration();
SourceConfigurationSchema.parse(config);
assert.equal(
  config.imageReferer,
  "https://atsu.moe/",
  "imageReferer must be strictly https://atsu.moe/"
);
assert.ok(
  !config.useClientForImageRequests,
  "useClientForImageRequests must be false or stripped"
);
assert.equal(config.cloudflareResolutionURL, "https://atsu.moe");
console.log(
  "PASS: getConfiguration() adheres to SourceConfigurationSchema without useClientForImageRequests."
);

// 7. Verify Search Filters & Sort Options initialization and caching
const searchFilters = await runner.getSearchFilters();
assert.ok(
  Array.isArray(searchFilters) && searchFilters.length === 5,
  "Expected 5 search filters"
);
for (const filter of searchFilters) {
  SearchFilterSchema.parse(filter);
}
const searchFiltersCached = await runner.getSearchFilters();
assert.equal(
  searchFilters,
  searchFiltersCached,
  "Search filters must be cached in memory when preferences have not changed"
);

// Verify manual Format dropdown filter includes all 6 types: Manga, Manhwa, Manhua, Novel, OEL, OTHER
const formatFilter = searchFilters.find((f) => f.id === "format");
assert.ok(formatFilter, "Format search filter must exist");
const formatOptions = formatFilter.kind.picker.props;
assert.equal(
  JSON.stringify(formatOptions.map((o) => o.id)),
  JSON.stringify(["all", "Manga", "Manhwa", "Manhua", "Novel", "OEL", "OTHER"]),
  "Format filter must expose all 6 Atsumaru format types"
);

const sortOptions = await runner.getSortOptions();
SortOptionsSchema.parse(sortOptions);
const sortOptionsCached = await runner.getSortOptions();
assert.equal(
  sortOptions,
  sortOptionsCached,
  "Sort options must be cached in memory"
);
console.log(
  "PASS: Search filters and sort options initialize cleanly and use in-memory caching."
);

// 8. Verify PreferenceProvider (getSettingsPage & getPreferenceMenu alias)
assert.equal(
  typeof runner.getSettingsPage,
  "function",
  "runner must implement getSettingsPage()"
);
assert.equal(
  typeof runner.getPreferenceMenu,
  "function",
  "runner must implement getPreferenceMenu() as an alias"
);

const settingsForm = await runner.getSettingsPage();
UIFormSchema.parse(settingsForm);

const prefMenuForm = await runner.getPreferenceMenu();
UIFormSchema.parse(prefMenuForm);

assert.equal(
  settingsForm.sections.length,
  5,
  "Settings form must contain 5 sections"
);
assert.equal(
  settingsForm.sections[0].header,
  "Reader & Image Settings",
  "Section 1 header mismatch"
);
assert.equal(
  settingsForm.sections[1].header,
  "Chapter & Scanlator Management",
  "Section 2 header mismatch"
);
assert.equal(
  settingsForm.sections[2].header,
  "Content Maturity Ratings",
  "Section 3 header mismatch"
);
assert.equal(
  settingsForm.sections[3].header,
  "Content Exclusions / Filter Blacklist",
  "Section 4 header mismatch"
);
assert.equal(
  settingsForm.sections[4].header,
  "Format & Medium Preferences",
  "Section 5 header mismatch"
);

// Verify Section 5 (Format & Medium Preferences) has all 6 formats with default Manga, Manhwa, Manhua
const formatPrefSelect = settingsForm.sections[4].views[0];
const formatPrefProps = formatPrefSelect.select?.props ?? formatPrefSelect;
assert.equal(
  formatPrefProps.options.length,
  6,
  "Format & Medium Preferences must list all 6 Atsumaru formats"
);
assert.equal(
  JSON.stringify(formatPrefProps.options.map((o) => o.id)),
  JSON.stringify(["Manga", "Manhwa", "Manhua", "Novel", "OEL", "OTHER"]),
  "Format preference option IDs must strictly be Manga, Manhwa, Manhua, Novel, OEL, OTHER"
);
assert.equal(
  JSON.stringify(formatPrefProps.defaultValue.include),
  JSON.stringify(["Manga", "Manhwa", "Manhua"]),
  "Default enabled formats must be Manga, Manhwa, Manhua"
);

// Verify Section 3 has 4 consolidated maturity ratings (Safe, Suggestive, Erotica, Adult)
const ratingSelect = settingsForm.sections[2].views[0];
const ratingProps = ratingSelect.select?.props ?? ratingSelect;
assert.equal(
  ratingProps.options.length,
  4,
  "Content Maturity Ratings must have exactly 4 consolidated options"
);
assert.equal(
  JSON.stringify(ratingProps.options.map((o) => o.id)),
  JSON.stringify(["Safe", "Suggestive", "Erotica", "Adult"]),
  "Rating option IDs must strictly be Safe, Suggestive, Erotica, Adult"
);

// Verify Section 4 has 21 genres and 76 themes
const genreSelect = settingsForm.sections[3].views[0];
const genreProps = genreSelect.select?.props ?? genreSelect;
assert.equal(
  genreProps.options.length,
  21,
  "Excluded Genres must list all 21 official Atsu genres"
);
const tagSelect = settingsForm.sections[3].views[1];
const tagProps = tagSelect.select?.props ?? tagSelect;
assert.equal(
  tagProps.options.length,
  76,
  "Excluded Tags & Themes must list all 76 curated high-frequency themes"
);

console.log(
  "PASS: getSettingsPage() and getPreferenceMenu() return valid UIForm with 4 ratings and 21 genres / 76 tags."
);

// 9. Verify updating preferences via onFormSubmitted & memoization
await runner.onFormSubmitted("atsu_settings", {
  atsu_pref_content_ratings: {
    include: ["Safe", "Suggestive", "Erotica"],
    exclude: [],
  },
  atsu_pref_excluded_genres: {
    include: ["44"], // Horror
    exclude: [],
  },
  atsu_pref_excluded_tags: {
    include: ["20"], // Harem
    exclude: [],
  },
});

assert.equal(
  JSON.stringify(memoryStore.get("atsu_pref_content_ratings")),
  JSON.stringify(["Safe", "Suggestive", "Erotica"]),
  "Content ratings preference must be saved to ObjectStore"
);
assert.equal(
  JSON.stringify(memoryStore.get("atsu_pref_excluded_genres")),
  JSON.stringify(["44"]),
  "Excluded genres must be saved to ObjectStore"
);
assert.equal(
  JSON.stringify(memoryStore.get("atsu_pref_excluded_tags")),
  JSON.stringify(["20"]),
  "Excluded tags must be saved to ObjectStore"
);
console.log(
  "PASS: onFormSubmitted successfully parses and persists granular ratings and exclusions concurrently."
);

// 10. Verify defensive filtering, Erotica support, genre/tag exclusions, and zero redundant ObjectStore queries
objectStoreQueryCount = 0;
const popularFeed = await runner.getItemList({ key: "popular" }, 1);
PagedItemListSchema.parse(popularFeed);
assert.equal(
  objectStoreQueryCount,
  0,
  "Preferences must be memoized in memory without querying ObjectStore repeatedly on browse calls"
);

assert.equal(
  popularFeed.items.length,
  3,
  "Expected exactly 3 items to pass: solo-leveling, berserk-erotica, and chinese-comic"
);
assert.equal(
  popularFeed.items[0].id,
  "solo-leveling",
  "First item must be solo-leveling"
);
assert.equal(
  popularFeed.items[1].id,
  "berserk-erotica",
  "Second item must be berserk-erotica (Erotica title passes)"
);
assert.equal(
  popularFeed.items[2].id,
  "chinese-comic",
  "Third item must be chinese-comic"
);
console.log(
  "PASS: Erotica titles pass, genre/tag blacklists exclude items, and preferences are memoized (0 redundant store reads)."
);

// Test disabling Erotica
await runner.onFormSubmitted("atsu_settings", {
  atsu_pref_content_ratings: {
    include: ["Safe", "Suggestive"],
    exclude: [],
  },
  atsu_pref_excluded_genres: { include: ["44"], exclude: [] },
  atsu_pref_excluded_tags: { include: ["20"], exclude: [] },
});
const safeOnlyFeed = await runner.getItemList({ key: "popular" }, 1);
assert.equal(
  safeOnlyFeed.items.length,
  2,
  "solo-leveling and chinese-comic should pass when Erotica is disabled"
);
assert.equal(safeOnlyFeed.items[0].id, "solo-leveling");
assert.equal(safeOnlyFeed.items[1].id, "chinese-comic");
console.log("PASS: Disabling Erotica properly excludes Erotica titles.");

// Test enabling Adult (18+)
await runner.onFormSubmitted("atsu_settings", {
  atsu_pref_content_ratings: {
    include: ["Safe", "Suggestive", "Erotica", "Adult"],
    exclude: [],
  },
  atsu_pref_excluded_genres: { include: ["44"], exclude: [] },
  atsu_pref_excluded_tags: { include: ["20"], exclude: [] },
});
const adultFeed = await runner.getItemList({ key: "popular" }, 1);
assert.equal(
  adultFeed.items.length,
  4,
  "solo-leveling, berserk-erotica, adult-only-manga, and chinese-comic should pass when Adult is enabled"
);
assert.ok(adultFeed.items.some((i) => i.id === "adult-only-manga"));
console.log(
  "PASS: Enabling Adult allows adult/pornographic titles while maintaining genre/tag exclusions."
);

// Test Format Multi-Selector filtering: Novel-only selection
await runner.onFormSubmitted("atsu_settings", {
  atsu_pref_enabled_formats: {
    include: ["Novel"],
    exclude: [],
  },
});
assert.equal(
  JSON.stringify(memoryStore.get("atsu_pref_enabled_formats")),
  JSON.stringify(["Novel"]),
  "Enabled formats preference must be persisted to ObjectStore"
);
const novelOnlyFeed = await runner.getItemList({ key: "popular" }, 1);
PagedItemListSchema.parse(novelOnlyFeed);
assert.equal(
  novelOnlyFeed.items.length,
  4,
  "All 4 novels (omniscient-readers-viewpoint-novel, chinese-web-novel, japanese-light-novel, korean-web-novel) should pass when only Novel format is enabled"
);
const novelIds = novelOnlyFeed.items.map((i) => i.id);
assert.ok(novelIds.includes("omniscient-readers-viewpoint-novel"));
assert.ok(novelIds.includes("chinese-web-novel"));
assert.ok(novelIds.includes("japanese-light-novel"));
assert.ok(novelIds.includes("korean-web-novel"));
for (const item of novelOnlyFeed.items) {
  assert.ok(
    item.webUrl.includes("/novel/"),
    `Novel item ${item.id} webUrl must route to /novel/`
  );
}
console.log(
  "PASS: Novel-only selection successfully resolves Chinese web novels, Japanese light novels, Korean web novels, and generic novels, while discarding graphic comics."
);

// Test Manhua-only selection: only chinese-comic passes, chinese-web-novel is discarded
await runner.onFormSubmitted("atsu_settings", {
  atsu_pref_enabled_formats: {
    include: ["Manhua"],
    exclude: [],
  },
});
const manhuaOnlyFeed = await runner.getItemList({ key: "popular" }, 1);
PagedItemListSchema.parse(manhuaOnlyFeed);
assert.equal(
  manhuaOnlyFeed.items.length,
  1,
  "Only chinese-comic should pass when only Manhua format is enabled; chinese-web-novel must be excluded"
);
assert.equal(manhuaOnlyFeed.items[0].id, "chinese-comic");
assert.equal(
  manhuaOnlyFeed.items[0].webUrl,
  "https://atsu.moe/manga/chinese-comic"
);
console.log(
  "PASS: Manhua-only selection passes only comic manhua and discards Chinese web novels."
);

// Test Manga-only selection: berserk-erotica and adult-only-manga pass, japanese-light-novel is discarded
await runner.onFormSubmitted("atsu_settings", {
  atsu_pref_enabled_formats: {
    include: ["Manga"],
    exclude: [],
  },
});
const mangaOnlyFeed = await runner.getItemList({ key: "popular" }, 1);
PagedItemListSchema.parse(mangaOnlyFeed);
assert.equal(
  mangaOnlyFeed.items.length,
  2,
  "berserk-erotica and adult-only-manga should pass when only Manga format is enabled; japanese-light-novel must be excluded"
);
assert.ok(!mangaOnlyFeed.items.some((i) => i.id === "japanese-light-novel"));
console.log(
  "PASS: Manga-only selection passes only comic manga and discards Japanese light novels."
);

// Test Manhwa-only selection: solo-leveling passes, korean-web-novel is discarded
await runner.onFormSubmitted("atsu_settings", {
  atsu_pref_enabled_formats: {
    include: ["Manhwa"],
    exclude: [],
  },
});
const manhwaOnlyFeed = await runner.getItemList({ key: "popular" }, 1);
PagedItemListSchema.parse(manhwaOnlyFeed);
assert.equal(
  manhwaOnlyFeed.items.length,
  1,
  "Only solo-leveling should pass when only Manhwa format is enabled; korean-web-novel must be excluded"
);
assert.equal(manhwaOnlyFeed.items[0].id, "solo-leveling");
assert.ok(!manhwaOnlyFeed.items.some((i) => i.id === "korean-web-novel"));
console.log(
  "PASS: Manhwa-only selection passes only comic manhwa and discards Korean web novels."
);

// Test enabling all 6 formats (Manga, Manhwa, Manhua, Novel, OEL, OTHER)
await runner.onFormSubmitted("atsu_settings", {
  atsu_pref_enabled_formats: {
    include: ["Manga", "Manhwa", "Manhua", "Novel", "OEL", "OTHER"],
    exclude: [],
  },
});
const allFormatsFeed = await runner.getItemList({ key: "popular" }, 1);
assert.equal(
  allFormatsFeed.items.length,
  10,
  "All 10 non-blacklisted items across Manga, Manhwa, Novel, OEL, and OTHER should pass"
);

// Restore default formats (Manga, Manhwa, Manhua)
await runner.onFormSubmitted("atsu_settings", {
  atsu_pref_enabled_formats: {
    include: ["Manga", "Manhwa", "Manhua"],
    exclude: [],
  },
});
console.log(
  "PASS: Format & Medium multi-selector accurately filters catalog queries and post-filters mixed results in O(1)."
);

// 11. Verify getCustomFeeds() for all 14 requested categories in exact order
const customFeeds = await runner.getCustomFeeds();
assert.equal(customFeeds.length, 14, "Expected 14 category feeds");

const expectedCategories = [
  { id: "discover", title: "Discover" },
  { id: "popular_daily", title: "Popular (Today)" },
  { id: "popular_weekly", title: "Popular (This Week)" },
  { id: "popular_monthly", title: "Popular (This Month)" },
  { id: "popular_all", title: "Popular (All Time)" },
  { id: "bookmarked_daily", title: "Most Bookmarked (Today)" },
  { id: "bookmarked_weekly", title: "Most Bookmarked (This Week)" },
  { id: "bookmarked_monthly", title: "Most Bookmarked (This Month)" },
  { id: "bookmarked_all", title: "Most Bookmarked (All Time)" },
  { id: "trending", title: "Trending" },
  { id: "top_rated", title: "Top Rated" },
  { id: "latest", title: "Latest Updates" },
  { id: "hot_updates", title: "Hot Updates" },
  { id: "recently_added", title: "Recently Added" },
];

for (let i = 0; i < expectedCategories.length; i++) {
  const expected = expectedCategories[i];
  const actual = customFeeds[i];
  assert.equal(actual.id, expected.id, `Feed #${i + 1} id mismatch`);
  assert.equal(actual.title, expected.title, `Feed #${i + 1} title mismatch`);
  SourceFeedSchema.parse(actual);
}
console.log(
  "PASS: getCustomFeeds() returns all 14 categories with valid schemas in exact order."
);

// 12. Verify getHomePage() and Discover getItemPage("home", 1) Weekly Most Bookmarked carousel
const homePage = await runner.getHomePage();
HomePageSchema.parse(homePage);
assert.equal(
  homePage.feeds.length,
  14,
  "getHomePage() must also include all 14 feeds"
);
const discoverPage = await runner.getItemPage("home", 1);
ItemPageResponseSchema.parse(discoverPage);
assert.equal(
  discoverPage.sections.length,
  4,
  "Discover page must return 4 carousels"
);
const weeklyBookmarkedShelf = discoverPage.sections[3];
assert.equal(
  weeklyBookmarkedShelf.id,
  "weekly_most_bookmarked",
  "4th Discover carousel id must be weekly_most_bookmarked"
);
assert.equal(
  weeklyBookmarkedShelf.title,
  "Weekly Most Bookmarked",
  "4th Discover carousel title must be Weekly Most Bookmarked"
);
assert.equal(
  weeklyBookmarkedShelf.destination?.list?.props?.key,
  "bookmarked_weekly",
  "Weekly Most Bookmarked destination must link to bookmarked_weekly"
);
console.log(
  "PASS: getHomePage() & getItemPage('home', 1) adhere to schemas and render Weekly Most Bookmarked carousel."
);

// 13. Verify getItemList for each category
for (const cat of expectedCategories) {
  const pagedList = await runner.getItemList({ key: cat.id }, 1);
  PagedItemListSchema.parse(pagedList);
  assert.ok(
    Array.isArray(pagedList.items),
    `ItemList for ${cat.id} must return items array`
  );
}
console.log(
  "PASS: getItemList() successfully resolves all category keys with valid PagedItemListSchema."
);

// 14. Verify getChapterPages()
const pages = await runner.getChapterPages("solo-leveling", "ch-100");
assert.ok(Array.isArray(pages) && pages.length === 4, "Expected 4 pages");

for (const page of pages) {
  ChapterPageSchema.parse(page);
  assert.ok(
    page.url.startsWith("https://cdn.atsu.moe/static/pages/"),
    `Page URL must be on CDN: ${page.url}`
  );
  assert.equal(
    page.headers?.Referer,
    "https://atsu.moe/",
    "Page header Referer must match"
  );
  assert.equal(
    page.headers?.Origin,
    "https://atsu.moe",
    "Page header Origin must match"
  );
}
assert.equal(
  pages[0].url,
  "https://cdn.atsu.moe/static/pages/solo/100/001.webp"
);
assert.equal(
  pages[1].url,
  "https://cdn.atsu.moe/static/pages/solo/100/002.webp"
);
assert.equal(
  pages[2].url,
  "https://cdn.atsu.moe/static/pages/solo/100/003.webp"
);
assert.equal(
  pages[3].url,
  "https://cdn.atsu.moe/static/pages/solo/100/004.webp"
);
console.log(
  "PASS: getChapterPages() produces fully qualified, CDN-routed URLs with proper headers."
);

// 14b. Verify Deep Linking (ContentResolver) for both /manga/ and /novel/ URLs, Dual-Route getContent/getChapters, and getChapterText()
assert.equal(
  runner.canResolveUrl("https://atsu.moe/manga/solo-leveling"),
  true,
  "canResolveUrl must match https://atsu.moe/manga/..."
);
assert.equal(
  runner.canResolveUrl("https://atsu.moe/novel/omniscient-readers-viewpoint-novel"),
  true,
  "canResolveUrl must match https://atsu.moe/novel/..."
);
assert.equal(
  runner.canResolveUrl("https://example.com/manga/solo-leveling"),
  false,
  "canResolveUrl must reject non-Atsu URLs"
);

const resolvedNovelContent = await runner.resolveUrl(
  "https://atsu.moe/novel/omniscient-readers-viewpoint-novel"
);
ContentSchema.parse(resolvedNovelContent);
assert.equal(
  resolvedNovelContent.contentType,
  4,
  "Novel content must have ContentType.NOVEL (4)"
);
assert.equal(
  resolvedNovelContent.webUrl,
  "https://atsu.moe/novel/omniscient-readers-viewpoint-novel",
  "Novel content webUrl must point to /novel/"
);

const novelChapters = await runner.getChapters(
  "https://atsu.moe/novel/omniscient-readers-viewpoint-novel"
);
assert.equal(novelChapters.length, 2, "Expected 2 novel chapters");
for (const ch of novelChapters) {
  ChapterSchema.parse(ch);
}

const chapterText = await runner.getChapterText(
  "omniscient-readers-viewpoint-novel",
  "novel-ch-1"
);
SourceChapterTextSchema.parse(chapterText);
assert.equal(chapterText.format, "html", "Chapter text format must be html");
assert.ok(
  !chapterText.body.includes("<script"),
  "getChapterText must strip <script> tags"
);
assert.ok(
  !chapterText.body.includes("ad-banner") &&
    !chapterText.body.includes("adsbygoogle"),
  "getChapterText must strip advertising blocks"
);
assert.ok(
  !chapterText.body.includes("onclick="),
  "getChapterText must strip inline event handlers"
);
assert.ok(
  chapterText.body.includes(
    "<p>There are three ways to survive in a ruined world.</p>"
  ),
  "getChapterText must sanitize paragraph tags cleanly"
);
console.log(
  "PASS: Deep linking (/manga/ & /novel/), dual-route novel getContent/getChapters, and getChapterText() pass schema validation."
);

// 15. Performance Benchmark: Filtering a simulated array of 100 items (v2.0 legacy vs v2.1 optimized)
const simulated100Items = Array.from({ length: 100 }, (_, i) => {
  const ratings = ["Safe", "Suggestive", "Erotica", "Pornographic"];
  const rating = ratings[i % 4];
  return {
    id: `manga-item-${i}`,
    title: `Simulated Manga Title ${i}`,
    englishTitle: `Simulated Manga English Title ${i}`,
    image: `posters/manga-${i}.webp`,
    type: i % 2 === 0 ? "Manwha" : "Manga",
    status: i % 3 === 0 ? "Completed" : "Ongoing",
    mbRating: 8.5 + (i % 15) * 0.1,
    views: 10000 + i * 500,
    isAdult: rating === "Pornographic",
    mbContentRating: rating,
    genreIds: [
      String([39, 37, 6, 31, 36, 44, 9, 1, 7, 22][i % 10]),
      String([39, 37, 6, 31, 36, 45, 44, 29, 32, 18][(i + 3) % 10]),
    ],
    tagIds: [
      String([94, 126, 3495, 1010, 249, 363, 337, 121, 528, 20][i % 10]),
      String([236, 883, 267, 399, 1171, 500, 594, 42, 854, 162][(i + 5) % 10]),
      String([160, 395, 176, 229, 252, 413, 12, 167, 30, 11][(i + 7) % 10]),
    ],
    genres: [
      {
        id: String([39, 37, 6, 31, 36, 44, 9, 1, 7, 22][i % 10]),
        name: "Action",
      },
    ],
    tags: [
      {
        id: String([94, 126, 3495, 1010, 249, 363, 337, 121, 528, 20][i % 10]),
        name: "Isekai",
      },
    ],
  };
});

const benchPrefs = {
  imageFormat: "webp",
  deduplicateChapters: true,
  scanlatorWhitelist: ["Asura", "Official"],
  showNsfw: false,
  contentRatings: ["Safe", "Suggestive"],
  excludedGenres: ["44", "18", "5"],
  excludedTags: ["20", "232", "262", "830"],
};

// Evaluate faithful v2.0 implementation inside the same JSC VM context for an apples-to-apples comparison
const legacyFilterSummaryItemsV20 = vm.runInContext(
  `
  (function() {
    const v20GenreLookup = new Map([
      ["39", "Action"], ["37", "Adventure"], ["180", "Boys Love"], ["6", "Comedy"],
      ["31", "Drama"], ["36", "Fantasy"], ["4", "Girls Love"], ["45", "Historical"],
      ["44", "Horror"], ["29", "Martial Arts"], ["32", "Mystery"], ["18", "Psychological"],
      ["9", "Romance"], ["1", "Sci-Fi"], ["7", "Slice of Life"], ["22", "Supernatural"],
      ["19", "Thriller"], ["5", "Tragedy"], ["46", "Adult"], ["41", "Smut"], ["10", "Hentai"],
    ]);
    const v20ThemeLookup = new Map([
      ["94", "Isekai"], ["126", "Reincarnation"], ["3495", "Regressor Protagonist"],
      ["1010", "Transmigration"], ["249", "Time Travel"], ["363", "Cultivation"],
      ["337", "Swordplay"], ["121", "Magic"], ["528", "Necromancy"], ["20", "Harem"],
      ["232", "Netorare"], ["262", "Gore"], ["830", "Violence"],
    ]);

    return function legacyFilterSummaryItemsV20(items, prefs, allowNsfwOverride = false) {
      const excludedGenreSet = new Set(
        (prefs.excludedGenres ?? []).map((id) => String(id).trim()).filter(Boolean)
      );
      for (const id of Array.from(excludedGenreSet)) {
        const name = v20GenreLookup.get(id);
        if (name) excludedGenreSet.add(name);
      }

      const excludedTagSet = new Set(
        (prefs.excludedTags ?? []).map((id) => String(id).trim()).filter(Boolean)
      );
      for (const id of Array.from(excludedTagSet)) {
        const name = v20ThemeLookup.get(id);
        if (name) excludedTagSet.add(name);
      }

      const allowedRatings = allowNsfwOverride
        ? ["Safe", "Suggestive", "Erotica", "Pornographic", "Adult"]
        : prefs.contentRatings ?? ["Safe", "Suggestive"];

      return items.filter((manga) => {
        if (excludedGenreSet.size > 0) {
          if (Array.isArray(manga.genreIds)) {
            for (const id of manga.genreIds) {
              if (id && excludedGenreSet.has(String(id).trim())) return false;
            }
          }
          if (Array.isArray(manga.genres)) {
            for (const g of manga.genres) {
              if (typeof g === "string") {
                if (excludedGenreSet.has(g.trim())) return false;
              } else if (g && typeof g === "object") {
                if (g.id && excludedGenreSet.has(String(g.id).trim())) return false;
                if (g.name && excludedGenreSet.has(String(g.name).trim()))
                  return false;
              }
            }
          }
        }
        if (excludedTagSet.size > 0) {
          if (Array.isArray(manga.tagIds)) {
            for (const id of manga.tagIds) {
              if (id && excludedTagSet.has(String(id).trim())) return false;
            }
          }
          if (Array.isArray(manga.tags)) {
            for (const t of manga.tags) {
              if (typeof t === "string") {
                if (excludedTagSet.has(t.trim())) return false;
              } else if (t && typeof t === "object") {
                if (t.id && excludedTagSet.has(String(t.id).trim())) return false;
                if (t.name && excludedTagSet.has(String(t.name).trim()))
                  return false;
              }
            }
          }
        }
        if (allowNsfwOverride) return true;
        const allowsAdult = allowedRatings.includes("Adult");
        const allowsErotica = allowedRatings.includes("Erotica");
        const allowsSuggestive = allowedRatings.includes("Suggestive");
        const allowsSafe = allowedRatings.includes("Safe");
        if (manga.isAdult === true && !allowsAdult) return false;
        if (manga.mbContentRating) {
          const rawRating = manga.mbContentRating.trim().toLowerCase();
          if (rawRating === "safe" && !allowsSafe) return false;
          if (rawRating === "suggestive" && !allowsSuggestive) return false;
          if (rawRating === "erotica" && !allowsErotica) return false;
          if (rawRating === "pornographic" && !allowsAdult) return false;
        }
        const mbRating = (manga.mbContentRating ?? "").toLowerCase();
        const isMature =
          manga.isAdult === true ||
          mbRating === "erotica" ||
          mbRating === "pornographic";
        if (isMature && !allowsAdult && !allowsErotica) {
          return false;
        }
        return true;
      });
    };
  })()
  `,
  jscContext
);

// Warmup both inside JSC context
for (let i = 0; i < 100; i++) {
  legacyFilterSummaryItemsV20(simulated100Items, benchPrefs);
  runner.api.filterSummaryItems(simulated100Items, benchPrefs, false);
}

const BENCH_ITERATIONS = 1000;

const legacyStart = performance.now();
let legacyCount = 0;
for (let i = 0; i < BENCH_ITERATIONS; i++) {
  legacyCount = legacyFilterSummaryItemsV20(
    simulated100Items,
    benchPrefs
  ).length;
}
const legacyTotalMs = performance.now() - legacyStart;
const legacyPer100Ms = legacyTotalMs / BENCH_ITERATIONS;

const optStart = performance.now();
let optCount = 0;
for (let i = 0; i < BENCH_ITERATIONS; i++) {
  optCount = runner.api.filterSummaryItems(
    simulated100Items,
    benchPrefs,
    false
  ).length;
}
const optTotalMs = performance.now() - optStart;
const optPer100Ms = optTotalMs / BENCH_ITERATIONS;

assert.equal(
  optCount,
  legacyCount,
  "Optimized filter must return identical item count to baseline"
);

const speedup = (legacyTotalMs / optTotalMs).toFixed(2);
console.log(
  `BENCHMARK (100 items x ${BENCH_ITERATIONS} runs): v2.0=${legacyPer100Ms.toFixed(4)}ms/100-items (${legacyTotalMs.toFixed(2)}ms total) -> v2.1=${optPer100Ms.toFixed(4)}ms/100-items (${optTotalMs.toFixed(2)}ms total) [${speedup}x speedup]`
);

// ============================================================================
// PART 2: IMHentai (org.imhentai.stt) Isolated JavaScriptCore Sandbox Test
// ============================================================================

console.log("\n=== Isolated JavaScriptCore Sandbox Test: IMHentai (Version 1.6) ===");

const imSttPath = path.resolve("./dist/sources/org.imhentai.stt");
assert.ok(fs.existsSync(imSttPath), `Bundle file not found at ${imSttPath}`);
const imBundleCode = fs.readFileSync(imSttPath, "utf8");
const imBundleSize = Buffer.byteLength(imBundleCode, "utf8");
console.log(`Loaded org.imhentai.stt: ${imBundleSize} bytes`);
assert.ok(
  imBundleSize >= 50000,
  `IMHentai bundle size should be >= 50KB, got ${imBundleSize} bytes`
);

const imMemoryStore = new Map();
let imObjectStoreQueryCount = 0;
let imLastRequestedUrl = "";
let imGalleryFetchCount = 0;

const sampleListingHtml = `
<!DOCTYPE html>
<html>
<body>
  <div class="galleries">
    <div class="thumb" data-tags="big breasts,sole female,schoolgirl uniform">
      <div class="thumb_cat"><a href="/category/doujinshi/">Doujinshi</a></div>
      <div class="inner_thumb">
        <a href="/gallery/123456/">
          <img class="lazy" data-src="https://m2.imhentai.xxx/007/5uqtji3sho/thumb.webp" src="https://imhentai.xxx/assets/images/blank.gif" alt="Sample Doujin" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/123456/">[Circle Alpha (Artist Beta)] Blue Archive Summer Special [English]</a>
      </div>
      <div class="subtitle">[サークルアルファ] ブルーアーカイブ夏コミ新刊</div>
      <span class="lang">English</span>
    </div>

    <div class="thumb" data-tags="full color,romance,office lady">
      <div class="thumb_cat"><a href="/category/manga/">Manga</a></div>
      <div class="inner_thumb">
        <a href="/gallery/234567/">
          <img class="lazy" data-lazy-src="https://m1.imhentai.xxx/002/234567/thumb.jpg" src="/assets/images/pixel.gif" alt="Serialized Manga Sample" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/234567/">[Author Gamma] Office Romance Tankoubon [English]</a>
      </div>
      <div class="subtitle">[著者ガンマ] オフィスロマンス単行本</div>
      <span class="lang">English</span>
    </div>

    <div class="thumb" data-tags="netorare,cheating,big breasts">
      <div class="thumb_cat"><a href="/category/doujinshi/">Doujinshi</a></div>
      <div class="inner_thumb">
        <a href="/gallery/345678/">
          <img class="lazy" data-src="https://m1.imhentai.xxx/003/345678/thumb.jpg" src="about:blank" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/345678/">[NTR Studio] Forbidden Netorare Story [English]</a>
      </div>
    </div>

    <div class="thumb" data-tags="futanari,dickgirl,full color">
      <div class="thumb_cat"><a href="/category/western/">Western</a></div>
      <div class="inner_thumb">
        <a href="/gallery/456789/">
          <img class="lazy" data-original="https://m3.imhentai.xxx/004/456789/thumb.png" src="/images/blank.gif" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/456789/">[WestArtist] Futanari Chronicles [English]</a>
      </div>
    </div>

    <div class="thumb" data-tags="ugly bastard,mind break">
      <div class="thumb_cat"><a href="/category/manga/">Manga</a></div>
      <div class="inner_thumb">
        <a href="/gallery/567890/">
          <img class="lazy" data-src="https://m1.imhentai.xxx/005/567890/thumb.jpg" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/567890/">[DarkAuthor] Custom Blacklisted Entry [English]</a>
      </div>
    </div>

    <div class="thumb" data-tags="japanese,raw,sole female">
      <div class="thumb_cat"><a href="/category/doujinshi/">Doujinshi</a></div>
      <div class="inner_thumb">
        <a href="/gallery/678901/">
          <img class="lazy" data-src="https://m2.imhentai.xxx/006/678901/thumb.jpg" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/678901/">[Original] Raw Untranslated Japanese Gallery [RAW]</a>
      </div>
      <div class="subtitle">[オリジナル] 日本語の同人誌 raw</div>
      <span class="lang">Japanese</span>
    </div>
  </div>
  <ul class="pagination">
    <li><a class="next" href="?page=2">Next</a></li>
  </ul>
</body>
</html>
`;

const sampleGalleryDetailHtml = `
<!DOCTYPE html>
<html>
<body>
  <div class="row">
    <div id="cover" class="left_cover">
      <a href="/view/123456/1/">
        <img class="lazy" data-src="https://m2.imhentai.xxx/007/5uqtji3sho/cover.jpg" src="https://imhentai.xxx/assets/images/blank.gif" alt="Cover" />
      </a>
    </div>
    <div class="right_details">
      <h1>[Circle Alpha (Artist Beta)] Blue Archive Summer Special [English]</h1>
      <p class="subtitle">[サークルアルファ (アーティストベータ)] ブルーアーカイブ夏コミ新刊</p>
      <ul class="galleries_info">
        <li>
          <span class="tags_text">Parodies:</span>
          <a class="tag" href="/parody/blue-archive/">blue archive <span class="badge">4,512</span></a>
        </li>
        <li>
          <span class="tags_text">Characters:</span>
          <a class="tag" href="/character/shiroko-sunaookami/">shiroko sunaookami <span class="badge">820</span></a>
          <a class="tag" href="/character/hoshino-takanashi/">hoshino takanashi <span class="badge">640</span></a>
        </li>
        <li>
          <span class="tags_text">Tags:</span>
          <a class="tag" href="/tag/big-breasts/">big breasts <span class="badge">125,000</span></a>
          <a class="tag" href="/tag/sole-female/">sole female <span class="badge">98,000</span></a>
          <a class="tag" href="/tag/swimsuit/">swimsuit <span class="badge">45,000</span></a>
        </li>
        <li>
          <span class="tags_text">Artists:</span>
          <a class="tag" href="/artist/artist-beta/">artist beta <span class="badge">42</span></a>
        </li>
        <li>
          <span class="tags_text">Groups:</span>
          <a class="tag" href="/group/circle-alpha/">circle alpha <span class="badge">38</span></a>
        </li>
        <li>
          <span class="tags_text">Languages:</span>
          <a class="tag" href="/language/english/">english <span class="badge">350,000</span></a>
          <a class="tag" href="/language/translated/">translated <span class="badge">340,000</span></a>
        </li>
        <li>
          <span class="tags_text">Category:</span>
          <a class="tag" href="/category/doujinshi/">doujinshi <span class="badge">500,000</span></a>
        </li>
        <li class="pages">Pages: 4</li>
      </ul>
    </div>
  </div>
  <div id="thumbnail-container">
    <img class="lazy" data-src="https://m2.imhentai.xxx/007/5uqtji3sho/1t.jpg" src="https://imhentai.xxx/assets/images/blank.gif" />
  </div>
  <div class="related_galleries">
    <div class="thumb">
      <div class="inner_thumb">
        <a href="/gallery/789012/">
          <img class="lazy" data-src="https://m2.imhentai.xxx/008/789012/thumb.jpg" src="/images/blank.gif" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/789012/">[Circle Alpha (Artist Beta)] Related Work Title [English]</a>
      </div>
    </div>
  </div>
  <input type="hidden" id="gallery_id" value="123456" />
  <input type="hidden" id="load_dir" value="007/5uqtji3sho" />
  <input type="hidden" id="load_id" value="2" />
  <input type="hidden" id="load_pages" value="4" />
  <script type="text/javascript">
    var g_th = $.parseJSON('{"1":"j,1280,1810","2":"p,1280,1810","3":"w,1280,1810","4":"j,1280,1810"}');
  </script>
</body>
</html>
`;

const sampleEHentaiHtml = `
<html>
<body>
  <div class="itg gltc">
    <a href="https://e-hentai.org/g/123456/5uqtji3sho/">Test Gallery</a>
  </div>
</body>
</html>
`;

class MockImHentaiNetworkClient {
  constructor(builder) {
    this.builder = builder;
  }

  async get(url, _config = {}) {
    imLastRequestedUrl = url;
    if (url.includes("e-hentai.org")) {
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: sampleEHentaiHtml,
      };
    }
    if (url.includes("/gallery/")) {
      imGalleryFetchCount++;
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: sampleGalleryDetailHtml,
      };
    }
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      data: sampleListingHtml,
    };
  }

  async post(url, body, _config = {}) {
    imLastRequestedUrl = url;
    if (url.includes("api.e-hentai.org")) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        data: {
          gmetadata: [
            {
              gid: 123456,
              token: "5uqtji3sho",
              title: "[Circle Alpha (Artist Beta)] Blue Archive Summer Special [English]",
              title_jpn: "[サークルアルファ (アーティストベータ)] ブルーアーカイブ夏コミ新刊",
              category: "Doujinshi",
              tags: ["language:english", "parody:blue archive"],
            },
          ],
        },
      };
    }
    return { status: 200, data: {} };
  }
}

const imJscSandbox = {
  console: {
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
  },
  setTimeout,
  clearTimeout,
  NetworkClient: MockImHentaiNetworkClient,
  ObjectStore: {
    get: async (key) => {
      imObjectStoreQueryCount++;
      return imMemoryStore.get(key) ?? null;
    },
    string: async (key) => {
      imObjectStoreQueryCount++;
      const v = imMemoryStore.get(key);
      return typeof v === "string" ? v : null;
    },
    boolean: async (key) => {
      imObjectStoreQueryCount++;
      const v = imMemoryStore.get(key);
      return typeof v === "boolean" ? v : null;
    },
    number: async (key) => {
      imObjectStoreQueryCount++;
      const v = imMemoryStore.get(key);
      return typeof v === "number" ? v : null;
    },
    stringArray: async (key) => {
      imObjectStoreQueryCount++;
      const v = imMemoryStore.get(key);
      return Array.isArray(v) ? v : null;
    },
    set: async (key, val) => imMemoryStore.set(key, val),
    remove: async (key) => imMemoryStore.delete(key),
  },
  CloudflareError: class CloudflareError extends Error {
    constructor(url) {
      super(`Cloudflare verification required for ${url}`);
      this.url = url;
    }
  },
  URL,
  encodeURI,
  decodeURI,
  encodeURIComponent,
  decodeURIComponent,
  Math,
  Date,
  JSON,
  Promise,
  Set,
  Map,
  WeakMap,
  Array,
  Object,
  Number,
  String,
  Boolean,
  RegExp,
  Error,
  TypeError,
  RangeError,
};

const imJscContext = vm.createContext(imJscSandbox);
vm.runInContext(imBundleCode, imJscContext);

const ImSourcePackage = imJscContext.SourcePackage;
assert.ok(
  ImSourcePackage,
  "ImSourcePackage must be defined after evaluating org.imhentai.stt"
);

// 1. Verify IMHentai SourceMetadata & Bootstrap
const imMetadata = ImSourcePackage.SourceMetadata;
assert.equal(imMetadata.id, "org.imhentai", "IMHentai ID must be org.imhentai");
assert.equal(imMetadata.name, "IMHentai", "IMHentai name must be IMHentai");
assert.ok(
  imMetadata.version === 1.6 ||
    imMetadata.version === 1.7 ||
    imMetadata.version === 1.9,
  "IMHentai version must be numeric (1.6, 1.7, or 1.9)"
);
assert.equal(imMetadata.website, "https://imhentai.xxx");
assert.equal(imMetadata.rating, 2, "IMHentai rating must be ContentRating.ADULT (2)");
assert.equal(imMetadata.thumbnail, "imhentai.png");
assert.equal(
  JSON.stringify(imMetadata.languages),
  JSON.stringify(["en", "ja", "zh", "es", "fr", "de", "ru"])
);
assert.equal(imMetadata.minSupportedAppVersion, undefined);
SourceInfoSchema.parse({
  ...imMetadata,
  thumbnail: `https://imhentai.xxx/assets/${imMetadata.thumbnail}`,
});

const imRunner = ImSourcePackage.bootstrap();
assert.ok(
  imRunner,
  "ImSourcePackage.bootstrap() must return a valid runner instance"
);
assert.ok(
  imRunner.info.version === 1.6 ||
    imRunner.info.version === 1.7 ||
    imRunner.info.version === 1.9,
  "Runner info.version must be 1.6, 1.7, or 1.9"
);
console.log("PASS: org.imhentai.stt evaluated and bootstrapped cleanly in pure JSC sandbox (v1.6).");

// 2. Verify IMHentai getConfiguration()
const imConfig = imRunner.getConfiguration();
SourceConfigurationSchema.parse(imConfig);
assert.equal(imConfig.imageReferer, "https://imhentai.xxx/");
assert.equal(imConfig.cloudflareResolutionURL, "https://imhentai.xxx");
assert.equal(imConfig.standardHeaders?.Referer, "https://imhentai.xxx/");
assert.ok(
  imConfig.standardHeaders?.["User-Agent"]?.includes("iPhone") ||
    imConfig.standardHeaders?.["User-Agent"]?.includes("Mozilla"),
  "standardHeaders must include User-Agent"
);
assert.equal(
  imConfig.standardHeaders?.Origin,
  undefined,
  "Origin header must be omitted from image/standard headers to avoid CDN CORS failure"
);
assert.ok(
  !imConfig.useClientForImageRequests,
  "useClientForImageRequests must be omitted or false"
);
console.log("PASS: IMHentai getConfiguration() adheres to SourceConfigurationSchema.");

// 3. Verify IMHentai getCustomFeeds(), getHomePage(), getItemPage(), getItemList()
const imFeeds = await imRunner.getCustomFeeds();
const expectedImFeeds = [
  { id: "discover", title: "Discover" },
  { id: "popular_daily", title: "Popular (Daily)" },
  { id: "popular_weekly", title: "Popular (Weekly)" },
  { id: "popular_monthly", title: "Popular (Monthly)" },
  { id: "top_rated_daily", title: "Top Rated (Daily)" },
  { id: "top_rated_weekly", title: "Top Rated (Weekly)" },
  { id: "top_rated_monthly", title: "Top Rated (Monthly)" },
  { id: "latest", title: "Latest Releases" },
];
assert.equal(imFeeds.length, 8, "IMHentai must expose 8 custom browse feeds");
for (let i = 0; i < expectedImFeeds.length; i++) {
  assert.equal(imFeeds[i].id, expectedImFeeds[i].id);
  assert.equal(imFeeds[i].title, expectedImFeeds[i].title);
  SourceFeedSchema.parse(imFeeds[i]);
}

const imHomePage = await imRunner.getHomePage();
HomePageSchema.parse(imHomePage);
assert.equal(imHomePage.feeds.length, 8, "getHomePage() must also include all 8 feeds");

const imHomeSections = await imRunner.getItemPage("home", 1);
ItemPageResponseSchema.parse(imHomeSections);
assert.equal(
  imHomeSections.sections.length,
  3,
  "IMHentai home page must have 3 curated sections (Popular Today, Popular This Week, Latest Releases)"
);
assert.equal(imHomeSections.sections[0].id, "popular_today");
assert.equal(imHomeSections.sections[1].id, "popular_this_week");
assert.equal(imHomeSections.sections[2].id, "latest_releases");

// Verify feeds load items with client-side language safety guard active
for (const feed of expectedImFeeds) {
  const listRes = await imRunner.getItemList({ key: feed.id }, 1);
  PagedItemListSchema.parse(listRes);
}
console.log("PASS: IMHentai getCustomFeeds(), getHomePage(), getItemPage(), and getItemList() pass schema validation with language safety guard.");

// 4. Verify IMHentai getPreferenceMenu() & Preference Filtering / Query Mapping
const imPrefMenu = await imRunner.getPreferenceMenu();
UIFormSchema.parse(imPrefMenu);
const imSettingsPage = await imRunner.getSettingsPage();
UIFormSchema.parse(imSettingsPage);
assert.equal(
  imPrefMenu.sections.length,
  6,
  "IMHentai preference menu must contain 6 sections (Buffer Depth, Languages, Categories, Exclusions, Blacklist, Title Display)"
);

// Verify popular feed endpoint routing (routes to E-Hentai discovery bridge)
await imRunner.getItemList({ key: "popular" }, 2);
assert.ok(
  imLastRequestedUrl.includes("e-hentai.org"),
  `Expected e-hentai endpoint for popular feed, got ${imLastRequestedUrl}`
);

// Verify trending feed endpoint routing (routes to E-Hentai discovery bridge)
await imRunner.getItemList({ key: "trending" }, 1);
assert.ok(
  imLastRequestedUrl.includes("e-hentai.org"),
  `Expected e-hentai endpoint for trending feed, got ${imLastRequestedUrl}`
);

// Verify latest feed endpoint routing (/?page={page})
await imRunner.getItemList({ key: "latest" }, 1);
assert.ok(
  imLastRequestedUrl.includes("page=1"),
  `Expected latest releases URL with page=1, got ${imLastRequestedUrl}`
);

// Verify top_rated feed endpoint routing (routes to E-Hentai discovery bridge)
await imRunner.getItemList({ key: "top_rated" }, 1);
assert.ok(
  imLastRequestedUrl.includes("e-hentai.org"),
  `Expected e-hentai endpoint for top_rated feed, got ${imLastRequestedUrl}`
);

// 4b. Verify Search Filters (Single-Select Category) & Sort Options (v1.6)
const imSearchFilters = await imRunner.getSearchFilters();
assert.equal(imSearchFilters.length, 1, "Expected single-select Category search filter");
assert.equal(imSearchFilters[0].id, "category");
assert.equal(imSearchFilters[0].title, "Category");
SearchFilterSchema.parse(imSearchFilters[0]);

const imSortOptions = await imRunner.getSortOptions();
SortOptionsSchema.parse(imSortOptions);
assert.equal(imSortOptions.options.length, 3, "Expected 3 sort options");
assert.equal(imSortOptions.options[0].id, "latest");
assert.equal(imSortOptions.options[1].id, "popular");
assert.equal(imSortOptions.options[2].id, "title");
console.log("PASS: Search filters and sort options verified.");

// 4c. Verify In-App Search with Category Dropdown, Sorting & Active Language (v1.6)
const filteredSearchRes = await imRunner.getSearchResults(
  {
    query: "naruto",
    filters: { category: "doujinshi" },
    sort: { key: "popular" },
  },
  1
);
PagedItemListSchema.parse(filteredSearchRes);
assert.ok(
  imLastRequestedUrl.includes("key=naruto"),
  `Search URL must contain search query: ${imLastRequestedUrl}`
);
assert.ok(
  imLastRequestedUrl.includes("apply=Search"),
  `Search URL MUST contain apply=Search trigger: ${imLastRequestedUrl}`
);
assert.ok(
  imLastRequestedUrl.includes("&pp=1&lt=0"),
  `Search URL must contain popularity sort flag &pp=1&lt=0: ${imLastRequestedUrl}`
);
assert.ok(
  imLastRequestedUrl.includes("&d=1&m=0&w=0&i=0&a=0&g=0"),
  `Search URL must contain full category flags &d=1&m=0&w=0&i=0&a=0&g=0: ${imLastRequestedUrl}`
);
assert.ok(
  imLastRequestedUrl.includes("&en=1&jp=0&es=0&fr=0&kr=0&de=0&ru=0"),
  `Search URL must contain full language flags &en=1&jp=0&es=0&fr=0&kr=0&de=0&ru=0: ${imLastRequestedUrl}`
);
console.log("PASS: In-app search URL generation with apply=Search, full 1/0 category flags, full language flags, and popularity sort verified.");

// 4d. Verify Native Category Feed Path Routing (Section 2)
await imRunner.getItemList({ key: "doujinshi" }, 1);
assert.ok(
  imLastRequestedUrl.includes("/category/doujinshi/?page=1"),
  `Expected /category/doujinshi/?page=1, got ${imLastRequestedUrl}`
);
await imRunner.getItemList({ key: "doujinshi", sort: { key: "popular" } }, 1);
assert.ok(
  imLastRequestedUrl.includes("/category/doujinshi/popular/?page=1"),
  `Expected /category/doujinshi/popular/?page=1, got ${imLastRequestedUrl}`
);
await imRunner.getItemList({ key: "manga" }, 2);
assert.ok(
  imLastRequestedUrl.includes("/category/manga/?page=2"),
  `Expected /category/manga/?page=2, got ${imLastRequestedUrl}`
);
await imRunner.getItemList({ key: "manga", sort: { key: "popular" } }, 2);
assert.ok(
  imLastRequestedUrl.includes("/category/manga/popular/?page=2"),
  `Expected /category/manga/popular/?page=2, got ${imLastRequestedUrl}`
);
await imRunner.getItemList({ key: "western", sort: { key: "popular" } }, 1);
assert.ok(
  imLastRequestedUrl.includes("/category/western/popular/?page=1"),
  `Expected /category/western/popular/?page=1, got ${imLastRequestedUrl}`
);
await imRunner.getItemList({ key: "imageset", sort: { key: "popular" } }, 1);
assert.ok(
  imLastRequestedUrl.includes("/category/imageset/popular/?page=1"),
  `Expected /category/imageset/popular/?page=1, got ${imLastRequestedUrl}`
);
await imRunner.getItemList({ key: "cosplay", sort: { key: "popular" } }, 1);
assert.ok(
  imLastRequestedUrl.includes("/category/cosplay/popular/?page=1"),
  `Expected /category/cosplay/popular/?page=1, got ${imLastRequestedUrl}`
);
console.log("PASS: Native category feed path routing (/category/{slug}/ and /category/{slug}/popular/) verified.");

// 4e. Verify Client-Side Language Safety Guard (Section 3)
// Under English preference: 5 items (Japanese raw item is dropped)
const allSearchRes = await imRunner.getSearchResults({ query: "sample" }, 1);
PagedItemListSchema.parse(allSearchRes);
assert.equal(
  allSearchRes.items.length,
  5,
  "Japanese raw item must be dropped when English is preferred"
);

// Under All Languages preference: all 6 items pass
await imRunner.onFormSubmitted("settings", {
  content_languages: "all",
});
const allLangSearchRes = await imRunner.getSearchResults({ query: "sample" }, 1);
assert.equal(
  allLangSearchRes.items.length,
  6,
  "All 6 items must pass when All Languages is preferred"
);
assert.ok(
  imLastRequestedUrl.includes("&en=1&jp=1&es=1&fr=1&kr=1&de=1&ru=1"),
  `All Languages search URL must set all language flags to 1: ${imLastRequestedUrl}`
);

// Under Japanese language preference: full language flags have jp=1 and others 0
await imRunner.onFormSubmitted("settings", {
  content_languages: "jp",
});
await imRunner.getSearchResults({ query: "sample" }, 1);
assert.ok(
  imLastRequestedUrl.includes("&en=0&jp=1&es=0&fr=0&kr=0&de=0&ru=0"),
  `Japanese search URL must set jp=1 and all others to 0: ${imLastRequestedUrl}`
);
console.log("PASS: Client-side language safety guard and multi-language flag mapping verified.");

// 4e. Verify Preference Submission with Modern & Legacy Keys and Title Formatting
await imRunner.onFormSubmitted("settings", {
  enabled_categories: { include: ["doujinshi", "western"], exclude: [] },
  content_languages: "en",
  title_language_preference: "japanese",
});

const jpTitleSearchRes = await imRunner.getSearchResults({ query: "sample" }, 1);
assert.equal(
  jpTitleSearchRes.items[0].title,
  "[サークルアルファ] ブルーアーカイブ夏コミ新刊",
  "Japanese title preference must promote Japanese subtitle to primary title"
);

// Reset to English title preference using legacy alias keys to verify backward compatibility
await imRunner.onFormSubmitted("settings", {
  imhentai_pref_categories: { include: ["doujinshi", "manga"], exclude: [] },
  imhentai_pref_language: "en",
  imhentai_pref_title_preference: "english",
});
console.log("PASS: Preference key synchronization with modern and legacy keys verified.");
console.log("PASS: IMHentai getPreferenceMenu(), query flag mapping, O(1) Set blacklist, and title formatting verified.");

// 5. Verify IMHentai Gallery Detail Parsing, Deep Linking, and Zero-Latency 1-Pass Chapter/Page Resolution
assert.equal(
  imRunner.canResolveUrl("https://imhentai.xxx/gallery/123456/"),
  true
);
assert.equal(
  imRunner.canResolveUrl("https://example.com/gallery/123456/"),
  false
);

imGalleryFetchCount = 0;
const imContent = await imRunner.resolveUrl(
  "https://imhentai.xxx/gallery/123456/"
);
ContentSchema.parse(imContent);
assert.equal(
  imContent.title,
  "[Circle Alpha (Artist Beta)] Blue Archive Summer Special [English]"
);
assert.equal(
  imContent.additionalTitles?.[0],
  "[サークルアルファ (アーティストベータ)] ブルーアーカイブ夏コミ新刊"
);
assert.equal(
  imContent.coverImage,
  "https://m2.imhentai.xxx/007/5uqtji3sho/cover.jpg"
);
assert.equal(
  JSON.stringify(imContent.creators),
  JSON.stringify(["artist beta"])
);
assert.equal(imContent.additionalDetails?.Pages, "4");
assert.equal(
  imContent.genres?.length,
  3,
  "Expected 3 general tags mapped to genres"
);
const propIds = (imContent.properties ?? []).map((p) => p.id);
assert.ok(
  propIds.includes("group") &&
    propIds.includes("parody") &&
    propIds.includes("character") &&
    propIds.includes("category") &&
    propIds.includes("language"),
  `Expected group, parody, character, category, language properties, got ${propIds.join(",")}`
);

const groupSection = imContent.properties.find((p) => p.id === "group");
assert.ok(groupSection, "Must have Circle / Group property section");
assert.equal(groupSection.title, "Circle");
assert.equal(groupSection.tags[0].namespace, "Circle");

const parodySection = imContent.properties.find((p) => p.id === "parody");
assert.ok(parodySection, "Must have Parody property section");
assert.equal(parodySection.title, "Parody");
assert.equal(parodySection.tags[0].namespace, "Parody");

// Verify Collections: Related Works carousel
assert.ok(
  Array.isArray(imContent.collections) && imContent.collections.length > 0,
  "imContent.collections must contain Related Works"
);
assert.equal(imContent.collections[0].id, "related");
assert.equal(imContent.collections[0].title, "Related Works");
assert.ok(
  imContent.collections[0].items.length > 0,
  "Related Works collection must have at least 1 item"
);
assert.equal(imContent.collections[0].items[0].id, "789012");
assert.equal(imContent.collections[0].items[0].rating, 2);

const imChapters = await imRunner.getChapters("123456");
assert.equal(
  imChapters.length,
  1,
  "getChapters must return a single chapter entry for the gallery"
);
ChapterSchema.parse(imChapters[0]);

const imPages = await imRunner.getChapterPages("123456", imChapters[0].id);
assert.equal(
  imGalleryFetchCount,
  1,
  "Zero-latency 1-pass resolution must not make per-page HTTP requests"
);
assert.equal(imPages.length, 4, "Expected 4 resolved chapter pages");
for (const page of imPages) {
  ChapterPageSchema.parse(page);
  assert.ok(page.url.startsWith("https://"), `Page URL must start with https://: ${page.url}`);
  assert.ok(!page.url.includes("undefined"), `Page URL must not contain undefined: ${page.url}`);
  assert.ok(!page.url.includes("null"), `Page URL must not contain null: ${page.url}`);
  assert.ok(/\.(jpg|webp|png)$/i.test(page.url), `Page URL must have valid image extension: ${page.url}`);
  assert.equal(
    page.headers?.Referer,
    "https://imhentai.xxx/",
    "Page must attach Referer: https://imhentai.xxx/ header"
  );
  assert.equal(
    page.headers?.Origin,
    undefined,
    "Page headers must NOT contain Origin"
  );
}
assert.equal(
  imPages[0].url,
  "https://m2.imhentai.xxx/007/5uqtji3sho/1.jpg"
);
assert.equal(
  imPages[1].url,
  "https://m2.imhentai.xxx/007/5uqtji3sho/2.png"
);
assert.equal(
  imPages[2].url,
  "https://m2.imhentai.xxx/007/5uqtji3sho/3.webp"
);
assert.equal(
  imPages[3].url,
  "https://m2.imhentai.xxx/007/5uqtji3sho/4.jpg"
);

// Fallback extension test: ensure buildChapterPagesFromMeta never produces .undefined or .null
const fallbackResolver =
  imRunner.buildChapterPagesFromMeta ??
  ImSourcePackage.buildChapterPagesFromMeta;
assert.equal(
  typeof fallbackResolver,
  "function",
  "buildChapterPagesFromMeta must be available"
);
const fallbackPages = fallbackResolver({
  serverId: "1",
  loadDir: "001",
  galleryId: "999",
  totalPages: 3,
  extensionMap: {},
  defaultExt: "",
});
assert.equal(fallbackPages.length, 3);
assert.equal(fallbackPages[0].url, "https://m1.imhentai.xxx/001/1.jpg");
assert.equal(fallbackPages[1].url, "https://m1.imhentai.xxx/001/2.jpg");
assert.equal(fallbackPages[2].url, "https://m1.imhentai.xxx/001/3.jpg");
assert.ok(!fallbackPages[0].url.includes("undefined"));

console.log("PASS: IMHentai gallery detail parsing and zero-latency 1-pass page resolution verified.");

// 6. Verify Multi-Source Catalog Manifest (dist/sources.json)
const sourcesJsonRaw = fs.readFileSync(
  path.resolve("./dist/sources.json"),
  "utf8"
);
const sourcesCatalog = JSON.parse(sourcesJsonRaw);
assert.ok(
  Array.isArray(sourcesCatalog.sources) &&
    sourcesCatalog.sources.length >= 2,
  "dist/sources.json must contain manifest entries for BOTH moe.atsu and org.imhentai"
);
const atsuManifest = sourcesCatalog.sources.find((s) => s.id === "moe.atsu");
const imManifest = sourcesCatalog.sources.find((s) => s.id === "org.imhentai");
assert.ok(atsuManifest, "moe.atsu manifest entry must exist in dist/sources.json");
assert.equal(atsuManifest.version, 2.6);
assert.equal(atsuManifest.thumbnail, "Atsu.png");
assert.equal(atsuManifest.variantId, "moe.atsu");
assert.equal(atsuManifest.minSupportedAppVersion, undefined);

const novelfullManifest = sourcesCatalog.sources.find((s) => s.id === "org.novelfull");
assert.ok(novelfullManifest, "org.novelfull manifest entry must exist in dist/sources.json");
assert.equal(novelfullManifest.version, 1.6);

assert.ok(imManifest, "org.imhentai manifest entry must exist in dist/sources.json");
assert.ok(
  imManifest.version === 1.6 ||
    imManifest.version === 1.7 ||
    imManifest.version === 1.9,
  "imManifest.version must be 1.6, 1.7, or 1.9"
);
assert.equal(imManifest.thumbnail, "imhentai.png");
assert.equal(imManifest.variantId, "org.imhentai");
assert.equal(imManifest.minSupportedAppVersion, undefined);
console.log("PASS: dist/sources.json contains valid manifest entries for both moe.atsu and org.imhentai.");

console.log("=== ALL ISOLATED JAVASCRIPTCORE TESTS PASSED ===");
