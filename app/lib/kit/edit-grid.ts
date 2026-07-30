import type { LookupOption } from '~/lib/kit/lookup'

export type KitEditGridRow = Record<string, unknown>
export type KitEditGridCellType = 'text' | 'number' | 'select' | 'lookup' | 'readonly'
export type KitEditGridRowOperation = 'add' | 'copy' | 'del'

export interface KitEditGridLookup<T extends KitEditGridRow = KitEditGridRow> {
  fetch: (keyword: string, row: Readonly<T>, rowIndex: number) => Promise<LookupOption[]>
  recentKey?: string
  allowCreate?: boolean
  disabledReason?: string | ((row: Readonly<T>, rowIndex: number) => string)
  placeholder?: string
}

export interface KitEditGridColumn<T extends KitEditGridRow = KitEditGridRow> {
  key: Extract<keyof T, string> | string
  label: string
  width?: number
  minWidth?: number
  type?: KitEditGridCellType
  required?: boolean
  options?: readonly string[]
  derive?: (row: Readonly<T>) => unknown
  lookup?: KitEditGridLookup<T>
}

export interface KitEditGridSummary {
  key: string
  agg: 'sum'
}

export interface KitEditGridPicker<T extends KitEditGridRow = KitEditGridRow> {
  label: string
  onPick: () => Promise<T[] | null>
}

export interface KitEditGridValidationError {
  row: number
  key: string
}

function isEmpty(value: unknown): boolean {
  return value == null || (typeof value === 'string' && !value.trim())
}

export function applyDerive<T extends KitEditGridRow>(
  rows: readonly T[],
  columns: readonly KitEditGridColumn<T>[],
): T[] {
  return rows.map((row) => {
    const next = { ...row } as T
    for (const column of columns) {
      if (column.derive)
        next[column.key as keyof T] = column.derive(next) as T[keyof T]
    }
    return next
  })
}

export function validateRows<T extends KitEditGridRow>(
  rows: readonly T[],
  columns: readonly KitEditGridColumn<T>[],
): KitEditGridValidationError[] {
  const errors: KitEditGridValidationError[] = []
  rows.forEach((row, rowIndex) => {
    columns.forEach((column) => {
      if (column.required && isEmpty(row[column.key]))
        errors.push({ row: rowIndex, key: column.key })
    })
  })
  return errors
}

export function aggregateRows<T extends KitEditGridRow>(
  rows: readonly T[],
  summary: readonly KitEditGridSummary[],
): Record<string, number> {
  return Object.fromEntries(summary.map(item => [
    item.key,
    rows.reduce((total, row) => {
      const value = Number(row[item.key])
      return total + (Number.isFinite(value) ? value : 0)
    }, 0),
  ]))
}
