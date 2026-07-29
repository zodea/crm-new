export interface SupplierListFilterable {
  name: string
  aliases: readonly string[]
  uniqueCode: string
  taxNo: string
  supplierCategory: string
  contact: string
  contactPhone: string
  credentialStatus: string
}

export interface SupplierListFilters {
  search: string
  category: string
  credentialStatus: string
}

export type SupplierListSort
  = 'updated-desc'
    | 'name-asc'
    | 'name-desc'
    | 'category-asc'

export interface SupplierListSortable {
  name: string
  supplierCategory: string
  updatedAt: string
}

export function filterSuppliers<T extends SupplierListFilterable>(
  rows: readonly T[],
  filters: SupplierListFilters,
): T[] {
  const query = filters.search.trim().toLocaleLowerCase('zh-CN')

  return rows.filter((supplier) => {
    if (filters.category !== 'all' && supplier.supplierCategory !== filters.category)
      return false
    if (filters.credentialStatus !== 'all' && supplier.credentialStatus !== filters.credentialStatus)
      return false
    if (!query)
      return true

    return [
      supplier.name,
      supplier.aliases.join(' '),
      supplier.uniqueCode,
      supplier.taxNo,
      supplier.supplierCategory,
      supplier.contact,
      supplier.contactPhone,
    ].some(value => value.toLocaleLowerCase('zh-CN').includes(query))
  })
}

export function sortSuppliers<T extends SupplierListSortable>(
  rows: readonly T[],
  sort: SupplierListSort,
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      let order = 0
      if (sort === 'updated-desc') {
        order = right.row.updatedAt.localeCompare(left.row.updatedAt)
      }
      else if (sort === 'name-desc') {
        order = right.row.name.localeCompare(left.row.name, 'zh-CN')
      }
      else if (sort === 'category-asc') {
        order = left.row.supplierCategory.localeCompare(right.row.supplierCategory, 'zh-CN')
          || left.row.name.localeCompare(right.row.name, 'zh-CN')
      }
      else {
        order = left.row.name.localeCompare(right.row.name, 'zh-CN')
      }

      return order || left.index - right.index
    })
    .map(item => item.row)
}
