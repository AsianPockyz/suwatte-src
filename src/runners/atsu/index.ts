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
  MANGA_URL_REGEX,
  NOVEL_URL_REGEX,
  REFERER_URL,
  SOURCE_ID,
  SOURCE_NAME,
  SOURCE_VERSION,
} from "./constants.js";
import {
  getSearchFilters,
  getSortOptions,
  mapFiltersToExploreParams,
} from "./filters.js";
import {
  buildSettingsForm,
  getUserPreferences,
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
  TOP_RATED: "top_rated",
} as const;

const DIRECTORY_FEED_KEYS = {
  TRENDING: "trending",
  POPULAR: "popular",
  LATEST: "latest",
  HOT_UPDATES: "hot_updates",
  RECENTLY_ADDED: "recently_added",
  TOP_RATED: "top_rated",
  MOST_BOOKMARKED: "most_bookmarked",
} as const;

const STATIC_CONFIGURATION: AtsuSourceConfiguration = Object.freeze({
  imageReferer: REFERER_URL,
  cloudflareResolutionURL: CLOUDFLARE_FALLBACK_URL,
});

const SPOTLIGHT_DESTINATION = ItemListDestination(
  { key: DIRECTORY_FEED_KEYS.POPULAR },
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
const TOP_RATED_DESTINATION = ItemListDestination(
  { key: DIRECTORY_FEED_KEYS.TOP_RATED },
  "Top Rated Series"
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
    id: DIRECTORY_FEED_KEYS.TOP_RATED,
    title: "Top Rated",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.TOP_RATED,
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
    id: DIRECTORY_FEED_KEYS.POPULAR,
    title: "Popular",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.POPULAR,
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
  {
    id: DIRECTORY_FEED_KEYS.MOST_BOOKMARKED,
    title: "Most Bookmarked",
    content: {
      list: {
        key: DIRECTORY_FEED_KEYS.MOST_BOOKMARKED,
      },
    },
  },
];

const STATIC_HOME_PAGE: HomePage = {
  feeds: STATIC_CUSTOM_FEEDS,
};

const SECTION_EXPLORE_PARAMS: Readonly<Record<string, ExploreParams>> = {
  [HOME_SECTION_KEYS.SPOTLIGHT]: { mode: "popular", page: 1, perPage: 15 },
  [HOME_SECTION_KEYS.HOT_UPDATES]: { mode: "hot_updates", page: 1, perPage: 24 },
  [HOME_SECTION_KEYS.POPULAR]: { mode: "latest", page: 1, perPage: 24 },
  [HOME_SECTION_KEYS.TOP_RATED]: { mode: "top_rated", page: 1, perPage: 24 },
};

interface FeedDefaultConfig {
  readonly mode: ExploreParams["mode"];
  readonly defaultSortBy?: string;
  readonly defaultSortAscending?: boolean;
}

const FEED_EXPLORE_CONFIG: Readonly<Record<string, FeedDefaultConfig>> = {
  discover: { mode: "popular" },
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
  },
  [DIRECTORY_FEED_KEYS.LATEST]: {
    mode: "latest",
    defaultSortBy: "updatedAt",
    defaultSortAscending: false,
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
    defaultSortBy: "popularity",
    defaultSortAscending: false,
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

  constructor(api?: AtsuApiClient) {
    this.api = api instanceof AtsuApiClient ? api : new AtsuApiClient();
  }

  /**
   * Provides source-level configuration including imageReferer and cloudflareResolutionURL.
   */
  getConfiguration(): SourceConfiguration {
    return STATIC_CONFIGURATION;
  }

  /**
   * Intercepts outgoing image requests to attach `Referer` and `Origin` headers.
   */
  async willRequestImage(request: NetworkRequest): Promise<NetworkRequest> {
    return this.api.configureImageRequest(request);
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

    const [spotlightRes, latestRes, hotUpdatesRes, topRatedRes] =
      await Promise.all([
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
          SECTION_EXPLORE_PARAMS[HOME_SECTION_KEYS.TOP_RATED],
          prefs
        ),
      ]);

    const sections: ItemPageSection[] = [
      {
        id: HOME_SECTION_KEYS.SPOTLIGHT,
        title: "Spotlight & Trending",
        subtitle: "Most popular series on Atsumaru today",
        style: PageSectionStyle.BANNER,
        items: spotlightRes.items,
        destination: SPOTLIGHT_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.HOT_UPDATES,
        title: "Hot Updates",
        subtitle: "High momentum chapters and popular releases",
        style: PageSectionStyle.DEFAULT,
        items: hotUpdatesRes.items,
        destination: HOT_UPDATES_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.POPULAR,
        title: "Latest Updates",
        subtitle: "Recently updated chapters across all scanlators",
        style: PageSectionStyle.DEFAULT,
        items: latestRes.items,
        destination: LATEST_UPDATES_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.TOP_RATED,
        title: "Top Rated Series",
        subtitle: "Critically acclaimed manga and manhwa",
        style: PageSectionStyle.DEFAULT,
        items: topRatedRes.items,
        destination: TOP_RATED_DESTINATION,
      },
    ];

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

    return this.api.fetchExplore({
      mode: config?.mode ?? "trending",
      sortBy,
      sortAscending,
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

Target.info.version = 2.3;

export { getItemEffectiveFormat } from "./api.js";
export { Target };
