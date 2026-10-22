import type {
  Chapter,
  Content,
  ContentRating,
  ContentStatus,
  HomePage,
  Item,
  ItemListRequest,
  ItemPageResponse,
  PagedItemList,
  PopulatedForm,
  SearchFilter,
  SearchRequest,
  SortOptions,
  SourceChapterText,
  SourceConfiguration,
  SourceFeed,
  UIForm,
} from "@suwatte/toolchain";

export type NovelFullFeedKey =
  | "discover"
  | "hot-novel"
  | "latest-release-novel"
  | "most-popular"
  | "completed-novel";

export type NovelFullStatusFilter = "all" | "ongoing" | "completed";

export type NovelFullSortKey = "latest" | "hot" | "popular";

export interface TriStateSelection {
  include: string[];
  exclude: string[];
}

export interface NovelFullUserPreferences {
  sanitizeAds: boolean;
  formatTln: boolean;
  normalizeSpacing: boolean;
  excludedGenres: string[];
  customBlacklist: string[];
}

export interface CompiledBlacklistContext {
  readonly excludedGenreSet: ReadonlySet<string>;
  readonly excludedKeywordSet: ReadonlySet<string>;
  readonly excludedPhrases: readonly string[];
  readonly hasExclusions: boolean;
}

export interface NovelFullSourceConfiguration extends SourceConfiguration {
  imageReferer: string;
  cloudflareResolutionURL: string;
  standardHeaders: Readonly<Record<string, string>>;
}

export interface NovelFullCard {
  id: string;
  title: string;
  coverImage: string;
  webUrl: string;
  author?: string;
  latestChapter?: string;
  status?: ContentStatus;
  isHot?: boolean;
  isFull?: boolean;
  isNew?: boolean;
  genres: string[];
  rating?: ContentRating;
}

export interface NovelFullChapterEntry {
  id: string;
  chapterId: string;
  title: string;
  number: number;
  volume?: number;
  webUrl: string;
  date?: Date;
}

export interface NovelFullDetail {
  id: string;
  numericNovelId?: string;
  title: string;
  additionalTitles: string[];
  coverImage: string;
  webUrl: string;
  authors: string[];
  genres: string[];
  source?: string;
  status: ContentStatus;
  summary: string;
  ratingValue?: number;
  ratingCount?: number;
  contentRating: ContentRating;
  onPageChapters: NovelFullChapterEntry[];
  relatedItems: NovelFullCard[];
}

export interface NovelFullExploreParams {
  query?: string;
  page?: number;
  genres?: TriStateSelection;
  genre?: string;
  status?: NovelFullStatusFilter | string;
  sortBy?: NovelFullSortKey | string;
  sortAscending?: boolean;
}

export interface HomeProvider {
  getHomePage(): Promise<HomePage>;
  getItemPage(key: string, page: number): Promise<ItemPageResponse>;
  getPageSectionItems(sectionKey: string, pageKey: string): Promise<Item[]>;
}

export interface DirectoryHandler {
  getCustomFeeds(): Promise<SourceFeed[]>;
  getItemList(request: ItemListRequest, page: number): Promise<PagedItemList>;
}

export interface Searchable {
  getSearchResults(
    request: SearchRequest,
    page: number
  ): Promise<PagedItemList>;
}

export interface Filterable {
  getSearchFilters(): Promise<SearchFilter[]>;
  getSortOptions(): Promise<SortOptions>;
}

export interface ContentResolver {
  getContent(contentId: string): Promise<Content>;
  canResolveUrl(url: string): boolean;
  resolveUrl(url: string): Promise<Content>;
}

export interface NovelChapterProvider {
  getChapters(contentId: string): Promise<Chapter[]>;
  getChapterText(
    contentId: string,
    chapterId: string
  ): Promise<SourceChapterText>;
}

export interface PreferenceProvider {
  getSettingsPage(): Promise<UIForm | null>;
  getPreferenceMenu(): Promise<UIForm | null>;
  onFormSubmitted(id: string, data: PopulatedForm): Promise<void>;
}
