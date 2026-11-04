import type { BusinessSession } from '../../server/utils/business-session'
import type { ProductionStorage } from '../../server/utils/production-storage'
import { expect } from 'vitest'
import { validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { financeCommandFingerprint } from '../../server/utils/production-finance-request'

/** 模拟复制出的合成库两侧证据缺损；异常回滚使夹具和不可变触发器保持原状。 */
export async function expectFinanceEvidenceDamageRejected(storage: ProductionStorage, actor: BusinessSession, target: { kind: string, id: string, version: string, commandId: string, field: string, digest: string, mode?: 'empty' }) {
  const rollback = new Error('rollback synthetic evidence damage')
  await expect(storage.withTransaction(async (tx) => {
    const [trigger] = await tx.select<{ sql: string }>('SELECT sql FROM sqlite_schema WHERE type=\'trigger\' AND name=\'finance_history_no_update\'')
    const [history] = await tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=? AND id=? AND version=?', [target.kind, target.id, Number(target.version)])
    const [command] = await tx.select<{ result_json: string }>('SELECT result_json FROM finance_commands WHERE command_id=?', [target.commandId])
    expect(trigger?.sql).toBeTruthy()
    expect(history?.snapshot_json).toBeTruthy()
    expect(command?.result_json).toBeTruthy()
    const snapshot = JSON.parse(history!.snapshot_json)
    const receipt = JSON.parse(command!.result_json)
    expect(Object.hasOwn(snapshot, target.field)).toBe(true)
    expect(Object.hasOwn(receipt, target.digest)).toBe(true)
    if (target.mode === 'empty') {
      snapshot[target.field] = []
      receipt[target.digest] = financeCommandFingerprint([])
    }
    else {
      delete snapshot[target.field]
      delete receipt[target.digest]
    }
    await tx.execute('DROP TRIGGER finance_history_no_update')
    await tx.execute('UPDATE finance_history SET snapshot_json=? WHERE kind=? AND id=? AND version=?', [JSON.stringify(snapshot), target.kind, target.id, Number(target.version)])
    await tx.execute('UPDATE finance_commands SET result_json=? WHERE command_id=?', [JSON.stringify(receipt), target.commandId])
    await tx.execute(trigger!.sql)
    await expect(validateFinanceJournal(tx, actor)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    throw rollback
  })).rejects.toBe(rollback)
  await expect(validateFinanceJournal(storage, actor)).resolves.toBeDefined()
}

export async function expectFinanceCoverageMissingRejected(storage: ProductionStorage, actor: BusinessSession, target: { id: string, version: string }) {
  const rollback = new Error('rollback synthetic coverage damage')
  await expect(storage.withTransaction(async (tx) => {
    const [trigger] = await tx.select<{ sql: string }>('SELECT sql FROM sqlite_schema WHERE type=\'trigger\' AND name=\'finance_payment_invoice_coverage_no_delete\'')
    expect(trigger?.sql).toBeTruthy()
    await tx.execute('DROP TRIGGER finance_payment_invoice_coverage_no_delete')
    await tx.execute('DELETE FROM finance_payment_invoice_coverage WHERE record_id=? AND version=?', [target.id, Number(target.version)])
    await tx.execute(trigger!.sql)
    await expect(validateFinanceJournal(tx, actor)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    throw rollback
  })).rejects.toBe(rollback)
  await expect(validateFinanceJournal(storage, actor)).resolves.toBeDefined()
}
