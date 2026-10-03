import type { SupplierCredentialCommand } from '../../app/lib/supplier/credential-contract'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'

const actor = { workspaceId: 'supplier-disk-test', actorId: 'synthetic-owner', capabilities: ['supplier:list:read', 'supplier:write', 'supplier-credential:read', 'supplier-credential:write'] }
const session = () => actor
const command = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'create-supplier', requiredCapability: 'supplier:write', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成分供方', supplierCategory: '其他', contact: '合成人', taxNo: 'SYNTHETIC-TAX', externalRef: 'synthetic-external-key' } }
async function setup() {
  const base = resolve('.codex-tmp/issue-453-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/storage-`)
  const options = { directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  const service = createProductionSupplierService(storage)
  const created = await service.execute(command, session)
  return { options, storage, service, created }
}
const bytes = Buffer.from('%PDF-1.7\nSynthetic supplier original\n%%EOF')
function upload(supplierId: string, supplierVersion: string, credentialVersion: string): SupplierCredentialCommand {
  return { workspaceId: actor.workspaceId, actorId: actor.actorId, origin: 'real', requiredCapability: 'supplier-credential:write', commandId: 'upload-credential', supplierId, baseSupplierVersion: supplierVersion, baseCredentialVersion: credentialVersion, action: 'upload', draft: { category: '营业执照', validFrom: '', expiresAt: '', longTerm: false, fileName: '合成原件.pdf', mimeType: 'application/pdf', fileSize: bytes.length, payloadBase64: bytes.toString('base64') } }
}

it('磁盘冷打开保留主档、原件、人工核验、原回执及导入指纹', async () => {
  const state = await setup()
  const request = upload(state.created.id, '1', '0')
  const uploaded = await state.service.executeCredential(request, session)
  const taxCommand = { workspaceId: actor.workspaceId, actorId: actor.actorId, origin: 'real' as const, requiredCapability: 'supplier:write' as const, commandId: 'verify-taxpayer', supplierId: state.created.id, baseSupplierVersion: uploaded.supplierVersion, expectedTaxNo: 'SYNTHETIC-TAX', draft: { status: 'not_found' as const, taxpayerType: '未核验', note: '合成核验备注' } }
  const verified = await state.service.recordTaxpayer(taxCommand, session)
  await state.storage.close()
  const reopened = createProductionStorage(state.options)
  const service = createProductionSupplierService(reopened)
  try {
    expect(await service.execute(command, session)).toEqual(state.created)
    expect(await service.executeCredential(request, session)).toEqual(uploaded)
    expect(await service.recordTaxpayer(taxCommand, session)).toEqual(verified)
    const read = await service.credentials(state.created.id, session)
    const original = read.credentials[0]!
    expect(read.supplierVersion).toBe(verified.supplierVersion)
    expect(await service.file({ supplierId: state.created.id, credentialId: original.id, fileId: original.file!.id, origin: 'real' }, session)).toMatchObject({ state: 'available', payloadBase64: bytes.toString('base64') })
    expect((await service.form(state.created.id, session)).draft).toMatchObject(verified.verification)
    const imported = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'supplier:write', commandId: 'import-supplier', draft: { name: '合成更新名称', externalRef: 'synthetic-external-key', note: '导入保留证照' } }
    const result = await service.importRow(imported, session)
    expect(result.id).toBe(state.created.id)
    await reopened.close()
    expect(await service.importRow(imported, session)).toEqual(result)
    expect((await service.rows(session)).rows).toHaveLength(1)
    await expect(service.execute({ ...command, draft: { ...command.draft, name: '不能改用原键' } }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(service.file({ supplierId: state.created.id, credentialId: original.id, fileId: original.file!.id, origin: 'real' }, () => ({ ...actor, capabilities: ['supplier:list:read'] }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally { await reopened.close() }
})

it('曾保存原件正文后来丢失时明确拒绝，不能冒充原始旧缺件', async () => {
  const state = await setup()
  try {
    await state.service.executeCredential(upload(state.created.id, '1', '0'), session)
    await state.storage.execute('DELETE FROM file_payloads')
    await state.storage.close()
    await expect(state.service.credentials(state.created.id, session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await state.storage.select('SELECT count(*) AS n FROM supplier_credentials')).toEqual([{ n: 1 }])
  }
  finally { await state.storage.close() }
})

it('未接管事实的数值筛选和排序明确不可用，不能把已存主档伪装为无匹配', async () => {
  const state = await setup()
  try {
    expect((await state.service.list({}, session)).items).toHaveLength(1)
    await expect(state.service.list({ columnFilters: { ranges: { projectCount: { min: 0 } } } }, session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(state.service.list({ sort: 'paymentAmount-desc' }, session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  }
  finally { await state.storage.close() }
})

it('原件保存前审计失败整体回滚，修复后同键可保存，陈旧或跨类原键不能覆盖', async () => {
  const state = await setup()
  try {
    await state.storage.execute('CREATE TRIGGER supplier_fail BEFORE INSERT ON supplier_credential_audits BEGIN SELECT RAISE(ABORT,\'synthetic-failure\'); END')
    const request = upload(state.created.id, '1', '0')
    await expect(state.service.executeCredential(request, session)).rejects.toThrow('synthetic-failure')
    expect(await state.storage.select('SELECT id FROM file_refs')).toEqual([])
    expect(await state.storage.select('SELECT id FROM supplier_credentials')).toEqual([])
    expect((await state.service.form(state.created.id, session)).version).toBe('1')
    await state.storage.execute('DROP TRIGGER supplier_fail')
    await state.service.executeCredential(request, session)
    await expect(state.service.executeCredential({ ...request, commandId: 'stale-upload' }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(state.service.execute({ ...command, commandId: 'upload-credential' }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await state.service.command('upload-credential', session)).toMatchObject({ outcome: 'applied', result: { supplierId: state.created.id } })
  }
  finally { await state.storage.close() }
})

const recognized = { engine: 'paddleocr-official-api' as const, model: 'PaddleOCR-VL-1.6' as const, jobId: 'synthetic-job', pages: [], markdownPages: ['营业执照\n统一社会信用代码：913100001234567890\n公司名称：识别公司'], dataInfo: {} }
it('oCR 原候选与人工值分别持久化，冷开重复原键不再调用识别', async () => {
  const state = await setup()
  try {
    const uploaded = await state.service.executeCredential(upload(state.created.id, '1', '0'), session)
    const current = await state.service.credentials(state.created.id, session)
    const command = { ...upload(state.created.id, uploaded.supplierVersion, uploaded.credentialVersion), commandId: 'recognize-original', action: 'ocr-recognize' as const, credentialId: current.credentials[0]!.id, options: {} }
    const recognize = vi.fn(async () => recognized)
    const receipt = await state.service.executeOcr(command, session, recognize)
    await state.storage.close()
    expect(await state.service.executeOcr(command, session, recognize)).toEqual(receipt)
    expect(recognize).toHaveBeenCalledTimes(1)
    const read = await state.service.credentials(state.created.id, session)
    const candidate = read.credentials[0]!.recognition!
    expect(candidate.result).toEqual(recognized)
    expect((await state.service.form(state.created.id, session)).draft.name).toBe('合成分供方')
    const confirmation = { ...command, commandId: 'confirm-original', action: 'ocr-confirm' as const, baseSupplierVersion: read.supplierVersion, baseCredentialVersion: read.credentialVersion, draft: { recognitionId: candidate.id, category: '营业执照' as const, longTerm: false, decisions: { category: 'keep-current' as const, longTerm: 'keep-current' as const }, choices: candidate.parsed.fields.map(field => field.key === 'name' ? { key: field.key, decision: 'manual' as const, manualValue: '人工核对公司' } : { key: field.key, decision: 'keep-current' as const }) } }
    const saved = await state.service.executeOcr(confirmation, session, recognize)
    await state.storage.close()
    expect(await state.service.executeOcr(confirmation, session, recognize)).toEqual(saved)
    expect((await state.service.form(state.created.id, session)).draft.name).toBe('人工核对公司')
    expect((await state.service.credentials(state.created.id, session)).credentials[0]).toMatchObject({ recognition: { result: recognized }, ocrReviewStatus: 'confirmed', ocrConfirmedResult: { fields: { name: '人工核对公司' } } })
  }
  finally { await state.storage.close() }
})

it('识别等待不锁正式主档，迟到结果在并发更正后拒绝，原件仍在', async () => {
  const state = await setup()
  try {
    const uploaded = await state.service.executeCredential(upload(state.created.id, '1', '0'), session)
    const current = await state.service.credentials(state.created.id, session)
    const command = { ...upload(state.created.id, uploaded.supplierVersion, uploaded.credentialVersion), commandId: 'slow-recognition', action: 'ocr-recognize' as const, credentialId: current.credentials[0]!.id, options: {} }
    let complete!: (value: typeof recognized) => void
    let started!: () => void
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    const pending = state.service.executeOcr(command, session, () => {
      started()
      return new Promise((resolve) => {
        complete = resolve
      })
    })
    const rejected = expect(pending).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await began
    const form = await state.service.form(state.created.id, session)
    await state.service.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, action: 'save', commandId: 'concurrent-master', id: state.created.id, requiredCapability: 'supplier:write', baseVersion: form.version, attachments: {}, draft: { ...form.draft, name: '并发核对后公司' } }, session, state.created.id)
    complete(recognized)
    await rejected
    expect((await state.service.credentials(state.created.id, session)).credentials[0]!.recognition).toBeNull()
    const row = (await state.service.credentials(state.created.id, session)).credentials[0]!
    expect(await state.service.file({ origin: 'real', supplierId: state.created.id, credentialId: row.id, fileId: row.file!.id }, session)).toMatchObject({ payloadBase64: bytes.toString('base64') })
  }
  finally { await state.storage.close() }
})

it('识别完成前撤销权限时不落候选、审计或回执，原件不变', async () => {
  const state = await setup()
  let allowed = true
  const liveSession = () => ({ ...actor, capabilities: allowed ? actor.capabilities : [] })
  try {
    const uploaded = await state.service.executeCredential(upload(state.created.id, '1', '0'), session)
    const before = await state.service.credentials(state.created.id, session)
    const command = { ...upload(state.created.id, uploaded.supplierVersion, uploaded.credentialVersion), commandId: 'revoked-recognition', action: 'ocr-recognize' as const, credentialId: before.credentials[0]!.id, options: {} }
    let complete!: (value: typeof recognized) => void
    let started!: () => void
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    const pending = state.service.executeOcr(command, liveSession, () => {
      started()
      return new Promise((resolve) => {
        complete = resolve
      })
    })
    const rejected = expect(pending).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await began
    allowed = false
    complete(recognized)
    await rejected
    await state.storage.close()
    expect(await state.service.credentials(state.created.id, session)).toEqual({ ...before, asOf: expect.any(String) })
    expect(await state.service.command(command.commandId, session)).toMatchObject({ outcome: 'not-applied' })
  }
  finally { await state.storage.close() }
})

async function reviewedExpiringSupplier() {
  const state = await setup()
  for (const category of ['营业执照', '法人身份证', '银行账户资料'] as const) {
    const current = await state.service.credentials(state.created.id, session)
    const request = upload(state.created.id, current.supplierVersion, current.credentialVersion)
    if (request.action !== 'upload')
      throw new Error('Invalid test upload')
    await state.service.executeCredential({ ...request, commandId: `expiry-${category === '营业执照' ? 'license' : category === '法人身份证' ? 'identity' : 'bank'}`, draft: { ...request.draft, category, expiresAt: category === '营业执照' ? '2026-09-22' : '' } }, session)
  }
  const current = await state.service.credentials(state.created.id, session)
  await state.service.executeCredential({ ...upload(state.created.id, current.supplierVersion, current.credentialVersion), commandId: 'review-expiry', action: 'review', draft: { decision: 'qualified', note: '合成证照核验' } }, session)
  return state
}

it('上海日期跨日撤销过期合格结论且冷开不重复递增，原件和核验审计保留', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T15:59:59Z'))
  const state = await reviewedExpiringSupplier()
  try {
    expect((await state.service.credentials(state.created.id, session)).status).toBe('qualified')
    vi.setSystemTime(new Date('2026-09-22T16:00:00Z'))
    await state.storage.close()
    const after = await state.service.credentials(state.created.id, session)
    expect(after).toMatchObject({ status: 'incomplete', review: null })
    expect(after.credentials).toHaveLength(3)
    expect((await state.storage.select<{ record_json: string }>('SELECT record_json FROM supplier_audits')).some(row => JSON.parse(row.record_json).action === 'credential_review')).toBe(true)
    await state.storage.close()
    expect(await state.service.credentials(state.created.id, session)).toEqual(after)
  }
  finally {
    await state.storage.close()
    vi.useRealTimers()
  }
})

it('识别在外部等待时封存原键，迟到候选被拒绝且不会新增回执', async () => {
  const state = await setup()
  try {
    const uploaded = await state.service.executeCredential(upload(state.created.id, '1', '0'), session)
    const before = await state.service.credentials(state.created.id, session)
    const command = { ...upload(state.created.id, uploaded.supplierVersion, uploaded.credentialVersion), commandId: 'sealed-recognition', action: 'ocr-recognize' as const, credentialId: before.credentials[0]!.id, options: {} }
    let complete!: (value: typeof recognized) => void
    let started!: () => void
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    const pending = state.service.executeOcr(command, session, () => {
      started()
      return new Promise((resolve) => {
        complete = resolve
      })
    })
    const rejected = expect(pending).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await began
    expect(await state.service.resolveCommand(command.commandId, session)).toMatchObject({ outcome: 'not-applied' })
    complete(recognized)
    await rejected
    await state.storage.close()
    expect(await state.service.credentials(state.created.id, session)).toEqual({ ...before, asOf: expect.any(String) })
    expect(await state.service.command(command.commandId, session)).toMatchObject({ outcome: 'not-applied' })
  }
  finally { await state.storage.close() }
})

it('正式写入门禁关闭时，跨日读取也不能持久撤销结论或递增业务版本', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T15:59:59Z'))
  const state = await reviewedExpiringSupplier()
  await state.storage.execute('UPDATE production_metadata SET purpose=? WHERE singleton=1', ['production'])
  const before = await state.storage.select('SELECT * FROM suppliers')
  await state.storage.close()
  const official = createProductionStorage({ ...state.options, purpose: 'production' })
  const service = createProductionSupplierService(official)
  try {
    expect((await service.credentials(state.created.id, session)).status).toBe('qualified')
    vi.setSystemTime(new Date('2026-09-22T16:00:00Z'))
    await expect(service.credentials(state.created.id, session)).rejects.toThrow('正式写入尚未')
    expect(await official.select('SELECT * FROM suppliers')).toEqual(before)
  }
  finally {
    await official.close()
    vi.useRealTimers()
  }
})

it.each([
  (value: Record<string, unknown>) => { delete value.review },
  (value: Record<string, unknown>) => { value.review = Object.assign({}, value.review, { decision: 'unknown' }) },
  (value: Record<string, unknown>) => { value.changedAfterMigration = null },
])('磁盘人工核验元数据缺项或损坏必须拒绝：%#', async (mutate) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T15:59:59Z'))
  const state = await reviewedExpiringSupplier()
  try {
    const before = await state.storage.select('SELECT * FROM suppliers')
    const row = (await state.storage.select<{ metadata_json: string }>('SELECT metadata_json FROM supplier_credential_scopes'))[0]!
    const metadata = JSON.parse(row.metadata_json)
    const broken = structuredClone(metadata)
    mutate(broken)
    await state.storage.execute('UPDATE supplier_credential_scopes SET metadata_json=?', [JSON.stringify(broken)])
    await state.storage.close()
    await expect(state.service.credentials(state.created.id, session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await state.storage.select('SELECT * FROM suppliers')).toEqual(before)
  }
  finally {
    await state.storage.close()
    vi.useRealTimers()
  }
})
