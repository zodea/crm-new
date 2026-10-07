import { expect, it } from 'vitest'
import { decodePayrollNumberingRead, encodePayrollNumberingRead } from '../../app/lib/payroll/central-numbering-codec'
import { payrollAMigrationReferences } from '../../server/utils/payroll-a-migration-references'
import { payrollIndependentReferenceReader } from '../../server/utils/payroll-central-migration'
import { loadPayrollMigratedProof } from '../../server/utils/payroll-migrated-proof'
import { payrollNumberingMigrationReferences } from '../../server/utils/payroll-numbering-migration'
import { createReleasedPayrollHollowMigrationFixture, importPayrollHollowFixture } from '../helpers/payroll-hollow-migration-fixture'
import { numberingCommand } from '../helpers/payroll-numbering-fixture'
import { cloneQuantityHollowSnapshot } from '../helpers/quantity-hollow-migration-fixture'

it('迁入 A 冻结工资正式出具后连续两次完整迁入，保留原号/原件hash并恢复日常原号输出', async () => {
  const f = await createReleasedPayrollHollowMigrationFixture()
  try {
    const read = () => f.service.numbering({ origin: 'real' }, { projectId: f.scope.projectId, statementId: f.statementId })
    await f.service.executeNumbering(numberingCommand(await read(), 'first-mapped-start', { kind: 'initialize', nextNumber: 501, evidenceNote: '人工核实纸质旧号至500' }))
    const issued = await f.service.executeNumbering(numberingCommand(await read(), 'first-mapped-number', { kind: 'issue' }))
    expect((await read()).document?.actualAmount).toBe(550)
    const clone = await cloneQuantityHollowSnapshot(await f.instance.exportSnapshotBytes())
    try {
      const second = await importPayrollHollowFixture(clone, f.identities)
      try {
        const secondInput = { projectId: second.scope.projectId, statementId: second.id('wage_statements', f.statementId) }
        const readSecond = () => second.service.numbering({ origin: 'real' }, secondInput)
        expect(await readSecond()).toMatchObject({ issue: { number: '501', documentHash: issued.issue!.documentHash }, settings: { nextNumber: 502 }, document: { actualAmount: 550 }, eligibility: { canDownload: true } })
        await second.service.executeNumbering(numberingCommand(await readSecond(), 'second-mapped-redownload', { kind: 'issue' }))
        const thirdSource = await cloneQuantityHollowSnapshot(await second.instance.exportSnapshotBytes())
        try {
          const third = await importPayrollHollowFixture(thirdSource, second.identities)
          try {
            const thirdInput = { projectId: third.scope.projectId, statementId: third.id('wage_statements', secondInput.statementId) }
            const thirdRead = await third.service.numbering({ origin: 'real' }, thirdInput)
            expect(thirdRead).toMatchObject({ issue: { number: '501', documentHash: issued.issue!.documentHash }, settings: { nextNumber: 502 }, document: { actualAmount: 550 }, eligibility: { canDownload: true } })
            expect(decodePayrollNumberingRead(encodePayrollNumberingRead(thirdRead), { origin: 'real' }, thirdInput)).toEqual(thirdRead)
            await third.instance.withWorkspaceTransaction(async (tx) => {
              const proof = await loadPayrollMigratedProof(tx, thirdInput.projectId)
              const inherited = new Set([...proof.numbering.receipts].map(id => JSON.stringify(['payroll_command_receipts', id])))
              // 原 JSON 和已映射 SQL 身份不能按本代命令直读；只有完整原图证明能授权绕过重复解析。
              const rows = await tx.select<Record<string, unknown>>('SELECT * FROM payroll_command_receipts WHERE action LIKE \'numbering-%\'')
              const onlyNumbering = { execute: tx.execute.bind(tx), select: async <T>(sql: string): Promise<T[]> => /FROM payroll_command_receipts\b/.test(sql) ? rows as T[] : [] }
              await expect(payrollAMigrationReferences(onlyNumbering)).rejects.toThrow('原编号回执或身份损坏，请核对原提交，不能重新占号')
              await expect(payrollAMigrationReferences(payrollIndependentReferenceReader(onlyNumbering, inherited))).resolves.toEqual(new Set())
              const references = await payrollNumberingMigrationReferences(tx, proof.numbering.receipts)
              expect(references.has(JSON.stringify(['projects', thirdInput.projectId]))).toBe(true)
              expect(references.has(JSON.stringify(['wage_statements', thirdInput.statementId]))).toBe(true)
            })
            await third.instance.withWorkspaceTransaction(tx => tx.execute('UPDATE payroll_official_issues SET document_hash=? WHERE statement_id=?', ['f'.repeat(64), thirdInput.statementId]))
            await expect(third.reloadPayroll().numbering({ origin: 'real' }, thirdInput)).rejects.toThrow(/^迁入工资 payroll_official_issues\/\S+ 的原行或证据已缺损，不能继续计算剩余$/)
          }
          finally { await third.close() }
        }
        finally { thirdSource.close() }
      }
      finally { await second.close() }
    }
    finally { clone.close() }
  }
  finally { await f.close() }
}, 60_000)
