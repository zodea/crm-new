import type { SubcontractContractCommandRequestDTO } from '../../app/lib/subcontract-contract/command-contract'
import type { BusinessSession } from '../../server/utils/business-session'
import { describe, expect, it } from 'vitest'
import { SUBCONTRACT_CONTRACT_WRITE_CAPABILITY } from '../../app/lib/subcontract-contract/command-contract'
import { parseSubcontractContractCommandRequest } from '../../server/utils/subcontract-contract-command-request'
import { createSubcontractContractCommandTestInstance } from '../../server/utils/subcontract-contract-command-test-instance'

const SESSION: BusinessSession = {
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  capabilities: ['subcontract-contract:read', SUBCONTRACT_CONTRACT_WRITE_CAPABILITY],
}

function request(overrides: Partial<SubcontractContractCommandRequestDTO> = {}): SubcontractContractCommandRequestDTO {
  return {
    workspaceId: SESSION.workspaceId,
    actorId: SESSION.actorId,
    requiredCapability: SUBCONTRACT_CONTRACT_WRITE_CAPABILITY,
    commandId: 'subcontract-command-create-1',
    baseVersion: null,
    action: 'submit',
    draft: {
      no: 'FB-CENTRAL-001',
      name: '中央新建劳务分包合同',
      projectId: 'project-1',
      supplierId: 'supplier-1',
      subKind: '劳务',
      content: '劳务分包',
      signDate: '2026-08-25',
      amount: 1000,
      status: '审批中',
    },
    attachments: {},
    ...overrides,
  }
}

describe('分包合同中央 command contract', () => {
  it('服务器分配 ID、重复 commandId 幂等，刷新可读取同一正式合同', async () => {
    const instance = createSubcontractContractCommandTestInstance({
      createId: () => 'subcontract-central-1',
      now: () => '2026-08-25T01:00:00.000Z',
      projects: [{ id: 'project-1', name: '中央项目' }],
      suppliers: [{ id: 'supplier-1', name: '中央劳务分供方' }],
    })

    const first = await instance.execute(request(), SESSION)
    const duplicate = await instance.execute(request(), SESSION)

    expect(duplicate).toEqual(first)
    expect(instance.rows()).toEqual([
      expect.objectContaining({
        id: 'subcontract-central-1',
        kind: '分包',
        subKind: '劳务',
        projectId: 'project-1',
        supplierId: 'supplier-1',
        settlementStatus: null,
        clearanceStatus: null,
      }),
    ])
    expect(instance.form('subcontract-central-1', SESSION)).toMatchObject({
      version: '1',
      draft: { id: 'subcontract-central-1', name: '中央新建劳务分包合同' },
    })
  })

  it('拒绝不存在的项目/分供方、非法分包分类和采购明细', async () => {
    const instance = createSubcontractContractCommandTestInstance({
      projects: [{ id: 'project-1', name: '中央项目' }],
      suppliers: [{ id: 'supplier-1', name: '中央劳务分供方' }],
    })
    await expect(instance.execute(request({ draft: { ...request().draft, supplierId: 'supplier-missing' } }), SESSION))
      .rejects
      .toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(instance.execute(request({ draft: { ...request().draft, subKind: '材料' } }), SESSION))
      .rejects
      .toMatchObject({ problem: { code: 'validation-failed' } })
    expect(() => parseSubcontractContractCommandRequest({
      ...request(),
      draft: { ...request().draft, lineItems: [{ materialName: '不应接受' }] },
    }, { kind: 'create' })).toThrowError(/不接受采购明细/)
  })

  it('拒绝过期 baseVersion，不以最后写入覆盖', async () => {
    const instance = createSubcontractContractCommandTestInstance({
      createId: () => 'subcontract-central-1',
      projects: [{ id: 'project-1', name: '中央项目' }],
      suppliers: [{ id: 'supplier-1', name: '中央劳务分供方' }],
    })
    await instance.execute(request(), SESSION)
    await instance.execute(request({
      id: 'subcontract-central-1',
      commandId: 'subcontract-command-update-1',
      baseVersion: '1',
      draft: { ...request().draft, id: 'subcontract-central-1', name: '最新版合同' },
    }), SESSION)

    await expect(instance.execute(request({
      id: 'subcontract-central-1',
      commandId: 'subcontract-command-stale-1',
      baseVersion: '1',
      draft: { ...request().draft, id: 'subcontract-central-1', name: '过期合同' },
    }), SESSION)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })
})
