import {
  type Chapter,
  type ChapterPage,
  type Content,
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
  type SourceConfiguration,
  type SourceFeed,
  type SourceInfo,
  type UIForm,
} from "@suwatte/toolchain";
import {
  BASE_URL,
  BROWSE_FEED_KEYS,
  ContentRating,
  GALLERY_URL_REGEX,
  HOME_SECTION_KEYS,
  SOURCE_ID,
  SOURCE_LANGUAGES,
  SOURCE_NAME,
  SOURCE_VERSION,
  STATIC_CONFIGURATION,
  THUMBNAIL_FILENAME,
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
import {
  ImHentaiScraperClient,
  buildChapterPagesFromMeta,
  extractPageResolutionMeta,
  filterAndMapGalleryCards,
  mapCardsToItems,
  parseChapterPagesFromHtml,
  parseGalleryCards,
  parseGalleryDetail,
} from "./scraper.js";
import type {
  ChapterProvider,
  ContentResolver,
  DirectoryHandler,
  Filterable,
  HomeProvider,
  PreferenceProvider,
  Searchable,
} from "./types.js";

const SPOTLIGHT_DESTINATION = ItemListDestination(
  { key: BROWSE_FEED_KEYS.TRENDING },
  "Trending"
);

const TRENDING_NOW_DESTINATION = ItemListDestination(
  { key: BROWSE_FEED_KEYS.TRENDING },
  "Trending Now"
);

const FRESH_RELEASES_DESTINATION = ItemListDestination(
  { key: BROWSE_FEED_KEYS.LATEST },
  "Fresh Releases"
);

const TOP_RATED_DESTINATION = ItemListDestination(
  { key: BROWSE_FEED_KEYS.TOP_RATED },
  "Top Rated"
);

const STATIC_CUSTOM_FEEDS: SourceFeed[] = [
  {
    id: BROWSE_FEED_KEYS.DISCOVER,
    title: "Discover",
    content: {
      page: "home",
    },
  },
  {
    id: BROWSE_FEED_KEYS.TRENDING,
    title: "Trending",
    content: {
      list: {
        key: BROWSE_FEED_KEYS.TRENDING,
      },
    },
  },
  {
    id: BROWSE_FEED_KEYS.POPULAR,
    title: "Popular",
    content: {
      list: {
        key: BROWSE_FEED_KEYS.POPULAR,
      },
    },
  },
  {
    id: BROWSE_FEED_KEYS.LATEST,
    title: "Latest Releases",
    content: {
      list: {
        key: BROWSE_FEED_KEYS.LATEST,
      },
    },
  },
  {
    id: BROWSE_FEED_KEYS.TOP_RATED,
    title: "Top Rated",
    content: {
      list: {
        key: BROWSE_FEED_KEYS.TOP_RATED,
      },
    },
  },
];

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
    rating: ContentRating.ADULT,
    thumbnail: THUMBNAIL_FILENAME,
    languages: [...SOURCE_LANGUAGES],
  };

  static readonly buildChapterPagesFromMeta = buildChapterPagesFromMeta;
  static readonly extractPageResolutionMeta = extractPageResolutionMeta;
  static readonly parseGalleryCards = parseGalleryCards;
  static readonly parseGalleryDetail = parseGalleryDetail;
  static readonly filterAndMapGalleryCards = filterAndMapGalleryCards;

  public readonly info: SourceInfo = Target.info;
  public readonly scraper: ImHentaiScraperClient;
  public readonly buildChapterPagesFromMeta = buildChapterPagesFromMeta;
  public readonly extractPageResolutionMeta = extractPageResolutionMeta;
  public readonly parseGalleryCards = parseGalleryCards;
  public readonly parseGalleryDetail = parseGalleryDetail;
  public readonly filterAndMapGalleryCards = filterAndMapGalleryCards;
  private cachedHomeSections: {
    timestamp: number;
    data: ItemPageResponse;
  } | null = null;

  constructor(scraper?: ImHentaiScraperClient) {
    this.scraper =
      scraper instanceof ImHentaiScraperClient
        ? scraper
        : new ImHentaiScraperClient();
  }

  getConfiguration(): SourceConfiguration {
    return STATIC_CONFIGURATION;
  }

  async willRequestImage(request: NetworkRequest): Promise<NetworkRequest> {
    return this.scraper.configureImageRequest(request);
  }

  // =========================================================================
  // HomeProvider
  // =========================================================================

  async getHomePage(): Promise<HomePage> {
    const homeSections = await this.getItemPage("home", 1);
    return {
      feeds: STATIC_CUSTOM_FEEDS,
      sections: homeSections.sections,
      isLastPage: homeSections.isLastPage,
    } as HomePage;
  }

  async getItemPage(key: string, page: number): Promise<ItemPageResponse> {
    if (page > 1 && key === "home") {
      return {
        sections: [],
        isLastPage: true,
      };
    }

    const now = Date.now();
    if (
      this.cachedHomeSections &&
      now - this.cachedHomeSections.timestamp < 10000
    ) {
      return this.cachedHomeSections.data;
    }

    // Memoize preferences once for the entire home page request cycle
    const prefs = await getUserPreferences();

    // Concurrent parallel execution of home shelves
    const [trendingRes, freshRes, topRatedRes] = await Promise.all([
      this.scraper.fetchFeedItems(BROWSE_FEED_KEYS.TRENDING, 1, prefs),
      this.scraper.fetchFeedItems(BROWSE_FEED_KEYS.LATEST, 1, prefs),
      this.scraper.fetchFeedItems(BROWSE_FEED_KEYS.TOP_RATED, 1, prefs),
    ]);

    // Spotlight Banner: Carousel of prominent trending titles
    const bannerItems =
      trendingRes.items.length >= 5
        ? trendingRes.items.slice(0, 10)
        : trendingRes.items;

    const sections: ItemPageSection[] = [
      {
        id: HOME_SECTION_KEYS.SPOTLIGHT,
        title: "Featured",
        subtitle: "Prominent trending releases on IMHentai",
        style: PageSectionStyle.BANNER,
        items: bannerItems,
        destination: SPOTLIGHT_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.TRENDING_NOW,
        title: "Trending Now",
        subtitle:
          "Fast-rising releases combining high ratings with recent uploads",
        style: PageSectionStyle.DEFAULT,
        items: trendingRes.items,
        destination: TRENDING_NOW_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.FRESH_RELEASES,
        title: "Fresh Releases",
        subtitle: "Newest additions matching your preferred language",
        style: PageSectionStyle.DEFAULT,
        items: freshRes.items,
        destination: FRESH_RELEASES_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.TOP_RATED,
        title: "Top Rated",
        subtitle: "Standout all-time favorites and high-scoring works",
        style: PageSectionStyle.DEFAULT,
        items: topRatedRes.items,
        destination: TOP_RATED_DESTINATION,
      },
    ];

    const response: ItemPageResponse = {
      sections,
      isLastPage: true,
    };
    this.cachedHomeSections = { timestamp: now, data: response };
    return response;
  }

  async getPageSectionItems(
    sectionKey: string,
    _pageKey: string
  ): Promise<Item[]> {
    const prefs = await getUserPreferences();
    let feedKey: string = sectionKey;
    if (
      sectionKey === HOME_SECTION_KEYS.SPOTLIGHT ||
      sectionKey === HOME_SECTION_KEYS.TRENDING_NOW
    ) {
      feedKey = BROWSE_FEED_KEYS.TRENDING;
    } else if (sectionKey === HOME_SECTION_KEYS.FRESH_RELEASES) {
      feedKey = BROWSE_FEED_KEYS.LATEST;
    } else if (sectionKey === HOME_SECTION_KEYS.TOP_RATED) {
      feedKey = BROWSE_FEED_KEYS.TOP_RATED;
    }
    const res = await this.scraper.fetchFeedItems(feedKey, 1, prefs);
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
    const key = request.key ?? BROWSE_FEED_KEYS.LATEST;
    const sortBy = request.sort?.key;
    const sortAscending = request.sort?.ascending;

    const prefs = await getUserPreferences();
    return this.scraper.fetchFeedItems(
      key,
      page,
      prefs,
      sortBy,
      sortAscending
    );
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
    const prefs = await getUserPreferences();
    return this.scraper.fetchSearchResults(exploreParams, prefs);
  }

  // =========================================================================
  // ContentResolver
  // =========================================================================

  canResolveUrl(url: string): boolean {
    const trimmed = (url ?? "").trim();
    return GALLERY_URL_REGEX.test(trimmed);
  }

  async resolveUrl(url: string): Promise<Content> {
    return this.getContent(url);
  }

  async getContent(contentId: string): Promise<Content> {
    return this.scraper.fetchContent(contentId);
  }

  // =========================================================================
  // ChapterProvider
  // =========================================================================

  async getChapters(contentId: string): Promise<Chapter[]> {
    return this.scraper.fetchChapters(contentId);
  }

  async getChapterPages(
    contentId: string,
    chapterId: string
  ): Promise<ChapterPage[]> {
    return this.scraper.fetchChapterPages(contentId, chapterId);
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

Target.info.version = SOURCE_VERSION;

export {
  buildChapterPagesFromMeta,
  extractPageResolutionMeta,
  filterAndMapGalleryCards,
  mapCardsToItems,
  parseChapterPagesFromHtml,
  parseGalleryCards,
  parseGalleryDetail,
  parseRelatedGalleryCards,
} from "./scraper.js";
export { Target };
