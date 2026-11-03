import type { SupplierTaxpayerCommand } from '~/lib/supplier/taxpayer-verification'
import { describe, expect, it } from 'vitest'
import { GUANGDONG_TAX_QUERY_URL, preserveTaxpayerVerification } from '~/lib/supplier/taxpayer-verification'
import { createSupplierCommandService } from '../../server/utils/supplier-command-service'
import { parseSupplierTaxpayerCommand } from '../../server/utils/supplier-taxpayer-request'
import { createSupplierTaxpayerService } from '../../server/utils/supplier-taxpayer-service'

const session = { workspaceId: 'taxpayer-workspace', actorId: 'taxpayer-actor', capabilities: ['supplier:write', 'supplier:list:read'] }

async function setup() {
  const instance = createSupplierCommandService({ createId: () => 'supplier-taxpayer' })
  const created = await instance.execute({ ...session, requiredCapability: 'supplier:write', commandId: 'create', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成税务分供方', supplierCategory: '其他', contact: '合成人员', taxNo: 'TAX-A', taxpayerType: '未核验', note: '原主档备注' } }, session)
  const service = createSupplierTaxpayerService({ transact: instance.transactCredentialScope }, { now: () => '2026-09-12T12:00:00.000Z', createId: () => 'taxpayer-audit' })
  const command = (): SupplierTaxpayerCommand => ({ supplierId: created.id, origin: 'real', workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'supplier:write', commandId: 'taxpayer-command', baseSupplierVersion: instance.form(created.id, session).version, expectedTaxNo: 'TAX-A', draft: { status: 'not_found', taxpayerType: '小规模纳税人', note: '合成官网未查到记录' } })
  return { instance, created, service, command }
}

describe('人工税务核验中央边界', () => {
  it('未改变税号或类型的普通编辑保全旧来源和旧时间的原义', () => {
    const historical = { taxNo: 'TAX-A', taxpayerType: '一般纳税人', taxpayerVerificationStatus: 'legacy_reviewed', taxpayerVerificationSource: '历史人工纸质材料', taxpayerVerifiedAt: '2024-06-01 09:30:00', taxpayerVerificationNote: '迁移原始备注', note: '旧主档备注' }
    expect(preserveTaxpayerVerification(historical, { ...historical, taxNo: ' TAX-A ', note: '只改主档备注', taxpayerVerificationSource: '来稿伪来源', taxpayerVerifiedAt: null, taxpayerVerificationNote: '' })).toEqual({ ...historical, taxNo: ' TAX-A ', note: '只改主档备注' })
  })
  it('普通主档保存不能伪造人工核验时间和凭证', async () => {
    const instance = createSupplierCommandService({ createId: () => 'supplier-taxpayer' })
    const created = await instance.execute({ ...session, requiredCapability: 'supplier:write', commandId: 'create', baseVersion: null, action: 'save', attachments: {}, draft: {
      name: '合成税务分供方',
      supplierCategory: '其他',
      contact: '合成人员',
      taxNo: 'TAX-A',
      taxpayerType: '一般纳税人',
      taxpayerVerificationStatus: 'confirmed_general',
      taxpayerVerificationSource: '伪来源',
      taxpayerVerifiedAt: '2000-01-01T00:00:00.000Z',
      taxpayerVerificationNote: '伪造核验',
    } }, session)
    expect(instance.form(created.id, session).draft).toMatchObject({ taxpayerVerificationStatus: 'not_checked', taxpayerVerificationSource: '', taxpayerVerifiedAt: null, taxpayerVerificationNote: '' })
  })
  it('人工未查到只写未核验，时间由后台生成，冷读保留五字段且审计不含正文', async () => {
    const state = await setup()
    const result = state.service.execute(state.command(), session)
    expect(result.verification).toEqual({ taxpayerType: '未核验', taxpayerVerificationStatus: 'not_found', taxpayerVerificationSource: GUANGDONG_TAX_QUERY_URL, taxpayerVerifiedAt: '2026-09-12T12:00:00.000Z', taxpayerVerificationNote: '合成官网未查到记录' })
    expect(state.instance.form(state.created.id, session)).toMatchObject({ version: result.supplierVersion, draft: { ...result.verification, taxNo: 'TAX-A', note: '原主档备注' } })
    const audit = state.instance.readCredentialScope(state.created.id).aggregate.supplierAudits.at(-1)
    expect(audit).toMatchObject({ action: 'taxpayer_verification', outcome: 'not_found', sourceCategory: 'official_website', actorId: session.actorId, notePresent: true })
    expect(JSON.stringify(audit)).not.toContain('TAX-A')
    expect(JSON.stringify(audit)).not.toContain('合成官网未查到记录')
  })
  it('主档普通编辑保留当前历史凭证，来稿旧凭证不能覆盖专用结果', async () => {
    const state = await setup()
    const verified = state.service.execute(state.command(), session)
    const loaded = state.instance.form(state.created.id, session)
    await state.instance.execute({ ...session, id: state.created.id, requiredCapability: 'supplier:write', commandId: 'normal-update', baseVersion: loaded.version, action: 'save', attachments: {}, draft: { ...loaded.draft, note: '新的无关备注', taxpayerVerificationStatus: 'confirmed_general', taxpayerVerifiedAt: '2000-01-01T00:00:00.000Z' } }, session)
    expect(state.instance.form(state.created.id, session).draft).toMatchObject({ ...verified.verification, note: '新的无关备注' })
  })
  it.each([{ taxNo: 'TAX-B' }, { taxpayerType: '一般纳税人' }])('税号或分类实际变化撤销旧核验 %j', async (change) => {
    const state = await setup()
    state.service.execute(state.command(), session)
    const loaded = state.instance.form(state.created.id, session)
    await state.instance.execute({ ...session, id: state.created.id, requiredCapability: 'supplier:write', commandId: 'change-basis', baseVersion: loaded.version, action: 'save', attachments: {}, draft: { ...loaded.draft, ...change } }, session)
    expect(state.instance.form(state.created.id, session).draft).toMatchObject({ ...change, taxpayerVerificationStatus: 'not_checked', taxpayerVerificationSource: '', taxpayerVerifiedAt: null, taxpayerVerificationNote: '' })
  })
  it('失响应重放只形成一次核验，同键不同内容拒绝且不覆写原结果', async () => {
    const state = await setup()
    const command = state.command()
    const result = state.service.execute(command, session)
    expect(state.service.execute(command, session)).toEqual(result)
    expect(state.instance.readCredentialScope(state.created.id).aggregate.supplierAudits.filter(row => row.action === 'taxpayer_verification')).toHaveLength(1)
    expect(() => state.service.execute({ ...command, draft: { ...command.draft, note: '另一份输入' } }, session)).toThrow('其他内容')
  })
  it('后台重验当前版本、税号、来源、主体及当前会话能力', async () => {
    const state = await setup()
    const command = state.command()
    expect(() => state.service.execute({ ...command, baseSupplierVersion: '0' }, session)).toThrow('已变化')
    expect(() => state.service.execute({ ...command, expectedTaxNo: 'UNSAVED' }, session)).toThrow('已变化')
    expect(() => state.service.execute({ ...command, supplierId: 'another' }, session)).toThrow('不存在')
    expect(() => state.service.execute({ ...command, origin: 'demo' }, session)).toThrow('当前会话')
    expect(() => state.service.execute(command, { ...session, capabilities: [] })).toThrow('当前会话')
    expect(() => state.service.execute({ ...command, actorId: 'another' }, session)).toThrow('当前会话')
    expect(() => state.service.execute({ ...command, workspaceId: 'another' }, session)).toThrow('当前会话')
    expect(state.instance.form(state.created.id, session).version).toBe(command.baseSupplierVersion)
  })
  async function createParseSupplierTaxpayerCommandFixture() {
    const state = await setup()
    const command = state.command()
    return { state, command }
  }

  it('税务核验 HTTP 命令保留完整合法主体与用户输入', async () => {
    const { state, command } = await createParseSupplierTaxpayerCommandFixture()
    expect(parseSupplierTaxpayerCommand(command, state.created.id)).toEqual(command)
  })

  it.each([
    { case: '{ ...command, taxpayerVerifiedAt: \'2000-01-01\' } / state.created.id', prepare: async ({ state, command }: Awaited<ReturnType<typeof createParseSupplierTaxpayerCommandFixture>>) => {
      return { input: { ...command, taxpayerVerifiedAt: '2000-01-01' }, argument2: state.created.id, expected: '格式' } as const
    } },
    { case: '{ ...command, draft: { ...command.draft, source: \'伪来源\' } } / state.created.id', prepare: async ({ state, command }: Awaited<ReturnType<typeof createParseSupplierTaxpayerCommandFixture>>) => {
      return { input: { ...command, draft: { ...command.draft, source: '伪来源' } }, argument2: state.created.id, expected: '格式' } as const
    } },
    { case: 'command / \'another\'', prepare: async ({ command }: Awaited<ReturnType<typeof createParseSupplierTaxpayerCommandFixture>>) => {
      return { input: command, argument2: 'another', expected: '格式' } as const
    } },
  ])('hTTP 不接收客户端时间、来源、其他字段或错路由主体 / parseSupplierTaxpayerCommand：$case', async ({ prepare }) => {
    const fixture = await createParseSupplierTaxpayerCommandFixture()
    const { input, argument2, expected } = await prepare(fixture)
    expect(() => parseSupplierTaxpayerCommand(input, argument2)).toThrow(expected)
  })
})
