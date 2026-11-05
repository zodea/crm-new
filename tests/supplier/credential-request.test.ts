import type { SupplierCredentialCommand } from '~/lib/supplier/credential-contract'
import { describe, expect, it } from 'vitest'
import { parseSupplierCredentialCommand, supplierCredentialOrigin } from '../../server/utils/supplier-credential-request'

const command: SupplierCredentialCommand = { action: 'review', commandId: 'manual-review-1', supplierId: 'supplier-1', origin: 'real', workspaceId: 'workspace', actorId: 'actor', requiredCapability: 'supplier-credential:write', baseSupplierVersion: '3', baseCredentialVersion: '2', draft: { decision: 'qualified', note: '人工核对' } }
describe('证照 HTTP 请求边界', () => {
  function createCredentialRecognitionCommand() {
    const { draft: _draft, ...base } = command
    const recognition = { ...base, action: 'ocr-recognize', credentialId: 'credential-1', options: { useSealRecognition: false, requestTimeoutMs: 20000 } }
    return { base, recognition }
  }

  it.each([
    { case: 'recognition', prepare: ({ recognition }: ReturnType<typeof createCredentialRecognitionCommand>) => {
      return { input: recognition, expected: recognition } as const
    } },
    { case: 'confirmation', prepare: ({ base }: ReturnType<typeof createCredentialRecognitionCommand>) => {
      const confirmation = { ...base, action: 'ocr-confirm', credentialId: 'credential-1', draft: { decisions: { category: 'keep-current', longTerm: 'keep-current' }, recognitionId: 'ocr-1', choices: [{ key: 'taxNo', decision: 'use-recognized', candidateId: 'tax-1' }], category: '营业执照', longTerm: false } }
      return { input: confirmation, expected: confirmation } as const
    } },
  ])('识别仅接受当前证照身份和现有设置，人工确认仅接受候选身份及明确选择 / parseSupplierCredentialCommand：$case', ({ prepare }) => {
    const fixture = createCredentialRecognitionCommand()
    const { input, expected } = prepare(fixture)
    expect(parseSupplierCredentialCommand(input)).toEqual(expected)
  })

  it.each([
    { case: '{ ...recognition, payloadBase64: \'用户替换正文\' }', prepare: ({ recognition }: ReturnType<typeof createCredentialRecognitionCommand>) => {
      return { input: { ...recognition, payloadBase64: '用户替换正文' } } as const
    } },
    { case: '{ ...recognition, options: { accessToken: \'不能携带私钥\' } }', prepare: ({ recognition }: ReturnType<typeof createCredentialRecognitionCommand>) => {
      return { input: { ...recognition, options: { accessToken: '不能携带私钥' } } } as const
    } },
    { case: '{ ...confirmation, draft: { ...confirmation.draft, fields: { taxNo: \'伪造最终值\' } } }', prepare: ({ base }: ReturnType<typeof createCredentialRecognitionCommand>) => {
      const confirmation = { ...base, action: 'ocr-confirm', credentialId: 'credential-1', draft: { decisions: { category: 'keep-current', longTerm: 'keep-current' }, recognitionId: 'ocr-1', choices: [{ key: 'taxNo', decision: 'use-recognized', candidateId: 'tax-1' }], category: '营业执照', longTerm: false } }
      return { input: { ...confirmation, draft: { ...confirmation.draft, fields: { taxNo: '伪造最终值' } } } } as const
    } },
    { case: '{ ...confirmation, draft: { ...confirmation.draft, choices: [{ key: \'taxNo\', decision: \'keep-current\', candida', prepare: ({ base }: ReturnType<typeof createCredentialRecognitionCommand>) => {
      const confirmation = { ...base, action: 'ocr-confirm', credentialId: 'credential-1', draft: { decisions: { category: 'keep-current', longTerm: 'keep-current' }, recognitionId: 'ocr-1', choices: [{ key: 'taxNo', decision: 'use-recognized', candidateId: 'tax-1' }], category: '营业执照', longTerm: false } }
      return { input: { ...confirmation, draft: { ...confirmation.draft, choices: [{ key: 'taxNo', decision: 'keep-current', candidateId: '额外内容' }] } } } as const
    } },
  ])('识别仅接受当前证照身份和现有设置，人工确认仅接受候选身份及明确选择 / parseSupplierCredentialCommand：$case', ({ prepare }) => {
    const fixture = createCredentialRecognitionCommand()
    const { input } = prepare(fixture)
    expect(() => parseSupplierCredentialCommand(input)).toThrow('证照命令格式无效')
  })
  it('明确携带主档及证照双版本，不接受人工凭证注入', () => {
    expect(parseSupplierCredentialCommand(command)).toEqual(command)
  })

  it.each([
    { case: '{ ...command, reviewedAt: \'2000-01-01\' }', input: { ...command, reviewedAt: '2000-01-01' } },
    { case: '{ ...command, draft: { ...command.draft, actorId: \'forged\' } }', input: { ...command, draft: { ...command.draft, actorId: 'forged' } } },
    { case: '{ ...command, baseSupplierVersion: null }', input: { ...command, baseSupplierVersion: null } },
  ])('明确携带主档及证照双版本，不接受人工凭证注入 / parseSupplierCredentialCommand：$case', ({ input }) => {
    expect(() => parseSupplierCredentialCommand(input)).toThrow('证照命令格式无效')
  })
  it.each(['upload', 'edit', 'requirement', 'review', 'delete', 'restore'])('拒绝 %s 动作缺失其必要字段', (action) => {
    expect(() => parseSupplierCredentialCommand({ ...command, action, draft: {} })).toThrow('证照命令格式无效')
  })
  it.each([undefined, null, ['real'], ['demo'], 'local', 'REAL'])('拒绝不明确读取来源 %j', (origin) => {
    expect(() => supplierCredentialOrigin({ origin })).toThrow('证照读取需要明确有效来源')
  })
  it.each([
    { case: '{ origin: \'real\' }', input: { origin: 'real' }, argument2: undefined, expected: 'real' },
    { case: '{ origin: \'demo\', includeDemo: \'true\' }', input: { origin: 'demo', includeDemo: 'true' }, argument2: undefined, expected: 'demo' },
    { case: '{ origin: \'real\', credentialId: \'credential-1\' } / [\'credentialId\']', input: { origin: 'real', credentialId: 'credential-1' }, argument2: ['credentialId'], expected: 'real' },
  ])('演示必须显式启用，文件查询只允许追加明确证照身份 / supplierCredentialOrigin：$case', ({ input, argument2, expected }) => {
    expect(supplierCredentialOrigin(input, argument2)).toBe(expected)
  })

  it.each([
    { case: '{ origin: \'demo\' }', input: { origin: 'demo' }, expected: '请先明确开启演示数据' },
    { case: '{ origin: \'real\', credentialId: \'credential-1\' }', input: { origin: 'real', credentialId: 'credential-1' }, expected: '证照读取需要明确有效来源' },
    { case: '{ origin: \'demo\', includeDemo: [\'true\'] }', input: { origin: 'demo', includeDemo: ['true'] }, expected: '证照读取需要明确有效来源' },
  ])('演示必须显式启用，文件查询只允许追加明确证照身份 / supplierCredentialOrigin：$case', ({ input, expected }) => {
    expect(() => supplierCredentialOrigin(input)).toThrow(expected)
  })
})
