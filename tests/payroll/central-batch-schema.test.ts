import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializePayrollARoundingSchema } from '../../app/lib/payroll/central-a-rounding-schema'
import { initializePayrollBatchSchema } from '../../app/lib/payroll/central-batch-schema'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb
beforeEach(async () => {
  db = await createMigratedMemoryDb()
  await db.execute('INSERT INTO projects(id,name) VALUES(\'p\',\'批次项目\')')
})
afterEach(() => db.close())

function insert(table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row)
  return db.execute(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, Object.values(row))
}
const plan = (patch: Record<string, unknown> = {}) => insert('payroll_batch_plans', { id: 'plan', workspace_id: 'w', actor_id: 'a', origin: 'real', project_id: 'p', month: '2026-08', purpose: 'release', schema_version: 1, plan_json: '{}', plan_hash: 'h', base_payroll_revision: 1, expected_payroll_revision: 1, state: 'ready', created_at: 't', confirmed_at: 't', ...patch })
const attempt = (n: number, patch: Record<string, unknown> = {}) => insert('payroll_batch_attempts', { id: `attempt-${n}`, plan_id: 'plan', item_id: `item-${n}`, attempt_no: 1, prepare_command_id: `prepare-${n}`, execute_command_id: `execute-${n}`, payroll_command_id: `payroll-${n}`, command_json: '{}', command_hash: 'h', execute_json: '{}', execute_hash: 'h', basis_hash: 'h', before_payroll_revision: 1, state: 'prepared', created_at: 't', ...patch })
const receipt = (patch: Record<string, unknown> = {}) => insert('payroll_batch_command_receipts', { command_id: 'confirm', workspace_id: 'w', actor_id: 'a', project_id: 'p', plan_id: 'plan', action: 'confirm-batch', command_json: '{}', fingerprint: 'f', result_json: '{}', created_at: 't', ...patch })

describe('中央工资批次协调表', () => {
  beforeEach(async () => {
    await initializePayrollBatchSchema(db)
  })

  it('同一计划同时只能有一个已准备尝试，前一个结束后才能准备下一项', async () => {
    await plan()
    await attempt(1)
    await expect(attempt(2)).rejects.toThrow('UNIQUE constraint failed: payroll_batch_attempts.plan_id')
    await db.execute('UPDATE payroll_batch_attempts SET state=\'checked\' WHERE id=\'attempt-1\'')
    await attempt(2)
    expect(await db.select('SELECT id FROM payroll_batch_attempts WHERE state=\'prepared\'')).toEqual([{ id: 'attempt-2' }])
  })

  it('原命令编号唯一，重复准备、执行或确认不会形成第二条记录', async () => {
    await plan()
    await attempt(1, { state: 'checked' })
    await expect(attempt(2, { prepare_command_id: 'prepare-1' })).rejects.toThrow('UNIQUE constraint failed: payroll_batch_attempts.prepare_command_id')
    await expect(attempt(2, { execute_command_id: 'execute-1' })).rejects.toThrow('UNIQUE constraint failed: payroll_batch_attempts.execute_command_id')
    await receipt()
    await expect(receipt({ fingerprint: 'other' })).rejects.toThrow('UNIQUE constraint failed: payroll_batch_command_receipts.command_id')
  })

  it('只接受真实来源的计划，不保存演示批次', async () => {
    await expect(plan({ origin: 'demo' })).rejects.toThrow('CHECK constraint failed')
    expect(await db.select('SELECT id FROM payroll_batch_plans')).toEqual([])
  })
})

describe('a 工资取整修订', () => {
  beforeEach(async () => {
    await initializePayrollARoundingSchema(db)
    await db.execute('INSERT INTO workers(id,name,created_at,updated_at) VALUES(\'w\',\'负责人\',\'t\',\'t\')')
  })
  const revision = (patch: Record<string, unknown> = {}) => insert('payroll_a_rounding_revisions', { id: 'r1', project_id: 'p', leader_worker_id: 'w', book_purpose: 'ordinary', management_book_id: null, effective_month: '2026-08', revision: 1, rule_json: '{}', operator_id: 'a', created_at: 't', ...patch })

  it('普通簿不能带管理簿编号，管理簿必须带管理簿编号', async () => {
    await expect(revision({ management_book_id: 'book' })).rejects.toThrow('CHECK constraint failed')
    await expect(revision({ book_purpose: 'management' })).rejects.toThrow('CHECK constraint failed')
    await revision({ book_purpose: 'management', management_book_id: 'book' })
  })

  it('同一负责人同一簿的修订号不能重复', async () => {
    await revision()
    await expect(revision({ id: 'r2' })).rejects.toThrow('UNIQUE constraint failed')
    await revision({ id: 'r3', revision: 2 })
  })
})
