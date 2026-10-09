/** PagedResult<T> as the .NET API serialises it (TotalPages is computed). */
export function pagedResult<T>(items: T[], totalCount: number, page: number, pageSize: number, extra?: { memberCount?: number | null; honoraryCount?: number | null }) {
  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: pageSize ? Math.ceil(totalCount / pageSize) : 0,
    memberCount: extra?.memberCount ?? null,
    honoraryCount: extra?.honoraryCount ?? null,
  };
}
