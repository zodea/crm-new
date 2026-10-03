import type { ProjectContractFormDraft } from '~/lib/contract/forms'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodeCustomerDetailRead } from '~/lib/customer/repository'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { prepareConstructionContractChainIdentityFixtures } from '../../server/utils/construction-contract-chain-test-fixture'
import { constructionContractCommandTestInstance as commands } from '../../server/utils/construction-contract-command-test-instance'
import { constructionContractReadTestInstance as contracts } from '../../server/utils/construction-contract-read-test-instance'
import { customerCommandTestInstance as customers } from '../../server/utils/customer-command-test-instance'
import { customerReadTestInstance as reads } from '../../server/utils/customer-read-test-instance'
import { projectCommandTestInstance } from '../../server/utils/project-command-test-instance'
import { projectReadTestInstance as projects } from '../../server/utils/project-read-test-instance'
import { supplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'

const session = resolveBusinessSession()
const scope = 'customer-construction-contract-425'
let sequence = 0
const envelope = () => ({ ...session, commandId: `cc-${++sequence}`, baseVersion: null, action: 'save' as const, attachments: {} })
function save(draft: ProjectContractFormDraft = {}) {
  return commands.execute({
    ...envelope(),
    requiredCapability: 'construction-contract:write',
    draft: { name: '合成施工合同', projectId: 'project-real-320', customerId: 'customer-real-320', content: '合成施工', signDate: '2026-09-09', amount: 123400, ...draft },
  }, session, scope)
}
const detail = async (id = 'customer-real-320', origin = 'real', sessionId = scope) => decodeCustomerDetailRead(await reads.detail(id, { origin, includeDemo: String(origin === 'demo') }, sessionId))

beforeEach(() => {
  prepareConstructionContractChainIdentityFixtures(scope)
  prepareConstructionContractChainIdentityFixtures('other-contract-425')
})

afterEach(() => {
  for (const sessionId of [scope, 'other-contract-425']) {
    commands.reset(sessionId)
    contracts.reset('ready', sessionId)
    reads.reset('ready', sessionId)
    projects.reset('ready', sessionId)
    customers.reset(sessionId)
    projectCommandTestInstance.reset(sessionId)
    supplierCommandTestInstance.reset(sessionId)
  }
})

describe('正式施工合同保存→客户中央回读', () => {
  it.each([
    { action: 'draft', inputStatus: '履约中', expectedStatus: '草稿' },
    { action: 'submit', inputStatus: '草稿', expectedStatus: '审批中' },
    { action: 'save', inputStatus: '履约中', expectedStatus: '履约中' },
  ] as const)('$action 按动作写入状态并由详情回读', async (input) => {
    const result = await commands.execute({
      ...envelope(),
      action: input.action,
      requiredCapability: 'construction-contract:write',
      draft: { name: '状态回读施工合同', projectId: 'project-real-320', customerId: 'customer-real-320', content: '合成施工', signDate: '2026-09-09', amount: 113, status: input.inputStatus },
    }, session, scope)
    expect(commands.form(result.id, session, scope).draft.status).toBe(input.expectedStatus)
    const read = await contracts.detail(result.id, { origin: 'real', includeDemo: 'false' }, scope)
    expect(read.contract.status).toBe(input.expectedStatus)
  })

  it('表单保存的同一客户、合同 ID 与有效金额回读，合同更正后版本和金额刷新', async () => {
    const contract = await save()
    const first = await detail()
    expect(first.summary).toMatchObject({ contractCount: 1, effectiveContractAmount: '123400.00' })
    expect(first.contracts[0]).toMatchObject({ contract: { id: contract.id, label: '合成施工合同' }, effectiveAmount: '123400.00', navigation: { filters: { dataOrigin: 'real', contractKind: '施工', customerId: 'customer-real-320' } } })
    expect(first.projects[0]).toMatchObject({ contractCount: 1, effectiveContractAmount: '123400.00' })
    await commands.execute({ ...envelope(), id: contract.id, baseVersion: contract.version, requiredCapability: 'construction-contract:write', draft: { ...commands.form(contract.id, session, scope).draft, name: '更正后的合同', amount: 456700 } }, session, scope)
    const changed = await detail()
    expect(changed.contracts[0]).toMatchObject({ contract: { id: contract.id, label: '更正后的合同' }, effectiveAmount: '456700.00' })
    expect(changed.sourceVersion).not.toBe(first.sourceVersion)
  })

  it('草稿显示且计合同数，但有效金额为零；零金额正式合同仍有稳定目标', async () => {
    await save({ status: '草稿' })
    await save({ amount: 0 })
    const read = await detail()
    expect(read.summary).toMatchObject({ contractCount: 2, effectiveContractAmount: '0.00' })
    expect(read.contracts.map(row => row.effectiveAmount)).toEqual(['0.00', '0.00'])
    expect(read.contracts[0]?.isDraft).toBe(true)
  })

  it('同名不同 ID 不误接、缺客户 ID 不靠项目兜底、来源和测试会话隔离', async () => {
    const sameName = await customers.execute({ ...envelope(), requiredCapability: 'customer:write', draft: { name: '中央正式甲方客户', contact: '另一身份' } }, session, scope)
    const saved = await save()
    await commands.execute({ ...envelope(), action: 'draft', requiredCapability: 'construction-contract:write', draft: { name: '缺甲方草稿', projectId: 'project-real-320' } }, session, scope)
    expect((await detail(sameName.id)).contracts).toEqual([])
    expect((await detail()).contracts.map(row => row.contract.id)).toEqual([saved.id])
    expect((await detail('customer-real-320', 'real', 'other-contract-425')).contracts).toEqual([])
    expect(JSON.stringify(await detail('customer_demo_001', 'demo'))).not.toContain(saved.id)
    await expect(detail('customer-real-320', 'demo')).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
  })

  it.each(['forbidden', 'unavailable'] as const)('合同源 %s 时合同与派生摘要未知，客户和项目仍可读，恢复后同一合同出现', async (scenario) => {
    const saved = await save()
    expect((await detail()).contracts).toHaveLength(1)
    contracts.reset(scenario, scope)
    const failed = await detail()
    expect(failed.contractsProblem?.code).toBe(scenario)
    expect(failed.summary).toMatchObject({ contractCount: null, effectiveContractAmount: null, outstandingAmount: null, projectCount: 1 })
    expect(failed.projects[0]).toMatchObject({ contractCount: null, effectiveContractAmount: null })
    expect(failed.contracts).toEqual([])
    expect(JSON.stringify(failed)).not.toContain(saved.id)
    expect((await reads.list({ search: '中央正式甲方客户' }, scope)).items).toHaveLength(1)
    contracts.reset('ready', scope)
    expect((await detail()).contracts[0]?.contract.id).toBe(saved.id)
  })

  it('项目源失败不阻断合同回读，失去项目信息只降级项目引用', async () => {
    const saved = await save()
    projects.reset('unavailable', scope)
    const read = await detail()
    expect(read.projectsProblem?.code).toBe('unavailable')
    expect(read.summary.contractCount).toBe(1)
    expect(read.contracts[0]).toMatchObject({ contract: { id: saved.id }, project: { state: 'missing' } })
  })

  async function createDecodeCustomerDetailReadFixture() {
    await save()
    const valid = await detail()
    return { valid }
  }

  it.each([
    { case: '{ ...valid, summary: { ...valid.summary, contractCount: 99 } }', prepare: async ({ valid }: Awaited<ReturnType<typeof createDecodeCustomerDetailReadFixture>>) => {
      return { input: { ...valid, summary: { ...valid.summary, contractCount: 99 } } } as const
    } },
    { case: '{ ...failed, summary: { ...failed.summary, effectiveContractAmount: \'0.00\' } }', prepare: async (_fixture: Awaited<ReturnType<typeof createDecodeCustomerDetailReadFixture>>) => {
      contracts.reset('unavailable', scope)
      const failed = await detail()
      return { input: { ...failed, summary: { ...failed.summary, effectiveContractAmount: '0.00' } } } as const
    } },
  ])('hTTP 解码拒绝来源/类别/客户错配、失败态假零以及伪造正常计数 / decodeCustomerDetailRead：$case', async ({ prepare }) => {
    const fixture = await createDecodeCustomerDetailReadFixture()
    const { input } = await prepare(fixture)
    expect(() => decodeCustomerDetailRead(input)).toThrow()
  })

  it.each(Array.from([{ dataOrigin: 'demo' }, { contractKind: '分包' }, { customerId: 'other' }]).map(input => ({ input })))('hTTP 解码拒绝来源/类别/客户错配、失败态假零以及伪造正常计数：输入组合 1 案例 %#', async ({ input: patch }) => {
    await save()
    const valid = await detail()
    const invalid = structuredClone(valid)
    const navigation = invalid.contracts[0]!.navigation
    if (navigation.kind === 'entity-detail')
      Object.assign(navigation.filters, patch)
    expect(() => decodeCustomerDetailRead(invalid)).toThrow()
  })
})
