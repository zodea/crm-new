import type { SQLInputValue } from 'node:sqlite'
import type { BusinessSession } from '../../server/utils/business-session'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { decodeConstructionContractDraft } from '~/lib/construction-contract/command-validation'
import { adoptConstructionManagementFee, decodeConstructionManagementFee, emptyConstructionManagementFee } from '~/lib/construction-contract/management-fee'
import { ensureConstructionManagementFeeSchema, persistNativeConstructionManagementFee, readNativeConstructionManagementFee } from '~/lib/construction-contract/management-fee-storage'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { decodeMaterialContractDraft } from '~/lib/material-contract/command-validation'
import { createConstructionContractCommandTestInstance } from '../../server/utils/construction-contract-command-test-instance'
import { createMemoryDb } from '../helpers/memory-db'

const at = '2026-10-05T08:00:00.000Z'
const evidence = (version: string) => ({ version, adoptedAt: at, contractVersion: version, actorId: 'actor', commandId: `cmd-${version}` })
const actor: BusinessSession = { workspaceId: 'work', actorId: 'actor', capabilities: ['construction-contract:read', 'construction-contract:write'] }

describe('总合同管理费配置与真实成本独立', () => {
  it('空、明确零、金额和依据各自保存，旧请求不清空，当前采用和旧证据独立冻结', () => {
    const empty = emptyConstructionManagementFee()
    const zero = adoptConstructionManagementFee(empty, { managementFeeAmount: 0, managementFeeBasis: '主合同第八条：不记取' }, evidence('1'))
    const actual = adoptConstructionManagementFee(zero, { managementFeeAmount: 1200, managementFeeBasis: '主合同第八条修订' }, evidence('2'))
    const removed = adoptConstructionManagementFee(actual, { managementFeeAmount: null }, evidence('3'))
    expect(empty).toEqual({ amount: null, basis: '', version: null, history: [] })
    expect(zero).toMatchObject({ amount: 0, version: '1', history: [{ amount: 0, basis: '主合同第八条：不记取' }] })
    expect(actual.history.map(row => row.amount)).toEqual([0, 1200])
    expect(removed.amount).toBeNull()
    expect(removed.history.map(row => row.amount)).toEqual([0, 1200, null])
    expect(adoptConstructionManagementFee(actual, {}, evidence('4'))).toEqual(actual)
    expect(adoptConstructionManagementFee(actual, { managementFeeAmount: 1200, managementFeeBasis: actual.basis }, evidence('4'))).toEqual(actual)
    actual.history[0]!.basis = '调用者改写副本'
    expect(zero.history[0]!.basis).toBe('主合同第八条：不记取')
  })

  it('配置严格限定总合同，拒绝负值/非有限数、未知字段和篡改当前采用历史', () => {
    expect(decodeConstructionContractDraft({ managementFeeAmount: null, managementFeeBasis: '' })).toMatchObject({ managementFeeAmount: null })
    expect(() => decodeConstructionContractDraft({ managementFeeAmount: -1 })).toThrow()
    expect(() => decodeConstructionContractDraft({ managementFeeAmount: Number.NaN })).toThrow()
    expect(() => decodeConstructionContractDraft({ managementFeeRate: 0.05 })).toThrow()
    expect(() => decodeMaterialContractDraft({ managementFeeAmount: 0 })).toThrow('施工主合同')
    expect(() => decodeConstructionContractDraft({ isSupplement: true, managementFeeAmount: 0 })).toThrow('施工主合同')
    const current = adoptConstructionManagementFee(emptyConstructionManagementFee(), { managementFeeAmount: 0 }, evidence('1'))
    expect(() => decodeConstructionManagementFee({ ...current, amount: 1 })).toThrow()
    expect(() => decodeConstructionManagementFee({ ...current, history: [current.history[0], current.history[0]] })).toThrow()
    expect(() => decodeConstructionManagementFee({ ...current, extra: true })).toThrow()
  })

  it('原命令未知后核对回执只采用一次，旧版本不覆盖，配置变更不改主合同金额/原件', async () => {
    const owner = createConstructionContractCommandTestInstance({ createId: () => 'main', projects: [{ id: 'p', name: '项目', customerId: 'c' }], customers: [{ id: 'c', name: '客户' }], now: () => at })
    const command = { workspaceId: 'work', actorId: 'actor', commandId: 'original-command', requiredCapability: 'construction-contract:write' as const, action: 'save' as const, baseVersion: null, draft: { name: '总合同', projectId: 'p', customerId: 'c', content: '施工', signDate: '2026-10-05', amount: 5000, managementFeeAmount: 0, managementFeeBasis: '原件第八条' }, attachments: {} }
    const saved = await owner.execute(command, actor)
    expect(owner.resolve(command.commandId, actor)).toMatchObject({ outcome: 'applied', result: saved })
    expect(await owner.execute(command, actor)).toEqual(saved)
    expect(owner.rows()[0]!.managementFee!.history).toHaveLength(1)
    const edited = await owner.execute({ ...command, commandId: 'change-command', id: saved.id, baseVersion: saved.version, draft: { ...command.draft, managementFeeAmount: 1200, managementFeeBasis: '变更采用原件' } }, actor)
    expect(edited.version).toBe('2')
    await expect(owner.execute({ ...command, commandId: 'conflicting-command', id: saved.id, baseVersion: saved.version }, actor)).rejects.toThrow('其他操作更新')
    const preserved = await owner.execute({ ...command, commandId: 'old-client', id: saved.id, baseVersion: edited.version, draft: { name: '总合同', projectId: 'p', customerId: 'c', content: '施工', signDate: '2026-10-05', amount: 5000 } }, actor)
    expect(owner.rows()[0]).toMatchObject({ amount: 5000, receivedAmount: 0, managementFee: { amount: 1200, basis: '变更采用原件' } })
    expect(owner.rows()[0]!.managementFee!.history.map(row => [row.amount, row.contractVersion, row.commandId])).toEqual([[0, '1', 'original-command'], [1200, '2', 'change-command']])
    expect(owner.form(preserved.id, actor).draft.managementFeeAmount).toBe(1200)
    expect(() => owner.resolve(command.commandId, { ...actor, capabilities: [] })).toThrow('权限')
  })

  it('真实Native旧库升级可幂等重试，空/真零保全，冷重开和历史指针恢复不丢原件', async () => {
    let db = await createMemoryDb()
    try {
      await runMigrations(db, migrations.filter(row => row.version <= 56))
      await db.execute('INSERT INTO projects(id,name) VALUES (?,?)', ['p', '项目'])
      await db.execute('INSERT INTO contracts(id,name,kind,project_id,amount) VALUES (?,?,?,?,?)', ['old', '旧总合同', '施工', 'p', 0])
      await db.execute('INSERT INTO contracts(id,name,kind,project_id,amount) VALUES (?,?,?,?,?)', ['material', '供应商采购', '材采', 'p', 99])
      await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size) VALUES(?,?,?,?,?)', ['original', 'contract', 'old', '原件.txt', 1])
      await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(?,?,?)', ['original', 'base64', 'YQ=='])
      const contracts = await db.select('SELECT * FROM contracts ORDER BY id')
      const originals = await db.select('SELECT * FROM file_refs')
      await ensureConstructionManagementFeeSchema(db)
      await ensureConstructionManagementFeeSchema(db)
      expect(await db.select('SELECT * FROM file_refs')).toEqual(originals)
      expect((await db.select<Record<string, unknown>>('SELECT * FROM contracts ORDER BY id')).map(({ management_fee_amount, management_fee_basis, management_fee_version, ...old }) => old)).toEqual(contracts)
      expect(await readNativeConstructionManagementFee(db, 'old')).toEqual(emptyConstructionManagementFee())
      const zero = adoptConstructionManagementFee(emptyConstructionManagementFee(), { managementFeeAmount: 0, managementFeeBasis: '原总合同' }, evidence('1'))
      await persistNativeConstructionManagementFee(db, 'old', zero)
      const bytes = db.raw.export()
      db.close()
      db = await createMemoryDb(bytes)
      expect(await readNativeConstructionManagementFee(db, 'old')).toEqual(zero)
      const second = adoptConstructionManagementFee(zero, { managementFeeAmount: 999 }, evidence('2'))
      await persistNativeConstructionManagementFee(db, 'old', second)
      await db.execute('UPDATE contracts SET management_fee_amount=?,management_fee_basis=?,management_fee_version=? WHERE id=?', [0, zero.basis, zero.version, 'old'])
      const restored = await readNativeConstructionManagementFee(db, 'old')
      expect(restored.amount).toBe(0)
      expect(restored.history.map(row => row.amount)).toEqual([0, 999])
      await expect(db.execute('UPDATE construction_management_fee_history SET amount=123 WHERE version=?', ['1'])).rejects.toThrow('不能修改')
      await expect(db.execute('DELETE FROM construction_management_fee_history WHERE version=?', ['1'])).rejects.toThrow('不能删除')
      await expect(persistNativeConstructionManagementFee(db, 'old', { ...restored, history: restored.history.map(row => row.version === '2' ? { ...row, amount: 123 } : row) })).rejects.toThrow('采用证据不一致')
      expect(await db.select('SELECT amount FROM contracts WHERE id=?', ['old'])).toEqual([{ amount: 0 }])
      expect(await db.select('SELECT * FROM file_refs')).toEqual(originals)
      expect(await db.select('SELECT content FROM file_payloads')).toEqual([{ content: 'YQ==' }])
    }
    finally { db.close() }
  })

  it('磁盘升级完成而版本记账前冷断，重开57幂等补账，原配置/真实零/原件均可核验', async () => {
    const base = resolve('.tmp/a03-management-fee-tests')
    await mkdir(base, { recursive: true })
    const directory = await mkdtemp(join(base, 'cold-native-'))
    const path = join(directory, 'synthetic.sqlite')
    const original = await createMemoryDb()
    try {
      await runMigrations(original, migrations.filter(row => row.version <= 56))
      await original.execute('INSERT INTO contracts(id,name,kind,amount) VALUES (?,?,?,?)', ['original-main', '合成磁盘总合同', '施工', 0])
      await original.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size) VALUES(?,?,?,?,?)', ['file', 'contract', 'original-main', '证据.txt', 1])
      await original.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(?,?,?)', ['file', 'base64', 'YQ=='])
      await writeFile(path, original.raw.export())
    }
    finally { original.close() }
    let disk = new DatabaseSync(path)
    const driver = () => ({
      execute: async (sql: string, values: unknown[] = []) => {
        if (values.length)
          disk.prepare(sql).run(...values as SQLInputValue[])
        else disk.exec(sql)
      },
      select: async <T>(sql: string, values: unknown[] = []) => disk.prepare(sql).all(...values as SQLInputValue[]) as T[],
    })
    try {
      await ensureConstructionManagementFeeSchema(driver())
      const adopted = adoptConstructionManagementFee(emptyConstructionManagementFee(), { managementFeeAmount: 0, managementFeeBasis: '磁盘原件第八条' }, evidence('disk-version'))
      await persistNativeConstructionManagementFee(driver(), 'original-main', adopted)
      disk.close()
      disk = new DatabaseSync(path)
      await runMigrations(driver(), migrations.filter(row => row.version <= 57))
      expect(await readNativeConstructionManagementFee(driver(), 'original-main')).toEqual(adopted)
      expect(await driver().select('SELECT MAX(version) AS version FROM schema_migrations')).toEqual([{ version: 57 }])
      expect(await driver().select('SELECT amount,management_fee_amount FROM contracts')).toEqual([{ amount: 0, management_fee_amount: 0 }])
      expect(await driver().select('SELECT content FROM file_payloads')).toEqual([{ content: 'YQ==' }])
      expect(await driver().select('PRAGMA foreign_key_check')).toEqual([])
    }
    finally { disk.close() }
  })
})
