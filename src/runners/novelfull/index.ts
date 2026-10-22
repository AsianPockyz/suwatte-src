import {
  type Chapter,
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
  type SourceChapterText,
  type SourceConfiguration,
  type SourceFeed,
  type SourceInfo,
  type UIForm,
} from "@suwatte/toolchain";
import { canResolveNovelFullUrl, normalizeImageUrl } from "./api.js";
import {
  BASE_URL,
  BROWSE_FEED_KEYS,
  ContentRating,
  HOME_SECTION_KEYS,
  SOURCE_CONTENT_RATING,
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
  compileBlacklistContext,
  getUserPreferences,
  isNovelAllowed,
  updateUserPreferences,
} from "./preferences.js";
import {
  NovelFullScraperClient,
  extractCoverFromElement,
  filterAndMapNovelCards,
  formatTranslatorNotes,
  mapCardToItem,
  normalizeTypographyAndEntities,
  parseAjaxChapterOptions,
  parseNovelCards,
  parseNovelDetail,
  sanitizeChapterHtml,
  stripAggregatorWatermarks,
} from "./scraper.js";
import type {
  ContentResolver,
  DirectoryHandler,
  Filterable,
  HomeProvider,
  NovelChapterProvider,
  PreferenceProvider,
  Searchable,
} from "./types.js";

const SPOTLIGHT_DESTINATION = ItemListDestination(
  { key: BROWSE_FEED_KEYS.HOT_NOVEL },
  "Hot Novel"
);

const HOT_NOVELS_DESTINATION = ItemListDestination(
  { key: BROWSE_FEED_KEYS.HOT_NOVEL },
  "Hot Novels"
);

const LATEST_RELEASES_DESTINATION = ItemListDestination(
  { key: BROWSE_FEED_KEYS.LATEST_RELEASES },
  "Latest Releases"
);

const COMPLETED_MASTERPIECES_DESTINATION = ItemListDestination(
  { key: BROWSE_FEED_KEYS.COMPLETED_NOVELS },
  "Completed Masterpieces"
);

