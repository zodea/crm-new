import type { PaginationDTO } from '../../types/read-model'

export const READ_PAGE_SIZES = [10, 20, 50, 100] as const

/** Called after the operation validates its query; the returned page describes the same complete filtered set. */
export function resolvePagination(requestedPage: number, pageSize: number, total: number): PaginationDTO {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || !Number.isSafeInteger(total) || total < 0)
    throw new RangeError('分页依据无效')
  return { requestedPage, page: Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize))), pageSize, total }
}

export function isPaginationDTO(value: unknown, itemCount?: number): value is PaginationDTO {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== 4 || !['requestedPage', 'page', 'pageSize', 'total'].every(key => Number.isSafeInteger(row[key]))
    || Number(row.requestedPage) < 1 || Number(row.pageSize) < 1 || Number(row.total) < 0) {
    return false
  }
  const expected = resolvePagination(Number(row.requestedPage), Number(row.pageSize), Number(row.total))
  return row.page === expected.page && (itemCount === undefined || itemCount === Math.min(expected.pageSize, expected.total - (expected.page - 1) * expected.pageSize))
}

/** Missing query values have explicit operation defaults; invalid supplied values never become a successful request. */
export function parsePageQuery(query: Record<string, unknown>, invalid: () => never, defaultSize = 20) {
  const integer = (value: unknown, fallback: number) => {
    if (value === undefined)
      return fallback
    if (!((typeof value === 'string' && /^[1-9]\d*$/.test(value)) || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)))
      return invalid()
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : invalid()
  }
  const requestedPage = integer(query.page, 1)
  const pageSize = integer(query.pageSize, defaultSize)
  if (!READ_PAGE_SIZES.includes(pageSize as typeof READ_PAGE_SIZES[number]))
    return invalid()
  return { requestedPage, pageSize }
}
