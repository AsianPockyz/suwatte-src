import type {
  Chapter,
  ChapterPage,
  Content,
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

export interface AtsuPosterObject {
  id?: string;
  image?: string | null;
  smallImage?: string | null;
  mediumImage?: string | null;
  largeImage?: string | null;
}

export interface AtsuBannerObject {
  url?: string | null;
  aspectRatio?: number | null;
}

export interface AtsuGenreTag {
  id: string;
  name: string;
  namePath?: string | null;
  weight?: string | null;
  group?: string | null;
  adult?: boolean;
  safeCount?: number;
  adultCount?: number;
}

export interface AtsuAuthor {
  id?: string;
  name: string;
  slug?: string | null;
  type?: "Author" | "Artist" | string | null;
}

export interface AtsuFirstChapterRef {
  id: string;
  title?: string | null;
  number: number;
}

export interface AtsuScanlator {
  id: string;
  name: string;
  score?: number | null;
  myVote?: number | null;
  firstChapter?: AtsuFirstChapterRef | null;
}

export interface AtsuChapterItem {
  id: string;
  title?: string | null;
  number: number;
  volume?: number | null;
  index?: number | null;
  pageCount?: number | null;
  scanlationMangaId?: string | null;
  scanId?: string | null;
  createdAt?: number | string | null;
  progress?: number | null;
}

export interface AtsuMangaSummary {
  id: string;
  title: string;
  englishTitle?: string | null;
  image?: string | AtsuPosterObject | null;
  poster?: string | AtsuPosterObject | null;
  smallImage?: string | null;
  mediumImage?: string | null;
  largeImage?: string | null;
  posterSmall?: string | null;
  posterMedium?: string | null;
  isAdult?: boolean | null;
  mbContentRating?: "Safe" | "Suggestive" | "Erotica" | "Pornographic" | string | null;
  type?:
    | "Manga"
    | "Manwha"
    | "Manhwa"
    | "Manhua"
    | "Novel"
    | "OEL"
    | "OTHER"
    | "Other"
    | string
    | null;
  medium?: "Comic" | "Novel" | string | null;
  status?: "Ongoing" | "Completed" | "Hiatus" | "Canceled" | "Cancelled" | string | null;
  mbRating?: number | null;
  avgRating?: number | null;
  views?: string | number | null;
  popularity?: string | number | null;
  trending?: number | null;
  createdAt?: number | string | null;
  updatedAt?: number | string | null;
  dateAdded?: number | string | null;
  released?: number | null;
  releaseDate?: number | null;
  releaseYear?: number | null;
  year?: number | null;
  chapterCount?: number | null;
  officialTranslation?: boolean | null;
  hidden?: boolean | null;
  acronyms?: string[];
  otherNames?: string[];
  synopsis?: string | null;
  genreIds?: Array<string | number>;
  tagIds?: Array<string | number>;
  genres?: Array<string | AtsuGenreTag>;
  tags?: Array<string | AtsuGenreTag>;
  authors?: Array<string | AtsuAuthor>;
}

export interface AtsuBrowseResponse {
  items: AtsuMangaSummary[];
  total?: number;
  hasMore?: boolean;
}

export interface AtsuSearchHit {
  document: AtsuMangaSummary;
  highlight?: Record<string, unknown>;
  highlights?: unknown[];
}

export interface AtsuSearchRequestParams {
  collection_name?: string;
  first_q?: string;
  per_page: number;
  q: string;
}

export interface AtsuSearchResponse {
  facet_counts?: unknown[];
  found: number;
  out_of?: number;
  page: number;
  request_params?: AtsuSearchRequestParams;
  hits: AtsuSearchHit[];
  search_cutoff?: boolean;
  search_time_ms?: number;
}

export interface AtsuMangaDetail extends AtsuMangaSummary {
  banner?: AtsuBannerObject | string | null;
  posterCount?: number | null;
  scanlators?: AtsuScanlator[] | null;
  sourcePreference?: string | null;
  totalChapterCount?: number | null;
  hasMoreChapters?: boolean | null;
  chapters?: AtsuChapterItem[] | null;
  recommendations?: AtsuMangaSummary[] | null;
  similarManga?: AtsuMangaSummary[] | null;
  anilistId?: string | null;
  apId?: string | null;
  kitsuId?: string | null;
  annId?: string | null;
  mangaBakaId?: string | null;
  malId?: string | null;
  mangaUpdatesId?: string | null;
  novelUpdatesId?: string | null;
  comickHid?: string | null;
  kenmeiUrl?: string | null;
}

export interface AtsuMangaPageResponse {
  mangaPage?: AtsuMangaDetail;
  novelPage?: AtsuMangaDetail;
  novel?: AtsuMangaDetail;
  manga?: AtsuMangaDetail;
}

export interface AtsuAllChaptersResponse {
  chapters?: AtsuChapterItem[];
  novelChapters?: AtsuChapterItem[];
}

export interface AtsuChapterPageImage {
  id: string;
  image: string;
  number: number;
  width?: number | null;
  height?: number | null;
  aspectRatio?: number | null;
  text?: string | null;
  content?: string | null;
  body?: string | null;
}

export interface AtsuReadChapter {
  id: string;
  number: number;
  title?: string | null;
  scanlationMangaId?: string | null;
  pages?: AtsuChapterPageImage[];
  content?: string | null;
  text?: string | null;
  body?: string | null;
  html?: string | null;
  paragraphs?: string[] | null;
}

export interface AtsuReadChapterResponse {
  readChapter?: AtsuReadChapter;
  novelChapter?: AtsuReadChapter;
  chapter?: AtsuReadChapter;
  content?: string | null;
  text?: string | null;
  body?: string | null;
  html?: string | null;
  paragraphs?: string[] | null;
}

export interface AtsuAvailableFiltersResponse {
  genres?: AtsuGenreTag[];
  tags?: AtsuGenreTag[];
  types?: Array<{ id: string; name: string }>;
  statuses?: Array<{ id: string; name: string }>;
}

export type ImageQualityFormat = "webp" | "original";

export interface AtsuUserPreferences {
  imageFormat: ImageQualityFormat;
  deduplicateChapters: boolean;
  scanlatorWhitelist: string[];
  showNsfw: boolean;
  contentRatings: string[];
  excludedGenres: string[];
  excludedTags: string[];
  enabledFormats?: string[];
}

export interface CompiledFilterContext {
  readonly allowedFormatsSet: ReadonlySet<string>;
  readonly excludedGenreSet: ReadonlySet<string>;
  readonly excludedTagSet: ReadonlySet<string>;
  readonly allowsSafe: boolean;
  readonly allowsSuggestive: boolean;
  readonly allowsErotica: boolean;
  readonly allowsAdult: boolean;
}

export interface AtsuSourceConfiguration extends SourceConfiguration {
  cloudflareResolutionURL?: string;
}

export interface AtsuChapterPage extends ChapterPage {
  headers?: Readonly<Record<string, string>>;
}

export interface TriStateSelection {
  include: string[];
  exclude: string[];
}

export interface ExploreParams {
  query?: string;
  page?: number;
  perPage?: number;
  genres?: TriStateSelection;
  tags?: TriStateSelection;
  format?: string;
  status?: string;
  sortBy?: string;
  sortAscending?: boolean;
  includeNsfw?: boolean;
  mode?:
    | "explore"
    | "popular"
    | "latest"
    | "hot_updates"
    | "recently_added"
    | "top_rated"
    | "most_bookmarked"
    | "trending"
    | "manhwa"
    | "manga"
    | string;
}

export interface MangaDetailsResult {
  content: Content;
  chapters: Chapter[];
  raw: AtsuMangaDetail;
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
  getSearchResults(request: SearchRequest, page: number): Promise<PagedItemList>;
}

export interface Filterable {
  getSearchFilters(): Promise<SearchFilter[]>;
  getSortOptions(): Promise<SortOptions>;
}

export interface ContentResolver {
  getContent(contentId: string): Promise<Content>;
  canResolveUrl?(url: string): boolean;
  resolveUrl?(url: string): Promise<Content>;
}

export interface ChapterProvider {
  getChapters(contentId: string): Promise<Chapter[]>;
  getChapterPages(contentId: string, chapterId: string): Promise<ChapterPage[]>;
  getChapterText(
    contentId: string,
    chapterId: string
  ): Promise<SourceChapterText>;
}

export interface PreferenceProvider {
  getSettingsPage(): Promise<UIForm | null>;
  getPreferenceMenu?(): Promise<UIForm | null>;
  onFormSubmitted(id: string, data: PopulatedForm): Promise<void>;
}
