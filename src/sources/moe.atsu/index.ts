import {
  type Chapter,
  type ChapterPage,
  type Content,
  ContentRating,
  type Delegate,
  type HomePage,
  type Item,
  ItemListDestination,
  type ItemListRequest,
  type ItemPageResponse,
  type ItemPageSection,
  type NetworkRequest,
  type PagedItemList,
  PageSectionStyle,
  type PopulatedForm,
  type SearchFilter,
  type SearchRequest,
  type SortOptions,
  type SourceChapterText,
  type SourceConfiguration,
  type SourceFeed,
  type SourceInfo,
  type UIForm,
} from "@suwatte/toolchain";
import { AtsuApiClient, getItemEffectiveFormat } from "./api.js";
import {
  BASE_URL,
  CLOUDFLARE_FALLBACK_URL,
  CONTENT_URL_REGEX,
  FALLBACK_COVER_URL,
  getApiHeadersForMode,
  getImageHeadersForMode,
  MANGA_URL_REGEX,
  NOVEL_URL_REGEX,
  REFERER_URL,
  SOURCE_ID,
  SOURCE_NAME,
  SOURCE_VERSION,
  STANDARD_HEADERS,
} from "./constants.js";
import {
  getSearchFilters,
  getSortOptions,
  mapFiltersToExploreParams,
} from "./filters.js";
import {
  buildSettingsForm,
  getConnectionBrowsingMode,
  getUserPreferences,
  invalidatePreferencesCache,
  updateUserPreferences,
} from "./preferences.js";
import type {
  AtsuSourceConfiguration,
  ChapterProvider,
  ContentResolver,
  DirectoryHandler,
  ExploreParams,
  Filterable,
  HomeProvider,
  PreferenceProvider,
  Searchable,
} from "./types.js";

const HOME_SECTION_KEYS = {
  SPOTLIGHT: "spotlight",
  HOT_UPDATES: "hot_updates",
  POPULAR: "popular",
  WEEKLY_MOST_BOOKMARKED: "weekly_most_bookmarked",
} as const;

const DIRECTORY_FEED_KEYS = {
  POPULAR_DAILY: "popular_daily",
  POPULAR_WEEKLY: "popular_weekly",
  POPULAR_MONTHLY: "popular_monthly",
  POPULAR_ALL: "popular_all",
  BOOKMARKED_DAILY: "bookmarked_daily",
  BOOKMARKED_WEEKLY: "bookmarked_weekly",
  BOOKMARKED_MONTHLY: "bookmarked_monthly",
  BOOKMARKED_ALL: "bookmarked_all",
  TRENDING: "trending",
  TOP_RATED: "top_rated",
  LATEST: "latest",
  HOT_UPDATES: "hot_updates",
  RECENTLY_ADDED: "recently_added",
  POPULAR: "popular",
  MOST_BOOKMARKED: "most_bookmarked",
} as const;

const STATIC_CONFIGURATION: AtsuSourceConfiguration = Object.freeze({
  imageReferer: REFERER_URL,
  cloudflareResolutionURL: CLOUDFLARE_FALLBACK_URL,
  standardHeaders: STANDARD_HEADERS,
});

const SPOTLIGHT_DESTINATION = ItemListDestination(
  { key: DIRECTORY_FEED_KEYS.POPULAR_DAILY },
  "Spotlight & Trending"
);
const HOT_UPDATES_DESTINATION = ItemListDestination(
  { key: DIRECTORY_FEED_KEYS.HOT_UPDATES },
  "Hot Updates"
);
const LATEST_UPDATES_DESTINATION = ItemListDestination(
  { key: DIRECTORY_FEED_KEYS.LATEST },
  "Latest Updates"
);
const WEEKLY_MOST_BOOKMARKED_DESTINATION = ItemListDestination(
  { key: DIRECTORY_FEED_KEYS.BOOKMARKED_WEEKLY },
  "Weekly Most Bookmarked"
);

