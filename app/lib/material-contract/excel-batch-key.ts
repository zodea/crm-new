import type { MaterialExcelDecision } from './excel-contract'

function canonical(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonical)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]))
  return value
}
export async function materialExcelBatchKey(input: { workspaceId: string, actorId: string, fileHash: string, fileName: string, fileSize: number, decisions: MaterialExcelDecision[] }): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(input)))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function materialExcelCommandIds(batchKey: string, indexes: readonly number[]): string[] {
  if (!/^[a-f0-9]{64}$/.test(batchKey) || indexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= 200) || new Set(indexes).size !== indexes.length)
    throw new Error('采购合同原批次编号无效')
  return indexes.map(index => `matx-${batchKey}-${index.toString(36)}`)
}
