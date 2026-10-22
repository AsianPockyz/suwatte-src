import {
  type Chapter,
  type ChapterPage,
  type Content,
  ContentRating as SuwatteContentRating,
  type HomePage,
  type Item,
  type ItemListRequest,
  type ItemPageResponse,
  type PagedItemList,
  type PopulatedForm,
  type SearchFilter,
  type SearchRequest,
  type SortOptions,
  type SourceConfiguration,
  type SourceFeed,
  type UIForm,
} from "@suwatte/toolchain";

declare module "@suwatte/toolchain" {
  enum ContentRating {
    ADULT = 2,
  }
}

// Ensure runtime ContentRating object exposes ADULT = 2 (MATURE)
(SuwatteContentRating as unknown as Record<string, number>).ADULT =
  SuwatteContentRating.MATURE;

export type ImHentaiCategoryId =
  | "doujinshi"
  | "manga"
  | "western"
  | "imageset"
  | "artistcg"
  | "gamecg"
  | "cosplay";

export type ImHentaiLanguageId =
  | "en"
  | "jp"
  | "zh"
  | "es"
  | "fr"
  | "kr"
  | "de"
  | "ru"
  | "all";

export type ImHentaiTitlePreference = "english" | "japanese";

export interface Property {
  id: string;
  title: string;
  namespace?: string;
}

export interface ImHentaiUserPreferences {
  categories: ImHentaiCategoryId[];
  language: ImHentaiLanguageId;
  titlePreference: ImHentaiTitlePreference;
}

export interface ImHentaiSourceConfiguration extends SourceConfiguration {
  imageReferer: string;
  cloudflareResolutionURL: string;
  standardHeaders: Readonly<Record<string, string>>;
}

export interface ImHentaiChapterPage extends ChapterPage {
  url: string;
  headers: Readonly<Record<string, string>>;
}

export interface ImHentaiGalleryCard {
  id: string;
  title: string;
  subtitle?: string;
  japaneseTitle?: string;
  thumbnailUrl: string;
  webUrl: string;
  category?: string;
  language?: string;
  tags: string[];
  totalPages?: number;
  serverId?: string;
  loadDir?: string;
  baseUrl?: string;
  baseImageUrl?: string;
  isJapaneseRaw?: boolean;
}

export interface ImHentaiPageResolutionMeta {
  galleryId: string;
  loadDir: string;
  serverId: string;
  totalPages: number;
  extensionMap: Readonly<Record<string, string>>;
  defaultExt: string;
  baseUrl?: string;
  baseImageUrl?: string;
}

export interface ImHentaiGalleryDetail extends ImHentaiPageResolutionMeta {
  id: string;
  title: string;
  japaneseTitle?: string;
  additionalTitles: string[];
  coverImage: string;
  webUrl: string;
  artists: string[];
  groups: string[];
  parodies: string[];
  characters: string[];
  categories: string[];
  languages: string[];
  tags: string[];
  uploadedText?: string;
  favorites?: number;
  rating?: number;
  relatedItems?: Item[];
}

export interface ImHentaiContent extends Content {
  creators?: string[];
}

export interface TriStateSelection {
  include: string[];
  exclude: string[];
}

export interface ImHentaiExploreParams {
  query?: string;
  page?: number;
  feedKey?: string;
  sortBy?: "latest" | "popular" | "title" | string;
  sortAscending?: boolean;
  category?: string;
  categories?: TriStateSelection;
  tags?: TriStateSelection;
  language?: string;
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

export interface ChapterProvider {
  getChapters(contentId: string): Promise<Chapter[]>;
  getChapterPages(contentId: string, chapterId: string): Promise<ChapterPage[]>;
}

export interface PreferenceProvider {
  getSettingsPage(): Promise<UIForm | null>;
  getPreferenceMenu(): Promise<UIForm | null>;
  onFormSubmitted(id: string, data: PopulatedForm): Promise<void>;
}
