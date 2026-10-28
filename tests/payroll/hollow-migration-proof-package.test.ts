import { afterAll, beforeAll, expect, it } from 'vitest'
import { parsePayrollProofPackage, readPayrollProofPackages, verifyPayrollProofPackage } from '../../app/lib/migration/payroll-proof-package'
import { createReleasedPayrollHollowSource, importPayrollHollowFixture } from '../helpers/payroll-hollow-migration-fixture'
import { cloneQuantityHollowSnapshot } from '../helpers/quantity-hollow-migration-fixture'

// 原库只造一次；每案克隆原库后各自真实迁入。
let source: Awaited<ReturnType<typeof createReleasedPayrollHollowSource>>
beforeAll(async () => {
  source = await createReleasedPayrollHollowSource()
})
afterAll(() => source?.close())

it('真实工资原图包只接受完整可达祖先、原字节摘要和明确表映射', async () => {
  const f = await source.migrate()
  try {
    const proof = (await f.instance.withWorkspaceTransaction(tx => readPayrollProofPackages(tx))).get(f.scope.projectId)!
    expect(await verifyPayrollProofPackage(proof)).toEqual(proof)
    expect(proof.nodes).toHaveLength(1)
    const missing = structuredClone(proof)
    missing.nodes = []
    expect(() => parsePayrollProofPackage(missing)).toThrow('工资迁移：原图依赖包不是封闭、无环且完整的身份关系')
    const extra = structuredClone(proof)
    extra.bindings = []
    expect(() => parsePayrollProofPackage(extra)).toThrow('工资迁移：原图依赖包不是封闭、无环且完整的身份关系')
    const body = structuredClone(proof)
    body.nodes[0]!.graphJson += ' '
    await expect(verifyPayrollProofPackage(body)).rejects.toThrow('工资迁移：原图依赖包不是封闭、无环且完整的身份关系')
    const unknownTable = structuredClone(proof)
    unknownTable.bindings[0]!.mappings.push({ tableName: 'arbitrary_private_table', legacyId: 'one', centralId: 'two' })
    expect(() => parsePayrollProofPackage(unknownTable)).toThrow('工资迁移：原图依赖包不是封闭、无环且完整的身份关系')
  }
  finally { await f.close() }
}, 30_000)

it('再次公开迁入前祖先身份映射被换成另一记录时必须拒绝', async () => {
  const f = await source.migrate()
  try {
    const cloned = await cloneQuantityHollowSnapshot(await f.instance.exportSnapshotBytes())
    try {
      const [row] = await cloned.select<{ entity_id: string, mapping_json: string }>('SELECT entity_id,mapping_json FROM payroll_migration_evidence')
      const mappings = JSON.parse(row!.mapping_json) as Array<{ tableName: string, legacyId: string, centralId: string }>
      const adoption = mappings.find(value => value.tableName === 'payroll_hollow_adoptions')!
      adoption.centralId = `${adoption.centralId}-different-adoption`
      await cloned.execute('UPDATE payroll_migration_evidence SET mapping_json=? WHERE entity_id=?', [JSON.stringify(mappings), row!.entity_id])
      await expect(importPayrollHollowFixture(cloned, f.identities)).rejects.toThrow('迁入工资身份映射与原证据不一致')
    }
    finally { cloned.close() }
  }
  finally { await f.close() }
}, 30_000)
