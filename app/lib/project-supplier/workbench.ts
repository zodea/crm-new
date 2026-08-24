export const PROJECT_SUPPLIER_WORKBENCH_TABS = [
  'overview',
  'contract',
  'claim',
  'ticket',
  'payment',
  'settlement',
] as const

export type ProjectSupplierWorkbenchTab = typeof PROJECT_SUPPLIER_WORKBENCH_TABS[number]

export function projectSupplierWorkbenchTab(value: unknown): ProjectSupplierWorkbenchTab | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string'
    && PROJECT_SUPPLIER_WORKBENCH_TABS.includes(candidate as ProjectSupplierWorkbenchTab)
    ? candidate as ProjectSupplierWorkbenchTab
    : null
}
