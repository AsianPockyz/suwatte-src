import {
  PickerFilter,
  SearchFilter,
  SelectFilter,
  type SearchFilter as SuwatteSearchFilter,
  type SortOptions,
} from "@suwatte/toolchain";
import {
  NOVELFULL_GENRES,
  NOVELFULL_SORT_OPTIONS,
  NOVELFULL_STATUS_OPTIONS,
} from "./constants.js";
import { parseStringList } from "./preferences.js";
import type { NovelFullExploreParams, TriStateSelection } from "./types.js";

export const FILTER_IDS = {
  GENRES: "genres",
  GENRE: "genre",
  CATEGORIES: "categories",
  STATUS: "status",
  SORT: "sort",
} as const;

export const GENRE_SELECT_OPTIONS = NOVELFULL_GENRES.map((g) => ({
  id: g.id,
  title: g.title,
}));

export const STATUS_PICKER_OPTIONS = NOVELFULL_STATUS_OPTIONS.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

export const SORT_OPTION_LIST = NOVELFULL_SORT_OPTIONS.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

export const CACHED_SORT_OPTIONS: SortOptions = {
  options: SORT_OPTION_LIST,
  disableOrdering: false,
};

export const CACHED_SEARCH_FILTERS: SuwatteSearchFilter[] = [
  SearchFilter(
    FILTER_IDS.GENRES,
    "Genres / Categories",
    SelectFilter(GENRE_SELECT_OPTIONS, true),
    "Filter by NovelFull genres and categories"
  ),
  SearchFilter(
    FILTER_IDS.STATUS,
    "Status",
    PickerFilter(STATUS_PICKER_OPTIONS),
    "Filter by publication status (All, Ongoing, Completed)"
  ),
  SearchFilter(
    FILTER_IDS.SORT,
    "Sorting",
    PickerFilter(SORT_OPTION_LIST),
    "Sort browse and search results (Latest, Hot, Most Popular)"
  ),
];

export async function getSearchFilters(): Promise<SuwatteSearchFilter[]> {
  return CACHED_SEARCH_FILTERS;
}

export async function getSortOptions(): Promise<SortOptions> {
  return CACHED_SORT_OPTIONS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mapFiltersToExploreParams(
  filters?: unknown,
  sort?: { key: string; ascending?: boolean },
  query?: string,
  page = 1
): NovelFullExploreParams {
  const trimmedQuery = query?.trim();
  const params: NovelFullExploreParams = {
    query: trimmedQuery && trimmedQuery.length > 0 ? trimmedQuery : undefined,
    page: Math.max(1, page || 1),
  };

  if (sort?.key) {
    params.sortBy = sort.key.trim().toLowerCase();
    params.sortAscending = sort.ascending;
  }

  if (isRecord(filters)) {
    const rawGenres =
      filters[FILTER_IDS.GENRES] ??
      filters[FILTER_IDS.GENRE] ??
      filters[FILTER_IDS.CATEGORIES];

    if (typeof rawGenres === "string" && rawGenres.trim().length > 0) {
      const cleanGenre = rawGenres.trim();
      params.genre = cleanGenre;
      params.genres = { include: [cleanGenre], exclude: [] };
    } else if (Array.isArray(rawGenres)) {
      const inc = parseStringList(rawGenres);
      if (inc.length > 0) {
        params.genre = inc[0];
        params.genres = { include: inc, exclude: [] };
      }
    } else if (isRecord(rawGenres)) {
      const include = parseStringList(rawGenres.include);
      const exclude = parseStringList(rawGenres.exclude);
      const triState: TriStateSelection = { include, exclude };
      params.genres = triState;
      if (include.length > 0) {
        params.genre = include[0];
      }
    }

    const rawStatus = filters[FILTER_IDS.STATUS];
    if (typeof rawStatus === "string" && rawStatus.trim().length > 0) {
      params.status = rawStatus.trim().toLowerCase();
    }

    const rawSort = filters[FILTER_IDS.SORT];
    if (
      !params.sortBy &&
      typeof rawSort === "string" &&
      rawSort.trim().length > 0
    ) {
      params.sortBy = rawSort.trim().toLowerCase();
    }
  }

  return params;
}
