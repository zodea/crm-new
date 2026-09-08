import type { SupplierCommandRepository, SupplierCommandResultDTO, SupplierImportCommandRequestDTO, SupplierImportDraft } from './command-contract'
import { SUPPLIER_WRITE_CAPABILITY } from './command-contract'
import { normalizeSupplierImportRow } from './import'

/** 同一导入行重试沿用命令 ID；中央回读成功后才计为导入完成。 */
export function createSupplierRowImporter(repository: Pick<SupplierCommandRepository, 'context' | 'importRow' | 'loadForm'>) {
  const requests = new WeakMap<Record<string, unknown>, SupplierImportCommandRequestDTO>()
  return async (row: Record<string, unknown>): Promise<SupplierCommandResultDTO> => {
    let request = requests.get(row)
    if (!request) {
      const normalized = normalizeSupplierImportRow(row)
      const { source: _source, ...fields } = normalized
      const session = await repository.context()
      if (!session.capabilities.includes(SUPPLIER_WRITE_CAPABILITY))
        throw new Error('无分供方导入权限')
      request = {
        workspaceId: session.workspaceId,
        actorId: session.actorId,
        requiredCapability: SUPPLIER_WRITE_CAPABILITY,
        commandId: crypto.randomUUID(),
        draft: fields as SupplierImportDraft,
      }
      requests.set(row, request)
    }
    const saved = await repository.importRow(request)
    await repository.loadForm(saved.id)
    return saved
  }
}
