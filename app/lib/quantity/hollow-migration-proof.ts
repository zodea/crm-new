import type { QuantityHollowProvenHistory } from './central-hollow-proof-contract'
import type { QuantityHollowMigrationGraph, QuantityHollowOriginBinding, QuantityHollowOriginBody } from './hollow-migration-contract'
import { hollowEqual } from './central-hollow-primitives'
import { extendQuantityHollowProvenHistory, proveQuantityHollowRecord } from './central-hollow-proof'
import { QUANTITY_HOLLOW_TABLES } from './central-hollow-schema'
import { hollowMigrationInvalid, hollowRowKey, parseQuantityHollowMigrationGraph, parseQuantityHollowOriginBody, quantityHollowHash } from './hollow-migration-graph'
import { quantityHollowBindingMapper, quantityHollowIdentityCollector } from './hollow-migration-mapping'

export interface QuantityHollowPackageProof {
  graph: QuantityHollowMigrationGraph
  origins: ReadonlyMap<string, { body: QuantityHollowOriginBody, binding: QuantityHollowOriginBinding, history: QuantityHollowProvenHistory }>
  histories: ReadonlyMap<string, QuantityHollowProvenHistory>
  terminals: ReadonlyMap<string, string>
}

/** 扁平依赖包逐原件证明；指纹保持原值，只有显式身份经有界投影组合。 */
export async function proveQuantityHollowMigrationGraph(value: unknown, projectId?: string): Promise<QuantityHollowPackageProof> {
  const graph = parseQuantityHollowMigrationGraph(value)
  const origins = new Map<string, { body: QuantityHollowOriginBody, binding: QuantityHollowOriginBinding, history: QuantityHollowProvenHistory }>()
  const children = new Set<string>()
  const physical = new Map(QUANTITY_HOLLOW_TABLES.flatMap(table => graph.tables[table].map(row => [hollowRowKey(table, row.id), row] as const)))
  while (origins.size < graph.origins.length) {
    const next = graph.origins.find(origin => !origins.has(origin.id) && (!parseQuantityHollowOriginBody(origin.bodyJson).base || origins.has(parseQuantityHollowOriginBody(origin.bodyJson).base!.originId)))
    if (!next)
      hollowMigrationInvalid('原件依赖无法按前驱顺序证明')
    if (await quantityHollowHash(next.bodyJson) !== next.id)
      hollowMigrationInvalid('原件正文摘要不一致')
    const body = parseQuantityHollowOriginBody(next.bodyJson)
    const binding = graph.bindings.find(binding => binding.originId === next.id)!
    if (QUANTITY_HOLLOW_TABLES.some(table => body.tables[table].some(row => (table === 'quantity_hollow_records' ? row.id : row.record_id) !== body.recordId)))
      hollowMigrationInvalid('原件片段夹带其他检查的行')
    let result
    if (body.base) {
      const parent = origins.get(body.base.originId)!
      if (children.has(body.base.originId) || parent.history.recordId !== body.base.recordId || parent.history.fact.proof.headLogId !== body.base.headLogId || parent.history.fact.proof.fingerprint !== body.base.fingerprint)
        hollowMigrationInvalid('续链必须引用唯一准确前缀末端，不能另接分叉')
      children.add(body.base.originId)
      const projected = quantityHollowBindingMapper(parent.binding).history(parent.history)
      const prefix = quantityHollowBindingMapper(binding, true).history(projected)
      if (prefix.recordId !== body.recordId || prefix.projectId !== body.projectId)
        hollowMigrationInvalid('续链映射指向另一原责任')
      result = await extendQuantityHollowProvenHistory(prefix, body.tables)
    }
    else {
      result = await proveQuantityHollowRecord({ projectId: body.projectId, recordId: body.recordId, tables: body.tables })
    }
    if (result.status !== 'proven')
      hollowMigrationInvalid(result.diagnostics.map(item => item.message).join('；'))
    const collector = quantityHollowIdentityCollector()
    collector.history(result.history)
    for (const table of QUANTITY_HOLLOW_TABLES) {
      for (const row of body.tables[table]) collector.row(table, row)
    }
    const expected = collector.identities()
    if (expected.length !== binding.identities.length || expected.some(entry => !binding.identities.some(item => entry.kind === 'row' ? item.kind === 'row' && item.table === entry.table && item.sourceId === entry.sourceId : item.kind === 'command' && hollowEqual(item.source, entry.source))))
      hollowMigrationInvalid('映射不是此原件及原前缀必需身份的完整闭包')
    const mapper = quantityHollowBindingMapper(binding)
    for (const table of QUANTITY_HOLLOW_TABLES) {
      for (const row of body.tables[table]) {
        const mapped = mapper.row(table, row)
        if (!hollowEqual(mapped, physical.get(hollowRowKey(table, mapped.id))))
          hollowMigrationInvalid('映射后的物理行与原件不一致')
      }
    }
    origins.set(next.id, { body, binding, history: result.history })
  }
  const histories = new Map<string, QuantityHollowProvenHistory>()
  const terminals = new Map<string, string>()
  for (const [originId, origin] of origins) {
    if (children.has(originId))
      continue
    const history = quantityHollowBindingMapper(origin.binding).history(origin.history)
    if (histories.has(history.recordId) || (projectId !== undefined && history.projectId !== projectId))
      hollowMigrationInvalid('同一根有多个末端或跨项目原件')
    histories.set(history.recordId, history)
    terminals.set(history.recordId, originId)
  }
  if (histories.size !== graph.tables.quantity_hollow_records.length || graph.tables.quantity_hollow_records.some(row => !histories.has(String(row.id))))
    hollowMigrationInvalid('原件根与当前检查集合不一致')
  return { graph, origins, histories, terminals }
}
