import { mkdir, mkdtemp } from 'node:fs/promises'
import { afterAll, expect, it } from 'vitest'
import { commandRecoveryFormTarget } from '~/lib/forms/command-recovery'
import { createOurSignatoryRepository, decodeOurSignatoryList } from '~/lib/our-signatory/http-repository'
import { inspectRestorableTabPath } from '~/lib/tabs/restore-target'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

const draft = { name: '真实核实主体的合成样本', taxNo: null, registeredAddress: '原核实地址', legalRepresentative: null, verificationNote: '原文书依据', status: 'active' as const }
it('只登记真实设置/主档/报价原命令精确路由，恢复定位不开放写页签或正文持久化', () => {
  for (const [path, family] of [['/settings/our-signatories/form', 'our-signatory'], ['/base/crew/form', 'crew'], ['/base/worker/form', 'worker'], ['/material/quotations/form', 'material-quotation']]) {
    expect(commandRecoveryFormTarget(`${path}?origin=real`)).toEqual({ family, targetId: null })
    expect(commandRecoveryFormTarget(`${path}/record-123?origin=real`)).toEqual({ family, targetId: 'record-123' })
    expect(commandRecoveryFormTarget(`${path}/record-123?origin=demo`)).toBeNull()
    expect(commandRecoveryFormTarget(`${path}/evil%2fpath`)).toBeNull()
    expect(inspectRestorableTabPath(path!)).toBeNull()
  }
  expect(inspectRestorableTabPath('/settings/our-signatories')?.fullPath).toBe('/settings/our-signatories')
})
it('财务 F3 只恢复原实体表单编号，拒绝演示、重复来源和编码伪造，普通写页签仍不持久化', () => {
  for (const [section, family] of [['current', 'finance-current'], ['reimbursement', 'finance-reimbursement'], ['payment', 'finance-payment-application'], ['records', 'finance-payment-record'], ['billing', 'finance-invoice-application']]) {
    const path = `/finance/${section}`
    expect(commandRecoveryFormTarget(`${path}/new?origin=real`)).toEqual({ family, targetId: null })
    expect(commandRecoveryFormTarget(`${path}/record-123?origin=real`)).toEqual({ family, targetId: 'record-123' })
    expect(commandRecoveryFormTarget(`${path}/record-123?origin=demo`)).toBeNull()
    expect(commandRecoveryFormTarget(`${path}/record-123?origin=real&origin=real`)).toBeNull()
    expect(commandRecoveryFormTarget(`${path}/evil%2Fpath`)).toBeNull()
    expect(commandRecoveryFormTarget(`${path}/evil%3Fpath`)).toBeNull()
    expect(inspectRestorableTabPath(`${path}/new`)).toBeNull()
    expect(inspectRestorableTabPath(`${path}/record-123`)).toBeNull()
  }
  expect(commandRecoveryFormTarget('/finance/payment/record-123/detail')).toBeNull()
})
async function fixture() {
  const base = testTempRoot('a02-material-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/signatory-http-`)
  const storage = await createSeededProductionStorage({ directory, workspaceId: 'own-http-workspace', ownerId: 'own-http-owner', purpose: 'verification' })
  const actor = { workspaceId: 'own-http-workspace', actorId: 'own-http-owner', capabilities: ['our-signatory:read', 'our-signatory:write'] }
  const service = createProductionOurSignatoryService(storage)
  const request = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'our-signatory:write' as const, commandId: 'create-our-http', baseVersion: null, draft }
  const result = await service.execute(request, () => actor)
  return { storage, service, actor, request, result }
}
it('真实 owner 的目录、回执、原命令核对经严格 HTTP adapter 往返，失败提交不换原键', async () => {
  const f = await fixture()
  try {
    const repository = createOurSignatoryRepository(async (url, options) => {
      if (url === '/api/read/our-signatories')
        return f.service.list(() => f.actor)
      const body = (options as {
        body: unknown
      }).body
      if (url.endsWith('/resolve')) {
        return f.service.resolve((body as {
          commandId: string
        }).commandId, () => f.actor)
      }
      return f.service.execute(body, () => f.actor)
    })
    expect(await repository.context()).toEqual(f.actor)
    expect(await repository.loadForm(f.result.id)).toMatchObject({ version: '1', draft: { id: f.result.id, ...draft }, history: [{ version: '1', actorId: f.actor.actorId, commandId: 'create-our-http', draft }] })
    expect(await repository.resolve('create-our-http')).toEqual({ outcome: 'applied', result: { ...f.result, attachmentIds: [] } })
    expect(await repository.resolve('not-sent-http')).toEqual({ outcome: 'not-applied', commandId: 'not-sent-http' })
    await expect(repository.execute({ ...f.request, commandId: 'not-sent-http', action: 'save', attachments: {}, draft })).rejects.toThrow('封存')
    await expect(repository.execute({ ...f.request, action: 'save', attachments: {}, draft: { ...draft, name: '同键改正文' } })).rejects.toThrow('不同的完整请求')
    expect((await repository.list()).records[0]!.draft.name).toBe('真实核实主体的合成样本')
  }
  finally {
    await f.storage.close()
  }
})
it('目录读取拒绝脱离核实历史的当前值、重复身份和失配读取依据；权限失败保持401/403语义', async () => {
  const f = await fixture()
  try {
    const original = await f.service.list(() => f.actor)
    const damaged = (change: (value: typeof original) => void) => {
      const value = structuredClone(original)
      change(value)
      return value
    }
    for (const body of [
      damaged((value) => { value.records[0]!.draft.name = '无核实历史的名称' }),
      damaged((value) => { value.records[0]!.history = [] }),
      damaged((value) => { value.records.push(structuredClone(value.records[0]!)) }),
      damaged((value) => { value.asOf = '2026-01-01T00:00:00.000Z' }),
      damaged((value) => { value.meta.dataOrigin = 'demo' }),
      { ...original, actorId: '额外定位字段' },
    ])
      expect(() => decodeOurSignatoryList(body)).toThrow()
    for (const status of [401, 403]) {
      const repository = createOurSignatoryRepository(async () => {
        throw Object.assign(new Error('真实HTTP拒绝'), { status, data: { broken: true } })
      })
      await expect(repository.list()).rejects.toMatchObject({ problem: { code: status === 401 ? 'unauthenticated' : 'forbidden' } })
    }
    const malformed = createOurSignatoryRepository(async () => ({ ...f.result, commandId: 'other-original' }))
    await expect(malformed.resolve('create-our-http')).rejects.toThrow('原编号或回执')
    const wrongReceipt = createOurSignatoryRepository(async () => ({ outcome: 'applied', result: { ...f.result, commandId: 'other-original' } }))
    await expect(wrongReceipt.resolve('create-our-http')).rejects.toThrow('原编号或回执')
  }
  finally {
    await f.storage.close()
  }
})