const MOST_POPULAR_DESTINATION = ItemListDestination(
  { key: BROWSE_FEED_KEYS.MOST_POPULAR },
  "Most Popular All-Time"
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
    id: BROWSE_FEED_KEYS.HOT_NOVEL,
    title: "Hot Novel",
    content: {
      list: {
        key: BROWSE_FEED_KEYS.HOT_NOVEL,
      },
    },
  },
  {
    id: BROWSE_FEED_KEYS.LATEST_RELEASES,
    title: "Latest Releases",
    content: {
      list: {
        key: BROWSE_FEED_KEYS.LATEST_RELEASES,
      },
    },
  },
  {
    id: BROWSE_FEED_KEYS.MOST_POPULAR,
    title: "Most Popular",
    content: {
      list: {
        key: BROWSE_FEED_KEYS.MOST_POPULAR,
      },
    },
  },
  {
    id: BROWSE_FEED_KEYS.COMPLETED_NOVELS,
    title: "Completed Novels",
    content: {
      list: {
        key: BROWSE_FEED_KEYS.COMPLETED_NOVELS,
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
    NovelChapterProvider,
    PreferenceProvider
{
  static readonly info: SourceInfo = {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    version: SOURCE_VERSION,
    website: BASE_URL,
    rating: SOURCE_CONTENT_RATING,
    thumbnail: THUMBNAIL_FILENAME,
    languages: [...SOURCE_LANGUAGES],
  };

  static readonly parseNovelCards = parseNovelCards;
  static readonly parseNovelDetail = parseNovelDetail;
  static readonly parseAjaxChapterOptions = parseAjaxChapterOptions;
  static readonly sanitizeChapterHtml = sanitizeChapterHtml;
  static readonly filterAndMapNovelCards = filterAndMapNovelCards;
  static readonly compileBlacklistContext = compileBlacklistContext;
  static readonly isNovelAllowed = isNovelAllowed;

  public readonly info: SourceInfo = Target.info;
  public readonly scraper: NovelFullScraperClient;
  public readonly parseNovelCards = parseNovelCards;
  public readonly parseNovelDetail = parseNovelDetail;
  public readonly parseAjaxChapterOptions = parseAjaxChapterOptions;
  public readonly sanitizeChapterHtml = sanitizeChapterHtml;
  public readonly filterAndMapNovelCards = filterAndMapNovelCards;
  public readonly compileBlacklistContext = compileBlacklistContext;
  public readonly isNovelAllowed = isNovelAllowed;

  private cachedHomeSections: {
    timestamp: number;
    data: ItemPageResponse;
  } | null = null;

  constructor(scraper?: NovelFullScraperClient) {
    this.scraper =
      scraper instanceof NovelFullScraperClient
        ? scraper
        : new NovelFullScraperClient();
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
      now - this.cachedHomeSections.timestamp < 10_000
    ) {
      return this.cachedHomeSections.data;
    }

    const prefs = await getUserPreferences();
    const shelves = await this.scraper.fetchHomeShelves(prefs);

    const sections: ItemPageSection[] = [
      {
        id: HOME_SECTION_KEYS.SPOTLIGHT,
        title: "Spotlight",
        subtitle: "Featured & top-trending web novels on NovelFull",
        style: PageSectionStyle.BANNER,
        ...(shelves.spotlight.length > 0 ? { items: shelves.spotlight } : {}),
        destination: SPOTLIGHT_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.HOT_NOVELS,
        title: "Hot Novels",
        subtitle: "High-momentum web novels trending right now",
        style: PageSectionStyle.DEFAULT,
        ...(shelves.hotNovels.length > 0 ? { items: shelves.hotNovels } : {}),
        destination: HOT_NOVELS_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.LATEST_RELEASES,
        title: "Latest Releases",
        subtitle: "Newly updated chapters across all ongoing series",
        style: PageSectionStyle.DEFAULT,
        ...(shelves.latestReleases.length > 0
          ? { items: shelves.latestReleases }
          : {}),
        destination: LATEST_RELEASES_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.COMPLETED_MASTERPIECES,
        title: "Completed Masterpieces",
        subtitle: "Fully translated, binge-ready completed web novels",
        style: PageSectionStyle.DEFAULT,
        ...(shelves.completedMasterpieces.length > 0
          ? { items: shelves.completedMasterpieces }
          : {}),
        destination: COMPLETED_MASTERPIECES_DESTINATION,
      },
      {
        id: HOME_SECTION_KEYS.MOST_POPULAR,
        title: "Most Popular All-Time",
        subtitle: "All-time highest traffic web novels on NovelFull",
        style: PageSectionStyle.DEFAULT,
        ...(shelves.mostPopular.length > 0
          ? { items: shelves.mostPopular }
          : {}),
        destination: MOST_POPULAR_DESTINATION,
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
    const res = await this.scraper.fetchFeedItems(sectionKey, 1, prefs);
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
    const key = request.key ?? BROWSE_FEED_KEYS.HOT_NOVEL;
    const sortBy = request.sort?.key;

    if (key.toLowerCase() === BROWSE_FEED_KEYS.DISCOVER && !sortBy && page === 1) {
      const home = await this.getHomePage();
      const sections = (home as unknown as ItemPageResponse).sections ?? [];
      const combined: Item[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < sections.length; i++) {
        const secItems = sections[i]?.items ?? [];
        for (let j = 0; j < secItems.length; j++) {
          const it = secItems[j];
          if (it && !seen.has(it.id)) {
            seen.add(it.id);
            combined.push(it);
          }
        }
      }
      if (combined.length > 0) {
        return {
          items: combined,
          isLastPage: false,
        };
      }
    }

    const prefs = await getUserPreferences();
    return this.scraper.fetchFeedItems(key, page, prefs, sortBy);
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
    return canResolveNovelFullUrl(url);
  }

  async resolveUrl(url: string): Promise<Content> {
    return this.getContent(url);
  }

  async getContent(contentId: string): Promise<Content> {
    return this.scraper.fetchContent(contentId);
  }

  // =========================================================================
  // NovelChapterProvider (100% Text Runner — No getChapterPages)
  // =========================================================================

  async getChapters(contentId: string): Promise<Chapter[]> {
    return this.scraper.fetchChapters(contentId);
  }

  async getChapterText(
    contentId: string,
    chapterId: string
  ): Promise<SourceChapterText> {
    return this.scraper.fetchChapterText(contentId, chapterId);
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
    this.cachedHomeSections = null;
    await updateUserPreferences(data);
  }
}

Target.info.version = SOURCE_VERSION;

export {
  canResolveNovelFullUrl,
  compileBlacklistContext,
  extractCoverFromElement,
  filterAndMapNovelCards,
  formatTranslatorNotes,
  isNovelAllowed,
  mapCardToItem,
  normalizeImageUrl,
  normalizeTypographyAndEntities,
  parseAjaxChapterOptions,
  parseNovelCards,
  parseNovelDetail,
  sanitizeChapterHtml,
  stripAggregatorWatermarks,
  Target,
};
