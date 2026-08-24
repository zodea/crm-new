import type { BusinessSession } from '../../server/utils/business-session'
import type { ConstructionContractCommandRequestDTO } from '~/lib/construction-contract/command-contract'
import { describe, expect, it } from 'vitest'
import { CONSTRUCTION_CONTRACT_WRITE_CAPABILITY } from '~/lib/construction-contract/command-contract'
import { parseConstructionContractCommandRequest } from '../../server/utils/construction-contract-command-request'
import { createConstructionContractCommandTestInstance } from '../../server/utils/construction-contract-command-test-instance'

const SESSION: BusinessSession = {
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  capabilities: ['construction-contract:read', CONSTRUCTION_CONTRACT_WRITE_CAPABILITY],
}

function request(
  overrides: Partial<ConstructionContractCommandRequestDTO> = {},
): ConstructionContractCommandRequestDTO {
  return {
    workspaceId: SESSION.workspaceId,
    actorId: SESSION.actorId,
    requiredCapability: CONSTRUCTION_CONTRACT_WRITE_CAPABILITY,
    commandId: 'construction-command-create-1',
    baseVersion: null,
    action: 'submit',
    draft: {
      no: 'SG-CENTRAL-001',
      name: '中央新建施工合同',
      projectId: 'project-1',
      customerId: 'customer-1',
      content: '住宅装修施工',
      signDate: '2026-08-24',
      amount: 1000,
      status: '审批中',
    },
    attachments: {},
    ...overrides,
  }
}

describe('施工合同中央 command contract', () => {
  it('服务器分配 ID，重复 commandId 幂等，保存刷新后仍读取同一正式合同', async () => {
    const instance = createConstructionContractCommandTestInstance({
      createId: () => 'construction-contract-central-1',
      now: () => '2026-08-24T01:00:00.000Z',
      projects: [{ id: 'project-1', name: '中央项目', customerId: 'customer-1' }],
      customers: [{ id: 'customer-1', name: '中央客户' }],
    })

    const first = await instance.execute(request(), SESSION)
    const duplicate = await instance.execute(request(), SESSION)

    expect(duplicate).toEqual(first)
    expect(first).toMatchObject({
      id: 'construction-contract-central-1',
      version: '1',
      commandId: 'construction-command-create-1',
    })
    expect(instance.rows()).toEqual([
      expect.objectContaining({
        id: 'construction-contract-central-1',
        kind: '施工',
        projectId: 'project-1',
        customerId: 'customer-1',
        actualCompletionDate: null,
      }),
    ])
    expect(instance.form('construction-contract-central-1', SESSION)).toMatchObject({
      version: '1',
      draft: { id: 'construction-contract-central-1', name: '中央新建施工合同' },
    })
  })

  it('拒绝项目与客户关系错配，并且不接受客户端伪造实际竣工字段', async () => {
    const instance = createConstructionContractCommandTestInstance({
      projects: [{ id: 'project-1', name: '中央项目', customerId: 'customer-1' }],
      customers: [
        { id: 'customer-1', name: '中央客户' },
        { id: 'customer-2', name: '其他客户' },
      ],
    })
    await expect(instance.execute(request({
      draft: { ...request().draft, customerId: 'customer-2' },
    }), SESSION)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })

    expect(() => parseConstructionContractCommandRequest({
      ...request(),
      draft: { ...request().draft, actualCompletionDate: '2026-08-24' },
    }, { kind: 'create' })).toThrowError(/未知施工合同字段/)

    expect(parseConstructionContractCommandRequest({
      ...request(),
      draft: { ...request().draft, lineItems: [] },
    }, { kind: 'create' }).draft.lineItems).toBeUndefined()
  })

  it('拒绝过期 baseVersion，不以最后写入覆盖', async () => {
    const instance = createConstructionContractCommandTestInstance({
      createId: () => 'construction-contract-central-1',
      projects: [{ id: 'project-1', name: '中央项目', customerId: 'customer-1' }],
      customers: [{ id: 'customer-1', name: '中央客户' }],
    })
    await instance.execute(request(), SESSION)
    await instance.execute(request({
      id: 'construction-contract-central-1',
      commandId: 'construction-command-update-1',
      baseVersion: '1',
      draft: { ...request().draft, id: 'construction-contract-central-1', name: '最新施工合同' },
    }), SESSION)

    await expect(instance.execute(request({
      id: 'construction-contract-central-1',
      commandId: 'construction-command-stale-1',
      baseVersion: '1',
      draft: { ...request().draft, id: 'construction-contract-central-1', name: '过期施工合同' },
    }), SESSION)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })

  it('受控迁入保留稳定 ID，重复迁入幂等，且不会生成正式 seed', () => {
    const instance = createConstructionContractCommandTestInstance({
      projects: [{ id: 'project-1', name: '中央项目', customerId: 'customer-1' }],
      customers: [{ id: 'customer-1', name: '中央客户' }],
    })
    expect(instance.rows()).toEqual([])
    const record = {
      id: 'construction-contract-existing-1',
      draft: { ...request().draft, id: 'construction-contract-existing-1' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    }
    expect(instance.importExisting([record])).toEqual(['construction-contract-existing-1'])
    expect(instance.importExisting([record])).toEqual([])
    expect(instance.rows()[0]?.actualCompletionDate).toBeNull()
  })
})
