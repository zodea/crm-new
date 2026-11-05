import type { SupplierCredentialAction, SupplierCredentialCommand } from '~/lib/supplier/credential-contract'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { createSupplierCommandService } from '../../server/utils/supplier-command-service'
import { createSupplierCredentialService } from '../../server/utils/supplier-credential-service'

const session = { workspaceId: 'credential-workspace', actorId: 'credential-actor', capabilities: ['supplier:write', 'supplier:list:read', 'supplier-credential:read', 'supplier-credential:write', 'demo:read'] }
const pdf = Buffer.from('%PDF-1.7\nSynthetic credential\n%%EOF')
async function setup() {
  let clock = '2026-09-12T15:59:59.000Z'
  let sequence = 0
  const commands = createSupplierCommandService({ now: () => clock, createId: () => `supplier-${++sequence}` })
  const created = await commands.execute({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'supplier:write', commandId: 'create', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成分供方', supplierCategory: '其他', contact: '合成联系人', taxNo: 'TEST-TAX', uniqueCode: 'INTERNAL', externalRef: 'legacy-import' } }, session)
  const service = createSupplierCredentialService({ read: commands.readCredentialScope, transact: commands.transactCredentialScope }, { now: () => clock, createId: () => `credential-${++sequence}` })
  const read = () => service.read(created.id, 'real', session)
  const command = (action: SupplierCredentialAction): SupplierCredentialCommand => ({ ...action, commandId: `command-${++sequence}`, supplierId: created.id, origin: 'real', workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'supplier-credential:write', baseSupplierVersion: read().supplierVersion, baseCredentialVersion: read().credentialVersion })
  const execute = (action: SupplierCredentialAction) => service.execute(command(action), session)
  const upload = (category: '营业执照' | '法人身份证' | '银行账户资料' | '其他', expiresAt = '') => execute({ action: 'upload', draft: { category, validFrom: '', expiresAt, longTerm: false, fileName: '合成原件.pdf', mimeType: 'application/pdf', fileSize: pdf.length, payloadBase64: pdf.toString('base64') } })
  const complete = () => {
    upload('营业执照')
    upload('法人身份证')
    upload('银行账户资料')
  }
  const setClock = (value: string) => {
    clock = value
  }
  return { commands, service, created, read, command, execute, upload, complete, setClock }
}

describe('中央证照与主档同一事务旅程', () => {
  it('三类真实原件后只能待核验，人工凭证与主档回读一致；字节冷读一致', async () => {
    const state = await setup()
    expect(state.read().status).toBe('incomplete')
    state.complete()
    expect(state.read().status).toBe('reviewing')
    state.execute({ action: 'review', draft: { decision: 'qualified', note: '已核对' } })
    expect(state.read()).toMatchObject({ status: 'qualified', review: { actorId: session.actorId, decision: 'qualified' } })
    expect(state.commands.rows()[0]?.credentialStatus).toBe('qualified')
    const credential = state.read().credentials[0]!
    const file = state.service.file({ supplierId: state.created.id, credentialId: credential.id, fileId: credential.file!.id, origin: 'real' }, session)
    expect(file).toMatchObject({ state: 'available', payloadBase64: pdf.toString('base64') })
  })

  it('关键主档字段实际变化后重算待核验，普通编辑与重导保留历史但不复用旧核验资格', async () => {
    const state = await setup()
    state.complete()
    state.execute({ action: 'review', draft: { decision: 'qualified', note: '' } })
    const form = state.commands.form(state.created.id, session)
    await state.commands.execute({ id: state.created.id, workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'supplier:write', commandId: 'master-noncritical', baseVersion: form.version, action: 'save', attachments: {}, draft: { ...form.draft, laborScope: '安装', note: '普通备注' } }, session)
    expect(state.read().status).toBe('qualified')
    const draft = { name: '更正工商名称', externalRef: 'legacy-import' }
    const preview = state.commands.previewImport([draft], session)[0]!
    const target = preview.candidates.find(value => value.id === state.created.id)!
    await state.commands.importRow({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'supplier:write', commandId: 'import-critical', draft, decision: { kind: 'replace', fingerprint: preview.fingerprint, id: target.id, version: target.version } }, session)
    expect(state.read()).toMatchObject({ status: 'reviewing', reviewCurrent: false, review: { decision: 'qualified' }, reviewHistory: [{ decision: 'qualified' }] })
    expect(state.commands.rows()[0]?.credentialStatus).toBe('reviewing')
  })

  it('原件、要求或主档版本并发变化时拒绝旧核验，且失败不留下半份文件', async () => {
    const state = await setup()
    state.complete()
    const stale = state.command({ action: 'review', draft: { decision: 'qualified', note: '' } })
    state.upload('其他')
    expect(() => state.service.execute(stale, session)).toThrow(/变化/)
    const count = state.read().credentials.length
    expect(() => state.execute({ action: 'upload', draft: { category: '营业执照', validFrom: '', expiresAt: '', longTerm: false, fileName: 'wrong.png', mimeType: 'image/png', fileSize: pdf.length, payloadBase64: pdf.toString('base64') } })).toThrow(/签名/)
    expect(state.read().credentials).toHaveLength(count)
    expect(state.read().status).toBe('reviewing')
  })

  it('可选资料与要求原因更正不撤销合格，必需类别/要求实际变化撤销', async () => {
    const state = await setup()
    state.complete()
    state.execute({ action: 'review', draft: { decision: 'qualified', note: '' } })
    state.upload('其他')
    state.execute({ action: 'requirement', draft: { category: '其他', requirement: 'optional', reason: '补充材料' } })
    expect(state.read().status).toBe('qualified')
    state.execute({ action: 'requirement', draft: { category: '其他', requirement: 'required', reason: '当前合同明确要求' } })
    expect(state.read()).toMatchObject({ status: 'reviewing', reviewCurrent: false, review: { decision: 'qualified' } })
  })

  it('固定必需不可降级，条件资料设为必需才要求原因；仅原因更正保留人工结论', async () => {
    const state = await setup()
    expect(() => state.execute({ action: 'requirement', draft: { category: '营业执照', requirement: 'optional', reason: '不能绕过固定要求' } })).toThrow('固定必需资料，不能降级')
    expect(() => state.execute({ action: 'requirement', draft: { category: '资质证书', requirement: 'required', reason: '' } })).toThrow('请说明当前项目或合同要求提供这项条件资料的原因')
    state.execute({ action: 'requirement', draft: { category: '资质证书', requirement: 'optional', reason: '' } })
    state.complete()
    state.execute({ action: 'review', draft: { decision: 'qualified', note: '' } })
    state.execute({ action: 'requirement', draft: { category: '资质证书', requirement: 'optional', reason: '补充描述' } })
    expect(state.read().status).toBe('qualified')
  })

  it('按上海日只读计算到期次日当前状态，人工历史、版本、原件和审计不随读取改变', async () => {
    const state = await setup()
    state.upload('营业执照', '2026-09-12')
    state.upload('法人身份证')
    state.upload('银行账户资料')
    state.execute({ action: 'review', draft: { decision: 'qualified', note: '' } })
    expect(state.read().status).toBe('qualified')
    const before = state.commands.snapshot()
    const sourceBefore = state.commands.sourceVersion()
    expect(state.commands.sourceVersion()).toBe(sourceBefore)
    state.setClock('2026-09-12T16:00:00.000Z')
    const sourceAfter = state.commands.sourceVersion()
    expect(sourceAfter).not.toBe(sourceBefore)
    expect(sourceBefore).toContain('2026-09-12')
    expect(sourceAfter).toContain('2026-09-13')
    expect(state.commands.sourceVersion()).toBe(sourceAfter)
    expect(state.commands.rows()[0]?.credentialStatus).toBe('incomplete')
    expect(state.read()).toMatchObject({ status: 'incomplete', reviewCurrent: false, review: { decision: 'qualified' }, businessDate: '2026-09-13' })
    expect(state.read().credentials[0]?.validity).toMatchObject({ state: 'expired', reason: 'expired' })
    state.commands.form(state.created.id, session)
    state.read()
    expect(state.commands.snapshot()).toEqual(before)
  })

  it('同类另一原件仍有效时，新过期使旧凭证不适用；新核验不受历史过期件反复影响', async () => {
    const state = await setup()
    state.upload('营业执照', '2026-09-12')
    state.upload('营业执照', '2027-09-12')
    state.upload('法人身份证')
    state.upload('银行账户资料')
    state.upload('其他', '2026-09-12')
    state.execute({ action: 'review', draft: { decision: 'qualified', note: '' } })
    state.setClock('2026-09-12T16:00:00.000Z')
    expect(state.commands.rows()[0]?.credentialStatus).toBe('reviewing')
    expect(state.read()).toMatchObject({ reviewCurrent: false, review: { decision: 'qualified' } })
    state.execute({ action: 'review', draft: { decision: 'qualified', note: '核验了当前仍有效原件' } })
    expect(state.read().status).toBe('qualified')
    expect(state.read().reviewHistory).toHaveLength(2)
    state.setClock('2026-09-13T16:00:00.000Z')
    expect(state.read().status).toBe('qualified')
  })

  it('仅可选原件新过期不影响已有人工核验', async () => {
    const state = await setup()
    state.complete()
    state.upload('其他', '2026-09-12')
    state.execute({ action: 'review', draft: { decision: 'qualified', note: '' } })
    state.setClock('2026-09-12T16:00:00.000Z')
    expect(state.read().status).toBe('qualified')
  })

  it('删除原件不可读，撤回恢复同一字节；第二次删除拒绝旧撤回审计', async () => {
    const state = await setup()
    state.complete()
    const credential = state.read().credentials[0]!
    const query = { supplierId: state.created.id, credentialId: credential.id, fileId: credential.file!.id, origin: 'real' as const }
    const deletion = state.execute({ action: 'delete', credentialId: credential.id })
    expect(() => state.service.file(query, session)).toThrow(/有效证照/)
    state.execute({ action: 'restore', credentialId: credential.id, auditId: deletion.auditId!, deletionToken: deletion.deletionToken! })
    expect(state.service.file(query, session)).toMatchObject({ state: 'available', payloadBase64: pdf.toString('base64') })
    state.execute({ action: 'delete', credentialId: credential.id })
    expect(() => state.execute({ action: 'restore', credentialId: credential.id, auditId: deletion.auditId!, deletionToken: deletion.deletionToken! })).toThrow(/失效/)
    expect(state.read().status).toBe('incomplete')
  })

  it('响应丢失同命令只保存一次，同键不同正文和伪身份都拒绝', async () => {
    const state = await setup()
    const action = state.command({ action: 'upload', draft: { category: '营业执照', validFrom: '', expiresAt: '', longTerm: false, fileName: 'one.pdf', mimeType: 'application/pdf', fileSize: pdf.length, payloadBase64: pdf.toString('base64') } })
    expect(state.service.execute(action, session)).toEqual(state.service.execute(action, session))
    expect(state.read().credentials).toHaveLength(1)
    expect(() => state.service.execute({ ...action, draft: { ...action.draft, fileName: 'different.pdf' } } as SupplierCredentialCommand, session)).toThrow(/其他内容/)
    expect(() => state.service.execute({ ...action, actorId: 'forged' }, session)).toThrow(/当前会话/)
    expect(() => state.service.execute({ ...action, origin: 'demo' }, session)).toThrow(/当前会话/)
  })

  it('当前权限和稳定原件归属重新校验；审计不复制核验备注和文件正文', async () => {
    const state = await setup()
    state.complete()
    state.execute({ action: 'review', draft: { decision: 'rejected', note: '审计不可复制的业务退回正文' } })
    const snapshot = state.read()
    const row = snapshot.credentials[0]!
    const query = { supplierId: state.created.id, credentialId: row.id, fileId: row.file!.id, origin: 'real' as const }
    expect(() => state.service.read(state.created.id, 'real', { ...session, capabilities: ['supplier:list:read'] })).toThrow(/权限/)
    expect(() => state.service.file(query, { ...session, capabilities: ['supplier-credential:read'] })).toThrow(/权限/)
    expect(() => state.service.file({ ...query, supplierId: 'same-name-other-id' }, session)).toThrow(/不存在/)
    expect(() => state.service.file({ ...query, credentialId: snapshot.credentials[1]!.id }, session)).toThrow(/归属/)
    expect(JSON.stringify(snapshot.audits)).not.toContain('审计不可复制的业务退回正文')
    expect(JSON.stringify(snapshot.audits)).not.toContain(pdf.toString('base64'))
  })
})
