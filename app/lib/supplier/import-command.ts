import type { SupplierCommandRepository, SupplierCommandResultDTO, SupplierImportCommandRequestDTO, SupplierImportDecision, SupplierImportDraft } from './command-contract'
import { commandVersionAtLeast } from '../forms/command-recovery'
import { SUPPLIER_WRITE_CAPABILITY } from './command-contract'
import { normalizeSupplierImportRow } from './import'

const supplierImportDecision = Symbol('supplier-import-decision')
const supplierImportSource = Symbol('supplier-import-source')
const persistentCapability = 'supplier:persistent:write'

/** 人工选择与映射行绑定，不混入可导出的源字段。 */
export function setSupplierImportDecision(row: Record<string, unknown>, decision: SupplierImportDecision) {
  Object.defineProperty(row, supplierImportDecision, { value: decision, configurable: true })
}

export function setSupplierImportSource(row: Record<string, unknown>, source: string) {
  Object.defineProperty(row, supplierImportSource, { value: source, configurable: true })
}

export function getSupplierImportSource(row: Record<string, unknown>): string | undefined {
  return (row as Record<PropertyKey, unknown>)[supplierImportSource] as string | undefined
}

/** 只生成匿名来源键，浏览器恢复信息不保存文件名、行内容或银行卡。 */
export async function supplierImportSourceKey(fileDigest: string, sheet: string, rowNumber: number): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(fileDigest) || !sheet.trim() || !Number.isSafeInteger(rowNumber) || rowNumber < 1)
    throw new Error('导入文件来源不完整，请重新选择文件')
  const bytes = new TextEncoder().encode(JSON.stringify([fileDigest, sheet, rowNumber]))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `import:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export function supplierImportDraftFromRow(row: Record<string, unknown>): SupplierImportDraft {
  const { source: _source, ...fields } = normalizeSupplierImportRow(row)
  return fields as SupplierImportDraft
}

/** 同一导入行重试沿用命令 ID；中央回读成功后才计为导入完成。 */
export function createSupplierRowImporter(repository: Pick<SupplierCommandRepository, 'context' | 'importRow' | 'loadForm'>, options: { onPrepared?: (request: SupplierImportCommandRequestDTO, row: Record<string, unknown>, persistent: boolean) => void | Promise<void> } = {}) {
  const requests = new WeakMap<Record<string, unknown>, SupplierImportCommandRequestDTO>()
  const sourceModes = new WeakMap<Record<string, unknown>, boolean>()
  return async (row: Record<string, unknown>): Promise<SupplierCommandResultDTO> => {
    let request = requests.get(row)
    if (!request) {
      const fields = supplierImportDraftFromRow(row)
      const session = await repository.context()
      if (!session.capabilities.includes(SUPPLIER_WRITE_CAPABILITY))
        throw new Error('无分供方导入权限')
      request = {
        workspaceId: session.workspaceId,
        actorId: session.actorId,
        requiredCapability: SUPPLIER_WRITE_CAPABILITY,
        commandId: crypto.randomUUID(),
        draft: fields,
        ...((row as Record<PropertyKey, unknown>)[supplierImportDecision] ? { decision: (row as Record<PropertyKey, unknown>)[supplierImportDecision] as SupplierImportDecision } : {}),
      }
      const persistent = session.capabilities.includes(persistentCapability)
      await options.onPrepared?.(request, row, persistent)
      requests.set(row, request)
      sourceModes.set(row, persistent)
    }
    const saved = await repository.importRow(request)
    if (saved.commandId !== request.commandId || (request.decision?.kind === 'replace' && saved.id !== request.decision.id))
      throw new Error('导入回执与原提交不一致，请保留原编号')
    const form = await repository.loadForm(saved.id)
    if (form.draft.id !== saved.id || !commandVersionAtLeast(form.version, saved.version))
      throw new Error('分供方已保存，但当前同一记录尚未可靠读取')
    const current = await repository.context()
    if (current.workspaceId !== request.workspaceId || current.actorId !== request.actorId || !current.capabilities.includes(SUPPLIER_WRITE_CAPABILITY) || current.capabilities.includes(persistentCapability) !== sourceModes.get(row))
      throw new Error('导入期间身份或权限变化，请保留原提交')
    return saved
  }
}