const STATIC_CUSTOM_FEEDS: SourceFeed[] = [
  {
    id: "discover",
    title: "Discover",
    content: {
      page: "home",
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.POPULAR_DAILY,
    title: "Popular (Today)",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.POPULAR_DAILY,
      },
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.POPULAR_WEEKLY,
    title: "Popular (This Week)",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.POPULAR_WEEKLY,
      },
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.POPULAR_MONTHLY,
    title: "Popular (This Month)",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.POPULAR_MONTHLY,
      },
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.POPULAR_ALL,
    title: "Popular (All Time)",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.POPULAR_ALL,
      },
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.BOOKMARKED_DAILY,
    title: "Most Bookmarked (Today)",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.BOOKMARKED_DAILY,
      },
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.BOOKMARKED_WEEKLY,
    title: "Most Bookmarked (This Week)",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.BOOKMARKED_WEEKLY,
      },
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.BOOKMARKED_MONTHLY,
    title: "Most Bookmarked (This Month)",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.BOOKMARKED_MONTHLY,
      },
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.BOOKMARKED_ALL,
    title: "Most Bookmarked (All Time)",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.BOOKMARKED_ALL,
      },
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.TRENDING,
    title: "Trending",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.TRENDING,
      },
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.TOP_RATED,
    title: "Top Rated",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.TOP_RATED,
      },
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.LATEST,
    title: "Latest Updates",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.LATEST,
      },
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.HOT_UPDATES,
    title: "Hot Updates",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.HOT_UPDATES,
      },
    },
  },
  {
    id: DIRECTORY_FEED_KEYS.RECENTLY_ADDED,
    title: "Recently Added",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.RECENTLY_ADDED,
      },
    },
  },
];

const STATIC_HOME_PAGE: HomePage = {
  feeds: STATIC_CUSTOM_FEEDS,
};

const SECTION_EXPLORE_PARAMS: Readonly<Record<string, ExploreParams>> = {
  [HOME_SECTION_KEYS.SPOTLIGHT]: {
    mode: "popular_daily",
    timeframe: "daily",
    page: 1,
    perPage: 15,
  },
  [HOME_SECTION_KEYS.HOT_UPDATES]: { mode: "hot_updates", page: 1, perPage: 24 },
  [HOME_SECTION_KEYS.POPULAR]: { mode: "latest", page: 1, perPage: 24 },
  [HOME_SECTION_KEYS.WEEKLY_MOST_BOOKMARKED]: {
    mode: "bookmarked_weekly",
    timeframe: "weekly",
    page: 1,
    perPage: 24,
  },
  [DIRECTORY_FEED_KEYS.BOOKMARKED_WEEKLY]: {
    mode: "bookmarked_weekly",
    timeframe: "weekly",
    page: 1,
    perPage: 24,
  },
  [DIRECTORY_FEED_KEYS.TOP_RATED]: { mode: "top_rated", page: 1, perPage: 24 },
};

interface FeedDefaultConfig {
  readonly mode: ExploreParams["mode"];
  readonly defaultSortBy?: string;
  readonly defaultSortAscending?: boolean;
  readonly defaultTimeframe?: ExploreParams["timeframe"];
}

const FEED_EXPLORE_CONFIG: Readonly<Record<string, FeedDefaultConfig>> = {
  discover: {
    mode: "popular_daily",
    defaultTimeframe: "daily",
  },
  [DIRECTORY_FEED_KEYS.POPULAR_DAILY]: {
    mode: "popular_daily",
    defaultTimeframe: "daily",
  },
  [DIRECTORY_FEED_KEYS.POPULAR_WEEKLY]: {
    mode: "popular_weekly",
    defaultTimeframe: "weekly",
  },
  [DIRECTORY_FEED_KEYS.POPULAR_MONTHLY]: {
    mode: "popular_monthly",
    defaultTimeframe: "monthly",
  },
  [DIRECTORY_FEED_KEYS.POPULAR_ALL]: {
    mode: "popular_all",
    defaultTimeframe: "all",
  },
  [DIRECTORY_FEED_KEYS.BOOKMARKED_DAILY]: {
    mode: "bookmarked_daily",
    defaultTimeframe: "daily",
  },
  [DIRECTORY_FEED_KEYS.BOOKMARKED_WEEKLY]: {
    mode: "bookmarked_weekly",
    defaultTimeframe: "weekly",
  },
  [DIRECTORY_FEED_KEYS.BOOKMARKED_MONTHLY]: {
    mode: "bookmarked_monthly",
    defaultTimeframe: "monthly",
  },
  [DIRECTORY_FEED_KEYS.BOOKMARKED_ALL]: {
    mode: "bookmarked_all",
    defaultTimeframe: "all",
  },
  [DIRECTORY_FEED_KEYS.TOP_RATED]: {
    mode: "top_rated",
    defaultSortBy: "mbRating",
    defaultSortAscending: false,
  },
  [DIRECTORY_FEED_KEYS.TRENDING]: {
    mode: "trending",
    defaultSortBy: "trending",
  },
  [DIRECTORY_FEED_KEYS.POPULAR]: {
    mode: "popular",
    defaultTimeframe: "daily",
  },
  [DIRECTORY_FEED_KEYS.LATEST]: {
    mode: "latest",
  },
  [DIRECTORY_FEED_KEYS.HOT_UPDATES]: {
    mode: "hot_updates",
  },
  [DIRECTORY_FEED_KEYS.RECENTLY_ADDED]: {
    mode: "recently_added",
    defaultSortBy: "dateAdded",
    defaultSortAscending: false,
  },
  [DIRECTORY_FEED_KEYS.MOST_BOOKMARKED]: {
    mode: "most_bookmarked",
    defaultTimeframe: "all",
  },
  [HOME_SECTION_KEYS.WEEKLY_MOST_BOOKMARKED]: {
    mode: "bookmarked_weekly",
    defaultTimeframe: "weekly",
  },
};

