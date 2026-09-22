import type { DataOriginDTO } from '../../types/read-model'
import type { MaterialContractReadRepository } from '../material-contract/read-contract'
import type { MaterialContractInput } from '../material/price-analysis'

/** 复用现行只读合同协议；跨分页变化与受限关系不能形成一份看似完整的分析。 */
export async function readDeliveryMaterialContracts(repository: MaterialContractReadRepository, origin: DataOriginDTO, signal?: AbortSignal): Promise<MaterialContractInput[]> {
  const contracts: MaterialContractInput[] = []
  const seen = new Set<string>()
  let sourceVersion: string | null | undefined
  let expectedTotal: number | null = null
  let readCount = 0
  let currentPage = 1
  const active = () => {
    if (signal?.aborted)
      throw new DOMException('材采合同读取已取消', 'AbortError')
  }
  while (true) {
    active()
    const result = await repository.list({ includeDemo: origin === 'demo', origin, search: '', projectId: null, supplierId: null, status: null, page: currentPage, pageSize: 100 })
    active()
    if (sourceVersion !== undefined && (sourceVersion !== result.sourceVersion || expectedTotal !== result.pagination.total))
      throw new Error('材采合同在读取中发生变化，请重新读取')
    sourceVersion = result.sourceVersion
    expectedTotal = result.pagination.total
    if (result.pagination.page !== currentPage || (expectedTotal > 100 && !sourceVersion))
      throw new Error('材采合同分页来源无法核验，请重试')
    for (const row of result.items) {
      if (row.dataOrigin !== origin || seen.has(row.id))
        throw new Error('材采合同来源或身份不一致，请重新读取')
      seen.add(row.id)
      if (row.project.state === 'forbidden' || row.supplier.state === 'forbidden')
        throw new Error('部分材采合同关联受限，无法读取完整合同来源')
      if (row.project.state !== 'resolved' || row.supplier.state !== 'resolved')
        continue
      contracts.push({ id: row.id, kind: '材采', projectId: row.project.id, supplierId: row.supplier.id, name: row.name, no: row.no, amount: Number(row.amounts.contract), signDate: row.signDate ?? '', dataOrigin: row.dataOrigin })
    }
    readCount += result.items.length
    if (readCount === expectedTotal)
      return contracts
    if (!result.items.length || readCount > expectedTotal)
      throw new Error('材采合同分页数量不一致，请重新读取')
    currentPage++
  }
}
