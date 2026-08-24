import { describe, expect, it } from 'vitest'
import { f2FormDefaults } from '~/lib/contract/page'
import { MATERIAL_CONTRACT_WRITE_CAPABILITY } from '~/lib/material-contract/command-contract'
import { createMaterialContractCommandTestInstance } from '../../server/utils/material-contract-command-test-instance'
import { createMaterialContractReadTestInstance } from '../../server/utils/material-contract-read-test-instance'

describe('材料采购合同中央测试实例', () => {
  it('正式命令写入后可经中央列表和详情刷新读取', async () => {
    const command = createMaterialContractCommandTestInstance({
      createId: () => 'contract-real-test',
      createLineId: () => 'line-real-test',
      now: () => '2026-08-24T01:00:00.000Z',
      projects: [{ id: 'project-real-test', name: '正式项目' }],
      suppliers: [{ id: 'supplier-real-test', name: '正式供应商' }],
    })
    const session = {
      workspaceId: 'workspace-test',
      actorId: 'actor-test',
      capabilities: ['material-contract:read', MATERIAL_CONTRACT_WRITE_CAPABILITY],
    }
    const draft = {
      ...f2FormDefaults('material'),
      name: '中央写入材料合同',
      projectId: 'project-real-test',
      supplierId: 'supplier-real-test',
      content: '瓷砖采购',
      signDate: '2026-08-24',
      amount: 120,
      lineItems: [{ materialName: '瓷砖', spec: '', brand: '', unit: '㎡', qty: 1, taxInclusiveUnitPrice: 120, plannedArrivalDate: '', note: '', sortOrder: 0 }],
    }
    await command.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: MATERIAL_CONTRACT_WRITE_CAPABILITY,
      commandId: 'command-test',
      baseVersion: null,
      action: 'submit',
      draft,
      attachments: {},
    }, session)

    const rows = command.rows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.projectName).toBe('正式项目')
    expect(command.facts().lineItems[0]?.contractId).toBe('contract-real-test')
  })

  it('演示来源必须显式授权且来源不匹配不会回退', () => {
    const read = createMaterialContractReadTestInstance(() => ['material-contract:read', 'demo:read'])
    expect(read.list({ includeDemo: 'true' }).items.some(row => row.dataOrigin === 'demo')).toBe(true)
    expect(() => read.detail('con_demo_cg01', { origin: 'real', includeDemo: 'true' }))
      .toThrowError(/来源与地址不匹配/)
  })
})
