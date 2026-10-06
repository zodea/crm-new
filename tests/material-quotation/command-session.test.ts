import type { SQLInputValue } from 'node:sqlite'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { createFormCommandActions } from '~/lib/forms/command-session'
import { newQuotationDraft } from '~/lib/material-quotation/contract'
import { quotationUnknownProblem } from '~/lib/material-quotation/http-repository'
import { ensureMaterialQuotationSchema } from '~/lib/material-quotation/schema-upgrade'
import { createQuotationOwner } from '~/lib/material-quotation/sqlite-owner'

async function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON;CREATE TABLE file_refs(id TEXT PRIMARY KEY,owner_type TEXT,owner_id TEXT,file_name TEXT,file_path TEXT,file_size INTEGER,mime_type TEXT,category TEXT,uploader TEXT,uploaded_at TEXT,deleted_at TEXT);CREATE TABLE file_payloads(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),content BLOB,sha256 TEXT);')
  const storage = createDbCoordinator(async () => ({ async execute(sql, params) {
    if (params)
      db.prepare(sql).run(...params as SQLInputValue[])
    else
      db.exec(sql)
  }, async select<T>(sql: string, params: unknown[] = []) {
    return db.prepare(sql).all(...params as SQLInputValue[]) as T[]
  }, async close() {
    db.close()
  } }))
  await storage.withTransaction(ensureMaterialQuotationSchema)
  let actor = { workspaceId: 'session-workspace', actorId: 'session-owner', capabilities: ['material-quotation:read', 'material-quotation:write'] }
  const owner = createQuotationOwner({ ...storage, identity: actor, assertBusinessWrite() {
  } }, { payloadMode: 'central', references: async () => ({ projects: [], suppliers: [] }) })
  let failRead = false
  let loseResponse = false
  let writes = 0
  const repository = {
    context: () => owner.context(() => actor),
    loadForm: async (id: string) => {
      if (failRead)
        throw new Error('保存后读取暂不可用')
      const record = (await owner.read(() => actor)).records.find(record => record.id === id)!
      return { draft: { ...record.draft, id }, version: record.version, updatedAt: record.updatedAt, attachments: record.attachments, history: record.history }
    },
    execute: async (request: Parameters<typeof owner.execute>[0]) => {
      writes++
      const result = await owner.execute(request, () => actor)
      if (loseResponse)
        throw new Error('原提交结果未知')
      return result
    },
    resolve: (commandId: string) => owner.resolve(commandId, () => actor),
  }
  const remembered = new Map<string, string>()
  const actions = createFormCommandActions({ repository: () => repository, capability: 'material-quotation:write' as const, problemFromUnknown: quotationUnknownProblem, conflict: () => new Error('应核对版本'), recoveryStorage: () => ({ getItem: key => remembered.get(key) ?? null, setItem: (key, value) => {
    remembered.set(key, value)
  }, removeItem: (key) => {
    remembered.delete(key)
  } }) })
  const session = actions.createSession()
  await actions.hydrate(session, null)
  const draft = { ...newQuotationDraft(), partyName: '原文报价方', lines: [{ ...newQuotationDraft().lines[0]!, name: '材料', unit: '吨', unitPrice: 0, taxRate: null }] }
  return { storage, actions, session, draft, owner, remembered, writes: () => writes, failRead: (value: boolean) => {
    failRead = value
  }, loseResponse: (value: boolean) => {
    loseResponse = value
  }, changeIdentity: () => {
    actor = { ...actor, actorId: 'other-owner' }
  } }
}
it('未知提交保持原编号与输入，重复保存被阻止；原命令核对只读回同一记录且只写一次', async () => {
  const f = await setup()
  try {
    f.loseResponse(true)
    await expect(f.actions.saveForm(f.session, f.draft, 'save', {})).rejects.toThrow('结果未知')
    const key = f.session.pending!.id
    const input = JSON.stringify(f.draft)
    expect(f.remembered.size).toBe(1)
    await expect(f.actions.saveForm(f.session, f.draft, 'save', {})).rejects.toThrow('先核对原编号')
    f.draft.note = '提交之后的新输入'
    const result = await f.actions.recover(f.session)
    expect(result.outcome).toBe('applied')
    if (result.outcome !== 'applied')
      throw new Error('原命令必须已应用')
    expect(result.result.commandId).toBe(key)
    expect(result.form.draft.note).toBe('')
    expect(f.draft.note).toBe('提交之后的新输入')
    expect(JSON.parse(input).lines[0]).toMatchObject({ unitPrice: 0, taxRate: null })
    expect(f.writes()).toBe(1)
    expect(f.remembered.size).toBe(0)
  }
  finally {
    await f.storage.close()
  }
})
it('保存回执已知但读取失败不清输入/原件恢复编号，不再execute；权限身份切换不返回旧图', async () => {
  const f = await setup()
  try {
    f.failRead(true)
    await expect(f.actions.saveForm(f.session, f.draft, 'save', {})).rejects.toThrow('已保存待刷新')
    const original = f.session.pending!.id
    await expect(f.actions.recover(f.session)).rejects.toThrow('读取暂不可用')
    expect(f.session.pending!.id).toBe(original)
    expect(f.writes()).toBe(1)
    f.failRead(false)
    f.changeIdentity()
    await expect(f.actions.recover(f.session)).rejects.toThrow('权限')
    expect(f.session.pending!.id).toBe(original)
    expect(f.session.context).toBeNull()
    expect(f.remembered.size).toBe(1)
  }
  finally {
    await f.storage.close()
  }
})
