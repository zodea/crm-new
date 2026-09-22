import type { SoftDb } from '../db/soft-delete'
import type { PayrollIdentityMapping, PayrollJsonObject } from '../payroll/central-contract'
import type { PayrollProjectGraph } from './payroll-source'
import { PAYROLL_A_FEES_MIGRATION_TABLES } from '../payroll/central-a-fees-schema'
import { PAYROLL_HOLLOW_DEDUCTION_TABLES } from '../payroll/central-hollow-deduction-schema'
import { QUANTITY_HOLLOW_TABLES } from '../quantity/central-hollow-schema'
import { hollowExact, quantityHollowHash } from '../quantity/hollow-migration-graph'
import { QUANTITY_MIGRATION_TABLES } from '../quantity/migration-graph'
import { PAYROLL_CENTRAL_MIGRATION_TABLES } from './payroll-central-source'
import { parsePayrollProjectGraph, PAYROLL_MIGRATION_TABLES } from './payroll-source'

export interface PayrollProofBinding extends PayrollJsonObject {
  originId: string
  entityId: string
  mappings: Array<PayrollIdentityMapping & PayrollJsonObject>
}
export interface PayrollProofNode extends PayrollJsonObject {
  id: string
  graphJson: string
  parents: PayrollProofBinding[]
}
export interface PayrollProofPackage extends PayrollJsonObject {
  schemaVersion: 1
  nodes: PayrollProofNode[]
  bindings: PayrollProofBinding[]
}
function invalid(): never {
  throw new Error('工资迁移：原图依赖包不是封闭、无环且完整的身份关系')
}
function bindings(value: unknown): PayrollProofBinding[] {
  if (!Array.isArray(value))
    invalid()
  const ids = new Set<string>()
  const tables = new Set<string>(['projects', 'crews', 'workers', ...QUANTITY_MIGRATION_TABLES, ...QUANTITY_HOLLOW_TABLES, ...Object.values(PAYROLL_MIGRATION_TABLES), ...PAYROLL_CENTRAL_MIGRATION_TABLES, ...PAYROLL_A_FEES_MIGRATION_TABLES, ...PAYROLL_HOLLOW_DEDUCTION_TABLES, 'payroll_hollow_policies', 'quantity_hollow_commands'])
  return value.map((row) => {
    if (!hollowExact(row, ['originId', 'entityId', 'mappings']) || typeof row.originId !== 'string' || !/^[a-f0-9]{64}$/.test(row.originId) || typeof row.entityId !== 'string' || !row.entityId || ids.has(row.entityId) || !Array.isArray(row.mappings))
      invalid()
    ids.add(row.entityId)
    const keys = new Set<string>()
    const mappings = row.mappings.map((entry) => {
      if (!hollowExact(entry, ['tableName', 'legacyId', 'centralId']) || typeof entry.tableName !== 'string' || !tables.has(entry.tableName) || typeof entry.legacyId !== 'string' || !entry.legacyId || (entry.centralId !== null && (typeof entry.centralId !== 'string' || !entry.centralId)))
        invalid()
      const key = JSON.stringify([entry.tableName, entry.legacyId])
      if (keys.has(key))
        invalid()
      keys.add(key)
      return entry as PayrollIdentityMapping & PayrollJsonObject
    })
    return { originId: row.originId, entityId: row.entityId, mappings }
  })
}
export function parsePayrollProofPackage(value: unknown): PayrollProofPackage {
  if (!hollowExact(value, ['schemaVersion', 'nodes', 'bindings']) || value.schemaVersion !== 1 || !Array.isArray(value.nodes) || value.nodes.length > 64)
    invalid()
  const nodes = value.nodes.map((row) => {
    if (!hollowExact(row, ['id', 'graphJson', 'parents']) || typeof row.id !== 'string' || !/^[a-f0-9]{64}$/.test(row.id) || typeof row.graphJson !== 'string')
      invalid()
    const graph = JSON.parse(row.graphJson) as PayrollProjectGraph
    if (!graph || typeof graph !== 'object' || graph.deductions?.proof !== undefined)
      invalid()
    return { id: row.id, graphJson: row.graphJson, parents: bindings(row.parents) }
  })
  const rootBindings = bindings(value.bindings)
  const indexed = new Map(nodes.map(node => [node.id, node]))
  if (indexed.size !== nodes.length)
    invalid()
  const visited = new Set<string>()
  const active = new Set<string>()
  function visit(id: string) {
    if (active.has(id))
      invalid()
    if (visited.has(id))
      return
    const node = indexed.get(id)
    if (!node)
      invalid()
    active.add(id)
    node.parents.forEach(parent => visit(parent.originId))
    active.delete(id)
    visited.add(id)
  }
  rootBindings.forEach(binding => visit(binding.originId))
  if (visited.size !== nodes.length)
    invalid()
  return { schemaVersion: 1, nodes, bindings: rootBindings }
}
export async function verifyPayrollProofPackage(value: PayrollProofPackage) {
  const proof = parsePayrollProofPackage(value)
  for (const node of proof.nodes) {
    if (node.id !== await quantityHollowHash(JSON.stringify([node.graphJson, node.parents])))
      invalid()
    parsePayrollProjectGraph(JSON.parse(node.graphJson))
  }
  return proof
}

