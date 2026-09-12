import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { createSupplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'
import { createSupplierCredentialOcrService } from '../../server/utils/supplier-credential-ocr-service'
import { createSupplierCredentialService } from '../../server/utils/supplier-credential-service'

const session = { workspaceId: 'ocr', actorId: 'reviewer', capabilities: ['supplier:write', 'supplier:list:read', 'supplier-credential:read', 'supplier-credential:write'] }
const result = { engine: 'paddleocr-official-api' as const, model: 'PaddleOCR-VL-1.6' as const, jobId: 'synthetic', pages: [], markdownPages: ['营业执照\n统一社会信用代码：913100001234567890\n公司名称：识别公司'], dataInfo: {} }

async function setup(recognize = async () => result) {
  const commands = createSupplierCommandTestInstance()
  const created = await commands.execute({ action: 'save', commandId: 'create', requiredCapability: 'supplier:write', workspaceId: 'ocr', actorId: 'reviewer', baseVersion: null, attachments: {}, draft: { name: '当前公司', supplierCategory: '其他', contact: '联系人', uniqueCode: 'INTERNAL-ONLY' } }, session)
  const ports = { read: commands.readCredentialScope, transact: commands.transactCredentialScope }
  const credentials = createSupplierCredentialService(ports)
  const read = () => credentials.read(created.id, 'real', session)
  let sequence = 0
  const envelope = () => ({ commandId: `ocr-${++sequence}`, supplierId: created.id, origin: 'real' as const, workspaceId: 'ocr', actorId: 'reviewer', requiredCapability: 'supplier-credential:write' as const, baseSupplierVersion: read().supplierVersion, baseCredentialVersion: read().credentialVersion })
  const bytes = Buffer.from('%PDF-1.7\nSynthetic document\n%%EOF')
  const upload = credentials.execute({ ...envelope(), action: 'upload', draft: { category: '营业执照', validFrom: '', expiresAt: '', longTerm: false, fileName: 'synthetic.pdf', mimeType: 'application/pdf', fileSize: bytes.length, payloadBase64: bytes.toString('base64') } }, session)
  return { commands, created, read, envelope, credentialId: upload.credentialId!, credentials, ocr: createSupplierCredentialOcrService(ports, { recognize }), bytes }
}

describe('中央原件识别与人工确认', () => {
  it('历史结构化待核对候选保原字段意义，可冷读续核对而不搬内部码到税号', async () => {
    const state = await setup()
    state.commands.transactCredentialScope(state.created.id, (scope) => {
      const target = scope.aggregate.credentials[0]!
      target.ocrResult = { fields: [{ key: 'uniqueCode', label: '旧统一社会信用代码', value: 'OLD-INTERNAL-CANDIDATE', confidence: 0.8 }] }
      target.ocrReviewStatus = 'pending'
      return { changed: true, value: null }
    })
    const recognized = state.read().credentials[0]!.recognition!
    expect(recognized).toMatchObject({ historical: true, parsed: { fields: [{ key: 'uniqueCode', value: 'OLD-INTERNAL-CANDIDATE' }] } })
    expect(state.read().credentials[0]!.recognition!.id).toBe(recognized.id)
    const confirm = { ...state.envelope(), action: 'ocr-confirm' as const, credentialId: state.credentialId, draft: { decisions: { category: 'keep-current' as const, longTerm: 'keep-current' as const }, recognitionId: recognized.id, choices: [{ key: 'uniqueCode' as const, decision: 'use-recognized' as const, candidateId: recognized.parsed.fields[0]!.id! }], category: '营业执照' as const, longTerm: false } }
    expect(() => state.ocr.confirm(confirm, session)).toThrow(/历史内部编码/)
    state.ocr.confirm({ ...confirm, draft: { ...confirm.draft, choices: [{ key: 'uniqueCode', decision: 'keep-current' }] } }, session)
    expect(state.commands.form(state.created.id, session).draft).toMatchObject({ uniqueCode: 'INTERNAL-ONLY', taxNo: '' })
  })

  it('识别只保存候选，冷读后明确选择税号再同事务确认，内部码不改', async () => {
    const state = await setup()
    const command = { ...state.envelope(), action: 'ocr-recognize' as const, credentialId: state.credentialId, options: {} }
    await state.ocr.recognize(command, () => session)
    const record = state.read().credentials[0]!
    expect(record).toMatchObject({ ocrReviewStatus: 'pending', ocrConfirmedAt: null })
    expect(state.commands.form(state.created.id, session).draft).toMatchObject({ name: '当前公司', uniqueCode: 'INTERNAL-ONLY', taxNo: '' })
    const recognition = record.recognition!
    const choices = recognition.parsed.fields.map(field => ({ key: field.key, decision: field.key === 'taxNo' ? 'use-recognized' as const : 'keep-current' as const, candidateId: field.id }))
    const confirm = { ...state.envelope(), action: 'ocr-confirm' as const, credentialId: state.credentialId, draft: { decisions: { category: 'keep-current' as const, longTerm: 'keep-current' as const }, recognitionId: recognition.id, choices, category: '营业执照' as const, longTerm: false } }
    const saved = state.ocr.confirm(confirm, session)
    expect(state.commands.form(state.created.id, session).draft).toMatchObject({ name: '当前公司', uniqueCode: 'INTERNAL-ONLY', taxNo: '913100001234567890' })
    expect(state.read().credentials[0]).toMatchObject({ ocrReviewStatus: 'confirmed', ocrConfirmedResult: { fields: { taxNo: '913100001234567890' }, decisions: { category: 'keep-current', longTerm: 'keep-current' } } })
    expect(state.ocr.confirm(confirm, session)).toEqual(saved)
    expect(() => state.ocr.confirm({ ...confirm, draft: { ...confirm.draft, longTerm: true } }, session)).toThrow(/标识/)
  })

  it('识别等待不锁主档；并发更正或撤权后迟到结果不保存候选', async () => {
    let complete!: (value: typeof result) => void
    const state = await setup(() => new Promise((resolve) => {
      complete = resolve
    }))
    const command = { ...state.envelope(), action: 'ocr-recognize' as const, credentialId: state.credentialId, options: {} }
    const operation = state.ocr.recognize(command, () => session)
    const form = state.commands.form(state.created.id, session)
    await state.commands.execute({ action: 'save', commandId: 'concurrent', id: state.created.id, requiredCapability: 'supplier:write', workspaceId: 'ocr', actorId: 'reviewer', baseVersion: form.version, attachments: {}, draft: { ...form.draft, taxNo: 'HUMAN-TAX' } }, session)
    complete(result)
    await expect(operation).rejects.toThrow(/变化/)
    expect(state.read().credentials[0]!.ocrReviewStatus).toBe('not_started')
    expect(state.commands.form(state.created.id, session).draft.taxNo).toBe('HUMAN-TAX')
    let currentSession = session
    const next = state.ocr.recognize({ ...state.envelope(), action: 'ocr-recognize', credentialId: state.credentialId, options: {} }, () => currentSession)
    currentSession = { ...session, capabilities: [] }
    complete(result)
    await expect(next).rejects.toThrow(/会话/)
    expect(state.read().credentials[0]!.ocrReviewStatus).toBe('not_started')
  })

  it('识别响应丢失与同时重试共用一次识别；新识别保留原确认痕迹', async () => {
    let calls = 0
    const state = await setup(async () => {
      calls++
      return result
    })
    const command = { ...state.envelope(), action: 'ocr-recognize' as const, credentialId: state.credentialId, options: {} }
    const [first, retry] = await Promise.all([state.ocr.recognize(command, () => session), state.ocr.recognize(command, () => session)])
    expect(first).toEqual(retry)
    expect(await state.ocr.recognize(command, () => session)).toEqual(first)
    expect(calls).toBe(1)
    const recognized = state.read().credentials[0]!.recognition!
    state.ocr.confirm({ ...state.envelope(), action: 'ocr-confirm', credentialId: state.credentialId, draft: { decisions: { category: 'keep-current' as const, longTerm: 'keep-current' as const }, recognitionId: recognized.id, choices: recognized.parsed.fields.map(field => ({ key: field.key, decision: 'keep-current' })), category: '营业执照', longTerm: false } }, session)
    const confirmed = state.read().credentials[0]!
    await state.ocr.recognize({ ...state.envelope(), action: 'ocr-recognize', credentialId: state.credentialId, options: {} }, () => session)
    expect(state.read().credentials[0]).toMatchObject({ ocrReviewStatus: 'pending', ocrConfirmedAt: confirmed.ocrConfirmedAt, ocrConfirmedResult: confirmed.ocrConfirmedResult })
  })

  it('重复税号及陈旧人工确认整体拒绝，不保存确认痕迹或覆盖当前主档', async () => {
    const state = await setup()
    await state.ocr.recognize({ ...state.envelope(), action: 'ocr-recognize', credentialId: state.credentialId, options: {} }, () => session)
    const recognized = state.read().credentials[0]!.recognition!
    const choice = recognized.parsed.fields.find(field => field.key === 'taxNo')!
    await state.commands.execute({ action: 'save', commandId: 'another-supplier', requiredCapability: 'supplier:write', workspaceId: 'ocr', actorId: 'reviewer', baseVersion: null, attachments: {}, draft: { name: '另一家公司', supplierCategory: '其他', contact: '其他联系人', taxNo: choice.value } }, session)
    const choices = recognized.parsed.fields.map(field => field.key === 'taxNo' ? { key: field.key, decision: 'use-recognized' as const, candidateId: field.id! } : { key: field.key, decision: 'keep-current' as const })
    const command = { ...state.envelope(), action: 'ocr-confirm' as const, credentialId: state.credentialId, draft: { decisions: { category: 'keep-current' as const, longTerm: 'keep-current' as const }, recognitionId: recognized.id, choices, category: '营业执照' as const, longTerm: false } }
    const before = state.read()
    expect(() => state.ocr.confirm(command, session)).toThrow(/已存在/)
    expect(state.read()).toMatchObject({ supplierVersion: before.supplierVersion, credentialVersion: before.credentialVersion, credentials: [{ ocrReviewStatus: 'pending', ocrConfirmedAt: null }] })
    const form = state.commands.form(state.created.id, session)
    await state.commands.execute({ action: 'save', commandId: 'concurrent-note', id: state.created.id, requiredCapability: 'supplier:write', workspaceId: 'ocr', actorId: 'reviewer', baseVersion: form.version, attachments: {}, draft: { ...form.draft, note: '另一个窗口的主档备注' } }, session)
    expect(() => state.ocr.confirm(command, session)).toThrow(expect.objectContaining({ problem: expect.objectContaining({ code: 'conflict', commandId: command.commandId, commandOutcome: 'not-applied' }) }))
    expect(state.commands.form(state.created.id, session).draft).toMatchObject({ note: '另一个窗口的主档备注', taxNo: '' })
  })

  it('已删除或替换原件不能沿旧候选确认；演示、无主档写权拒绝', async () => {
    const state = await setup()
    await state.ocr.recognize({ ...state.envelope(), action: 'ocr-recognize', credentialId: state.credentialId, options: {} }, () => session)
    const recognized = state.read().credentials[0]!.recognition!
    const command = { ...state.envelope(), action: 'ocr-confirm' as const, credentialId: state.credentialId, draft: { decisions: { category: 'keep-current' as const, longTerm: 'keep-current' as const }, recognitionId: recognized.id, choices: recognized.parsed.fields.map(field => ({ key: field.key, decision: 'keep-current' as const })), category: '营业执照' as const, longTerm: false } }
    expect(() => state.ocr.confirm({ ...command, origin: 'demo' }, session)).toThrow(/会话/)
    expect(() => state.ocr.confirm(command, { ...session, capabilities: session.capabilities.filter(capability => capability !== 'supplier:write') })).toThrow(/会话/)
    state.commands.transactCredentialScope(state.created.id, (scope) => {
      const file = scope.aggregate.files[0]!
      file.payloadBase64 = Buffer.from('%PDF-1.7\nReplaced synthetic original\n%%EOF').toString('base64')
      return { changed: true, value: null }
    })
    expect(() => state.ocr.confirm({ ...command, ...state.envelope() }, session)).toThrow(/候选或原件/)
    state.credentials.execute({ ...state.envelope(), action: 'delete', credentialId: state.credentialId }, session)
    expect(() => state.ocr.confirm({ ...command, ...state.envelope() }, session)).toThrow(/删除/)
    expect(state.commands.form(state.created.id, session).draft.taxNo).toBe('')
  })

  it('失败不损坏原件，重试使用完全相同授权字节和当前设置；少主档写权不返回核对值', async () => {
    let fail = true
    let input: unknown
    const state = await setup()
    const ports = { read: state.commands.readCredentialScope, transact: state.commands.transactCredentialScope }
    const ocr = createSupplierCredentialOcrService(ports, { recognize: async (captured) => {
      input = captured
      if (fail)
        throw new Error('合成服务暂不可用')
      return result
    } })
    const command = { ...state.envelope(), action: 'ocr-recognize' as const, credentialId: state.credentialId, options: { useSealRecognition: false, requestTimeoutMs: 20000 } }
    await expect(ocr.recognize(command, () => session)).rejects.toThrow(/暂不可用/)
    expect(state.read().credentials[0]).toMatchObject({ ocrReviewStatus: 'not_started', file: { state: 'available' } })
    fail = false
    await ocr.recognize(command, () => session)
    expect(input).toMatchObject({ data: state.bytes, options: { useSealRecognition: false, requestTimeoutMs: 20000 } })
    const withoutMasterWrite = { ...session, capabilities: session.capabilities.filter(capability => capability !== 'supplier:write') }
    expect(state.credentials.read(state.created.id, 'real', withoutMasterWrite).masterValues).toBeUndefined()
  })
})
