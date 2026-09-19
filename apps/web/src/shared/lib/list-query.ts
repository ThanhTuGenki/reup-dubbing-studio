export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];

export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export type ListFilterScalar = string | number | boolean;
export type ListFilterValue =
  | ListFilterScalar
  | readonly ListFilterScalar[]
  | null
  | undefined;
export type ListFilters = Readonly<Record<string, ListFilterValue>>;

export interface ListQueryInput {
  page?: number | string | null;
  pageSize?: number | string | null;
  filters?: ListFilters;
}

export interface NormalizedListQuery {
  page: number;
  pageSize: PageSize;
  filters: Readonly<Record<string, ListFilterScalar | readonly ListFilterScalar[]>>;
}

function toPositiveInteger(value: number | string | null | undefined): number | undefined {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : undefined;
}

export function normalizePageSize(value: ListQueryInput['pageSize']): PageSize {
  const parsed = toPositiveInteger(value);
  return PAGE_SIZE_OPTIONS.find((option) => option === parsed) ?? DEFAULT_PAGE_SIZE;
}

export function compactListFilters(
  filters: ListFilters = {},
): NormalizedListQuery['filters'] {
  const entries: Array<readonly [string, ListFilterScalar | readonly ListFilterScalar[]]> = [];

  for (const [key, rawValue] of Object.entries(filters)) {
    if (rawValue === null || rawValue === undefined) continue;

    if (Array.isArray(rawValue)) {
      const values = rawValue.flatMap((value) => {
        const normalized = typeof value === 'string' ? value.trim() : value;
        return normalized === '' ? [] : [normalized];
      });
      if (values.length > 0) entries.push([key, values]);
      continue;
    }

    const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    if (value !== '') entries.push([key, value]);
  }

  return Object.fromEntries(entries);
}

export function hasActiveListFilters(filters: ListFilters = {}): boolean {
  return Object.keys(compactListFilters(filters)).length > 0;
}

export function normalizeListQuery(input: ListQueryInput = {}): NormalizedListQuery {
  return {
    page: toPositiveInteger(input.page) ?? 1,
    pageSize: normalizePageSize(input.pageSize),
    filters: compactListFilters(input.filters),
  };
}

export function createListQueryKeys(scope: string) {
  const all = [scope] as const;

  return {
    all,
    lists: () => [...all, 'list'] as const,
    list: (query: ListQueryInput = {}) => [...all, 'list', normalizeListQuery(query)] as const,
    details: () => [...all, 'detail'] as const,
    detail: (id: string) => [...all, 'detail', id] as const,
  };
}
