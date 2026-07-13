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
