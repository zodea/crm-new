import type { DataOriginDTO } from '../../types/read-model'
import type { MaterialContractReadRepository } from '../material-contract/read-contract'
import type { MaterialContractInput } from '../material/price-analysis'
import { collectReadPages } from '../read-model/collection'

/** 复用现行只读合同协议；跨分页变化与受限关系不能形成一份看似完整的分析。 */
export async function readDeliveryMaterialContracts(repository: MaterialContractReadRepository, origin: DataOriginDTO, signal?: AbortSignal): Promise<MaterialContractInput[]> {
  const active = () => {
    if (signal?.aborted)
      throw new DOMException('材采合同读取已取消', 'AbortError')
  }
  const result = await collectReadPages({
    load: async (page) => {
      active()
      const result = await repository.list({ includeDemo: origin === 'demo', origin, search: '', projectId: null, supplierId: null, status: null, page, pageSize: 100 })
      active()
      return result
    },
    identity: row => `${row.dataOrigin}:${row.id}`,
    isCurrent: () => !signal?.aborted,
  })
  const contracts: MaterialContractInput[] = []
  for (const row of result.items) {
    if (row.dataOrigin !== origin)
      throw new Error('材采合同来源或身份不一致，请重新读取')
    if (row.project.state === 'forbidden' || row.supplier.state === 'forbidden')
      throw new Error('部分材采合同关联受限，无法读取完整合同来源')
    if (row.project.state !== 'resolved' || row.supplier.state !== 'resolved')
      continue
    contracts.push({ id: row.id, kind: '材采', projectId: row.project.id, supplierId: row.supplier.id, name: row.name, no: row.no, amount: row.amounts.contract === null ? null : Number(row.amounts.contract), signDate: row.signDate ?? '', dataOrigin: row.dataOrigin })
  }
  return contracts
}