export default class Target
  implements
    Delegate,
    HomeProvider,
    DirectoryHandler,
    Searchable,
    Filterable,
    ContentResolver,
    ChapterProvider,
    PreferenceProvider
{
  static readonly info: SourceInfo = {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    version: SOURCE_VERSION,
    website: BASE_URL,
    rating: ContentRating.SUGGESTIVE,
    thumbnail: FALLBACK_COVER_URL,
    languages: ["en"],
  };

  public readonly info: SourceInfo = Target.info;
  public readonly api: AtsuApiClient;
  static readonly getItemEffectiveFormat = getItemEffectiveFormat;
  public readonly getItemEffectiveFormat = getItemEffectiveFormat;
  static readonly getImageHeadersForMode = getImageHeadersForMode;
  public readonly getImageHeadersForMode = getImageHeadersForMode;
  static readonly getApiHeadersForMode = getApiHeadersForMode;
  public readonly getApiHeadersForMode = getApiHeadersForMode;
  static readonly getConnectionBrowsingMode = getConnectionBrowsingMode;
  public readonly getConnectionBrowsingMode = getConnectionBrowsingMode;
  static readonly invalidatePreferencesCache = invalidatePreferencesCache;
  public readonly invalidatePreferencesCache = invalidatePreferencesCache;

  constructor(api?: AtsuApiClient) {
    this.api = api instanceof AtsuApiClient ? api : new AtsuApiClient();
  }

  /**
   * Provides source-level configuration including imageReferer, cloudflareResolutionURL, and standardHeaders.
   */
  getConfiguration(): SourceConfiguration {
    return STATIC_CONFIGURATION;
  }

  /**
   * Intercepts outgoing image requests to dynamically inject headers for the active Connection / Browsing Mode.
   */
  async willRequestImage(
    requestOrUrl: NetworkRequest | string
  ): Promise<NetworkRequest> {
    const url =
      typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.url;
    const mode = await getConnectionBrowsingMode();
    const headers = getImageHeadersForMode(mode);

    if (typeof requestOrUrl === "string") {
      return {
        url,
        headers,
      };
    }

    return {
      ...requestOrUrl,
      url,
      headers,
    };
  }

  // =========================================================================
  // HomeProvider
  // =========================================================================

  async getHomePage(): Promise<HomePage> {
    return STATIC_HOME_PAGE;
  }

  async getItemPage(key: string, page: number): Promise<ItemPageResponse> {
    if (page > 1 && key === "home") {
      return {
        sections: [],
        isLastPage: true,
      };
    }

    // Resolve preferences once for the entire home page cycle
    const prefs = await getUserPreferences();

    const settled = await Promise.allSettled([
      this.api.fetchExplore(
        SECTION_EXPLORE_PARAMS[HOME_SECTION_KEYS.SPOTLIGHT],
        prefs
      ),
      this.api.fetchExplore(
        SECTION_EXPLORE_PARAMS[HOME_SECTION_KEYS.POPULAR],
        prefs
      ),
      this.api.fetchExplore(
        SECTION_EXPLORE_PARAMS[HOME_SECTION_KEYS.HOT_UPDATES],
        prefs
      ),
      this.api.fetchExplore(
        SECTION_EXPLORE_PARAMS[HOME_SECTION_KEYS.WEEKLY_MOST_BOOKMARKED],
        prefs
      ),
    ]);

    const extractItems = (
      res: PromiseSettledResult<PagedItemList>
    ): Item[] => {
      if (res.status === "fulfilled" && Array.isArray(res.value?.items)) {
        return res.value.items;
      }
      return [];
    };

    const spotlightItems = extractItems(settled[0]);
    const latestItems = extractItems(settled[1]);
    const hotUpdatesItems = extractItems(settled[2]);
    let weeklyBookmarkedItems = extractItems(settled[3]);

    // Defensive fallback for Weekly Most Bookmarked shelf: if weekly request fails or returns empty,
    // gracefully fall back to All-Time Most Bookmarked without breaking the Discover page.
    if (weeklyBookmarkedItems.length === 0) {
      try {
        const fallbackBookmarked = await this.api.fetchExplore(
          {
            mode: "bookmarked_all",
            timeframe: "all",
            page: 1,
            perPage: 24,
          },
          prefs
        );
        if (Array.isArray(fallbackBookmarked?.items)) {
          weeklyBookmarkedItems = fallbackBookmarked.items;
        }
      } catch {
        // Omit only the failed shelf if fallback also fails
      }
    }

    const candidateSections: ItemPageSection[] = [
      {
        id: HOME_SECTION_KEYS.SPOTLIGHT,
        title: "Spotlight & Trending",
        subtitle: "Most popular series on Atsumaru today",
        style: PageSectionStyle.BANNER,
        items: spotlightItems,
        destination: SPOTLIGHT_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.HOT_UPDATES,
        title: "Hot Updates",
        subtitle: "High momentum chapters and popular releases",
        style: PageSectionStyle.DEFAULT,
        items: hotUpdatesItems,
        destination: HOT_UPDATES_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.POPULAR,
        title: "Latest Updates",
        subtitle: "Recently updated chapters across all scanlators",
        style: PageSectionStyle.DEFAULT,
        items: latestItems,
        destination: LATEST_UPDATES_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.WEEKLY_MOST_BOOKMARKED,
        title: "Weekly Most Bookmarked",
        subtitle: "Most bookmarked series on Atsumaru this week",
        style: PageSectionStyle.DEFAULT,
        items: weeklyBookmarkedItems,
        destination: WEEKLY_MOST_BOOKMARKED_DESTINATION,
      },
    ];

    const sections = candidateSections.filter(
      (sec) => Array.isArray(sec.items) && sec.items.length > 0
    );

    if (sections.length === 0) {
      for (const res of settled) {
        if (
          res.status === "rejected" &&
          res.reason instanceof CloudflareError
        ) {
          throw res.reason;
        }
      }
    }

    return {
      sections,
      isLastPage: true,
    };
  }

  async getPageSectionItems(
    sectionKey: string,
    _pageKey: string
  ): Promise<Item[]> {
    const params = SECTION_EXPLORE_PARAMS[sectionKey] ?? {
      mode: "popular",
      page: 1,
    };
    const res = await this.api.fetchExplore(params);
    return res.items;
  }

  // =========================================================================
  // DirectoryHandler
  // =========================================================================

  async getCustomFeeds(): Promise<SourceFeed[]> {
    return STATIC_CUSTOM_FEEDS;
  }

  async getItemList(
    request: ItemListRequest,
    page: number
  ): Promise<PagedItemList> {
    const key = request.key ?? DIRECTORY_FEED_KEYS.TRENDING;
    const config = FEED_EXPLORE_CONFIG[key];
    const sortBy = request.sort?.key ?? config?.defaultSortBy;
    const sortAscending =
      request.sort?.ascending ?? config?.defaultSortAscending;
    const timeframe = config?.defaultTimeframe;

    return this.api.fetchExplore({
      mode: config?.mode ?? "trending",
      sortBy,
      sortAscending,
      timeframe,
      page,
    });
  }

  // =========================================================================
  // Searchable & Filterable
  // =========================================================================

  async getSearchFilters(): Promise<SearchFilter[]> {
    return getSearchFilters();
  }

  async getSortOptions(): Promise<SortOptions> {
    return getSortOptions();
  }

  async getSearchResults(
    request: SearchRequest,
    page: number
  ): Promise<PagedItemList> {
    const exploreParams = mapFiltersToExploreParams(
      request.filters,
      request.sort,
      request.query,
      page
    );
    return this.api.fetchExplore(exploreParams);
  }

  // =========================================================================
  // ContentResolver
  // =========================================================================

  canResolveUrl(url: string): boolean {
    const trimmed = (url ?? "").trim();
    return (
      MANGA_URL_REGEX.test(trimmed) ||
      NOVEL_URL_REGEX.test(trimmed) ||
      CONTENT_URL_REGEX.test(trimmed)
    );
  }

  async resolveUrl(url: string): Promise<Content> {
    return this.getContent(url);
  }

  async getContent(contentId: string): Promise<Content> {
    const { content } = await this.api.fetchMangaDetails(contentId);
    return content;
  }

  // =========================================================================
  // ChapterProvider
  // =========================================================================

  async getChapters(contentId: string): Promise<Chapter[]> {
    return this.api.fetchChapters(contentId);
  }

  async getChapterPages(
    contentId: string,
    chapterId: string
  ): Promise<ChapterPage[]> {
    return this.api.fetchChapterPages(contentId, chapterId);
  }

  async getChapterText(
    contentId: string,
    chapterId: string
  ): Promise<SourceChapterText> {
    return this.api.fetchChapterText(contentId, chapterId);
  }

  // =========================================================================
  // PreferenceProvider
  // =========================================================================

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

Target.info.version = 2.7;

export { getItemEffectiveFormat } from "./api.js";
export {
  getApiHeadersForMode,
  getImageHeadersForMode,
} from "./constants.js";
export {
  getConnectionBrowsingMode,
  invalidatePreferencesCache,
} from "./preferences.js";
export { Target };
