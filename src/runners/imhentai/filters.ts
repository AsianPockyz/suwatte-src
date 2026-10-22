import {
  PickerFilter,
  SearchFilter,
  type SearchFilter as SuwatteSearchFilter,
  type SortOptions,
} from "@suwatte/toolchain";
import {
  IMHENTAI_SORT_OPTIONS,
  SEARCH_CATEGORY_OPTIONS,
} from "./constants.js";
import type { ImHentaiExploreParams, TriStateSelection } from "./types.js";

export const FILTER_IDS = {
  CATEGORY: "category",
  CATEGORIES: "categories",
  LANGUAGE: "language",
} as const;

export const CATEGORY_PICKER_OPTIONS = SEARCH_CATEGORY_OPTIONS.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

export const SORT_OPTION_LIST = IMHENTAI_SORT_OPTIONS.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

export const CACHED_SORT_OPTIONS: SortOptions = {
  options: SORT_OPTION_LIST,
  disableOrdering: false,
};

export const CACHED_SEARCH_FILTERS: SuwatteSearchFilter[] = [
  SearchFilter(
    FILTER_IDS.CATEGORY,
    "Category",
    PickerFilter(CATEGORY_PICKER_OPTIONS),
    "Select content category"
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
): ImHentaiExploreParams {
  const trimmedQuery = query?.trim();
  const params: ImHentaiExploreParams = {
    query: trimmedQuery && trimmedQuery.length > 0 ? trimmedQuery : undefined,
    page,
  };

  if (sort?.key) {
    params.sortBy = sort.key;
    params.sortAscending = sort.ascending;
  }

  if (isRecord(filters)) {
    const rawCategory =
      filters[FILTER_IDS.CATEGORY] ?? filters[FILTER_IDS.CATEGORIES];
    if (typeof rawCategory === "string" && rawCategory.trim().length > 0) {
      params.category = rawCategory.trim().toLowerCase();
    } else if (isRecord(rawCategory)) {
      params.categories = rawCategory as unknown as TriStateSelection;
    }

    const rawLanguage = filters[FILTER_IDS.LANGUAGE];
    if (typeof rawLanguage === "string" && rawLanguage.trim().length > 0) {
      params.language = rawLanguage.trim().toLowerCase();
    }
  }

  return params;
}
