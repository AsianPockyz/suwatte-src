import {
  PickerFilter,
  SearchFilter,
  type SearchFilter as SuwatteSearchFilter,
  SelectFilter,
  type SortOptions,
  ToggleFilter,
} from "@suwatte/toolchain";
import {
  ATSU_FORMATS,
  ATSU_GENRES,
  ATSU_SORT_OPTIONS,
  ATSU_STATUSES,
  ATSU_THEMES,
} from "./constants.js";
import { getShowNsfwPreference } from "./preferences.js";
import type { ExploreParams, TriStateSelection } from "./types.js";

/**
 * Semantic FilterType enumeration mapping tri-state, picker, and toggle filter kinds.
 */
export enum FilterType {
  TRI_STATE = "select",
  SELECT = "picker",
  TOGGLE = "toggle",
  TEXT = "text",
}

export const FILTER_IDS = {
  GENRES: "genres",
  THEMES: "tags",
  FORMAT: "format",
  STATUS: "status",
  NSFW: "nsfw",
} as const;

// Pre-computed static option dictionaries cached in memory to prevent redundant allocations
const ALL_GENRE_FILTER_OPTIONS = ATSU_GENRES.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

const SFW_GENRE_FILTER_OPTIONS = ATSU_GENRES.filter((genre) => !genre.nsfw).map(
  (opt) => ({
    id: opt.id,
    title: opt.title,
  })
);

const THEME_FILTER_OPTIONS = ATSU_THEMES.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

const FORMAT_FILTER_OPTIONS = ATSU_FORMATS.map((fmt) => ({
  id: fmt.id,
  title: fmt.title,
}));

const STATUS_FILTER_OPTIONS = ATSU_STATUSES.map((st) => ({
  id: st.id,
  title: st.title,
}));

const SORT_OPTION_LIST = ATSU_SORT_OPTIONS.map((opt) => ({
  id: opt.id,
  title: opt.title,
}));

const CACHED_SORT_OPTIONS: SortOptions = {
  options: SORT_OPTION_LIST,
  disableOrdering: false,
};

/**
 * Helper constructing a Tri-State (`FilterType.TRI_STATE`) filter allowing
 * Neutral, Include (+), and Exclude (-) selection states in Suwatte.
 */
export function createTriStateFilter(
  id: string,
  title: string,
  options: ReadonlyArray<{ id: string; title: string }>,
  subtitle?: string
): SuwatteSearchFilter {
  const _type = FilterType.TRI_STATE;
  void _type;
  return SearchFilter(
    id,
    title,
    SelectFilter(
      options.map((opt) => ({ id: opt.id, title: opt.title })),
      true
    ),
    subtitle
  );
}

const SHARED_STATIC_FILTERS: readonly SuwatteSearchFilter[] = [
  createTriStateFilter(
    FILTER_IDS.THEMES,
    "Themes & Tags",
    THEME_FILTER_OPTIONS,
    "Tap once to Include (+), twice to Exclude (-)"
  ),
  SearchFilter(
    FILTER_IDS.FORMAT,
    "Format",
    PickerFilter(FORMAT_FILTER_OPTIONS),
    "Filter by publication format"
  ),
  SearchFilter(
    FILTER_IDS.STATUS,
    "Status",
    PickerFilter(STATUS_FILTER_OPTIONS),
    "Filter by publication status"
  ),
  SearchFilter(
    FILTER_IDS.NSFW,
    "Include NSFW / Mature",
    ToggleFilter(),
    "Override mature/erotica content visibility for this search"
  ),
];

const CACHED_SEARCH_FILTERS_SFW: SuwatteSearchFilter[] = [
  createTriStateFilter(
    FILTER_IDS.GENRES,
    "Genres",
    SFW_GENRE_FILTER_OPTIONS,
    "Tap once to Include (+), twice to Exclude (-)"
  ),
  ...SHARED_STATIC_FILTERS,
];

const CACHED_SEARCH_FILTERS_NSFW: SuwatteSearchFilter[] = [
  createTriStateFilter(
    FILTER_IDS.GENRES,
    "Genres",
    ALL_GENRE_FILTER_OPTIONS,
    "Tap once to Include (+), twice to Exclude (-)"
  ),
  ...SHARED_STATIC_FILTERS,
];

export async function getSearchFilters(): Promise<SuwatteSearchFilter[]> {
  const showNsfw = await getShowNsfwPreference();
  return showNsfw ? CACHED_SEARCH_FILTERS_NSFW : CACHED_SEARCH_FILTERS_SFW;
}

export async function getSortOptions(): Promise<SortOptions> {
  return CACHED_SORT_OPTIONS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTriState(value: unknown): TriStateSelection | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const include: string[] = [];
  if (Array.isArray(value.include)) {
    for (let i = 0, len = value.include.length; i < len; i++) {
      const s = String(value.include[i]).trim();
      if (s.length > 0) {
        include.push(s);
      }
    }
  }

  const exclude: string[] = [];
  if (Array.isArray(value.exclude)) {
    for (let i = 0, len = value.exclude.length; i < len; i++) {
      const s = String(value.exclude[i]).trim();
      if (s.length > 0) {
        exclude.push(s);
      }
    }
  }

  if (include.length === 0 && exclude.length === 0) {
    return undefined;
  }
  return { include, exclude };
}

export function mapFiltersToExploreParams(
  filters?: unknown,
  sort?: { key: string; ascending?: boolean },
  query?: string,
  page = 1
): ExploreParams {
  const params: ExploreParams = {
    query: query?.trim() || undefined,
    page,
    mode: "explore",
  };

  if (sort?.key) {
    params.sortBy = sort.key;
    params.sortAscending = sort.ascending;
  }

  if (!isRecord(filters)) {
    return params;
  }

  const genres = normalizeTriState(filters[FILTER_IDS.GENRES]);
  if (genres) {
    params.genres = genres;
  }

  const tags = normalizeTriState(filters[FILTER_IDS.THEMES]);
  if (tags) {
    params.tags = tags;
  }

  const format = filters[FILTER_IDS.FORMAT];
  if (typeof format === "string" && format.length > 0 && format !== "all") {
    params.format = format;
  } else if (Array.isArray(format) && format.length > 0) {
    const joined = format
      .map((f) => String(f).trim())
      .filter((f) => f.length > 0 && f !== "all")
      .join(",");
    if (joined) {
      params.format = joined;
    }
  } else if (isRecord(format) && Array.isArray(format.include)) {
    const joined = format.include
      .map((f) => String(f).trim())
      .filter((f) => f.length > 0 && f !== "all")
      .join(",");
    if (joined) {
      params.format = joined;
    }
  }

  const status = filters[FILTER_IDS.STATUS];
  if (typeof status === "string" && status.length > 0 && status !== "all") {
    params.status = status;
  }

  const nsfwVal = filters[FILTER_IDS.NSFW];
  if (typeof nsfwVal === "boolean") {
    params.includeNsfw = nsfwVal;
  }

  return params;
}