/** 工资领域原图按节点共享；原行 JSON 文本不改，技术依赖只保节点引用。 */
export async function readPayrollProofPackages(db: Pick<SoftDb, 'select'>): Promise<Map<string, PayrollProofPackage>> {
  const result = new Map<string, PayrollProofPackage>()
  if (!(await db.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payroll_migration_evidence\'')).length)
    return result
  const rows = await db.select<{ entity_id: string, project_id: string, source_graph_json: string, mapping_json: string }>('SELECT entity_id,project_id,source_graph_json,mapping_json FROM payroll_migration_evidence ORDER BY entity_id')
  for (const row of rows) {
    const graph = JSON.parse(row.source_graph_json) as PayrollProjectGraph
    const ancestors = graph.deductions?.proof ? await verifyPayrollProofPackage(graph.deductions.proof) : { schemaVersion: 1 as const, nodes: [], bindings: [] }
    if (graph.deductions)
      delete graph.deductions.proof
    const graphJson = JSON.stringify(graph)
    const node = { id: await quantityHollowHash(JSON.stringify([graphJson, ancestors.bindings])), graphJson, parents: ancestors.bindings }
    const current = result.get(row.project_id) ?? { schemaVersion: 1 as const, nodes: [], bindings: [] }
    const nodes = new Map([...current.nodes, ...ancestors.nodes, node].map(node => [node.id, node]))
    result.set(row.project_id, await verifyPayrollProofPackage({ schemaVersion: 1, nodes: [...nodes.values()], bindings: [...current.bindings, { originId: node.id, entityId: row.entity_id, mappings: JSON.parse(row.mapping_json) }] }))
  }
  return result
}

export function payrollProofAncestorGraph(proof: PayrollProofPackage, originId: string): PayrollProjectGraph {
  const indexed = new Map(proof.nodes.map(node => [node.id, node]))
  const node = indexed.get(originId)
  if (!node)
    invalid()
  const graph = JSON.parse(node.graphJson) as PayrollProjectGraph
  const reachable = new Set<string>()
  function visit(id: string) {
    if (reachable.has(id))
      return
    reachable.add(id)
    indexed.get(id)!.parents.forEach(parent => visit(parent.originId))
  }
  node.parents.forEach(parent => visit(parent.originId))
  if (node.parents.length) {
    if (!graph.deductions)
      invalid()
    graph.deductions.proof = { schemaVersion: 1, nodes: proof.nodes.filter(node => reachable.has(node.id)), bindings: node.parents }
  }
  return graph
}

/** 命令仍保最初 raw 回执；日志身份只沿拥有该命令的明确祖先边逐层映射。 */
export function payrollProofReceiptLogIds(graph: PayrollProjectGraph, commandId: string, resultJson: string): string[] {
  const raw = JSON.parse(resultJson) as { logIds?: unknown }
  if (!Array.isArray(raw.logIds) || raw.logIds.some(id => typeof id !== 'string') || new Set(raw.logIds).size !== raw.logIds.length)
    invalid()
  const proof = graph.deductions?.proof
  const indexed = new Map(proof?.nodes.map(node => [node.id, node]))
  const project = (bindings: PayrollProofBinding[], commandId: string, active: Set<string>): string[] => {
    const owners = bindings.filter(binding => binding.mappings.some(row => row.tableName === 'payroll_command_receipts' && row.centralId === commandId))
    if (!owners.length)
      return raw.logIds as string[]
    if (owners.length !== 1)
      invalid()
    const binding = owners[0]!
    const sourceId = binding.mappings.find(row => row.tableName === 'payroll_command_receipts' && row.centralId === commandId)!.legacyId
    const node = indexed.get(binding.originId)
    if (!node || active.has(node.id))
      invalid()
    const source = JSON.parse(node.graphJson) as PayrollProjectGraph
    if (source.central?.tables.payroll_command_receipts.find(row => row.command_id === sourceId)?.result_json !== resultJson)
      invalid()
    const next = new Set(active).add(node.id)
    return project(node.parents, sourceId, next).map((id) => {
      const mapped = binding.mappings.find(row => row.tableName === 'operation_logs' && row.legacyId === id)?.centralId
      if (!mapped)
        invalid()
      return mapped
    })
  }
  return project(proof?.bindings ?? [], commandId, new Set())
}
