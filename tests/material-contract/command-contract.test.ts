import type { BusinessSession } from '../../server/utils/business-session'
import type { MaterialContractCommandRequestDTO } from '~/lib/material-contract/command-contract'
import { describe, expect, it } from 'vitest'
import { MATERIAL_CONTRACT_WRITE_CAPABILITY } from '~/lib/material-contract/command-contract'
import { parseMaterialContractCommandRequest } from '../../server/utils/material-contract-command-request'
import { createMaterialContractCommandTestInstance } from '../../server/utils/material-contract-command-test-instance'

const SESSION: BusinessSession = {
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  capabilities: ['material-contract:read', MATERIAL_CONTRACT_WRITE_CAPABILITY],
}

function request(
  overrides: Partial<MaterialContractCommandRequestDTO> = {},
): MaterialContractCommandRequestDTO {
  return {
    workspaceId: SESSION.workspaceId,
    actorId: SESSION.actorId,
    requiredCapability: MATERIAL_CONTRACT_WRITE_CAPABILITY,
    commandId: 'command-create-1',
    baseVersion: null,
    action: 'submit',
    draft: {
      no: 'CG-CENTRAL-001',
      name: '中央新建材料采购合同',
      projectId: 'project-1',
      supplierId: 'supplier-1',
      content: '瓷砖采购',
      signDate: '2026-08-24',
      amount: 255,
      status: '审批中',
      lineItems: [{
        materialName: '墙砖',
        spec: '600×600',
        unit: '㎡',
        qty: 10,
        taxInclusiveUnitPrice: 25.5,
        plannedArrivalDate: '2026-09-01',
      }],
    },
    attachments: {},
    ...overrides,
  }
}

describe('材料采购合同中央 command contract', () => {
  it('由服务器分配 ID，重复 commandId 不重复创建，刷新可读回合同与采购明细', async () => {
    const instance = createMaterialContractCommandTestInstance({
      createId: () => 'contract-central-1',
      createLineId: () => 'line-central-1',
      now: () => '2026-08-24T01:00:00.000Z',
      projects: [{ id: 'project-1', name: '中央项目' }],
      suppliers: [{ id: 'supplier-1', name: '中央分供方' }],
    })

    const first = await instance.execute(request(), SESSION)
    const duplicate = await instance.execute(request(), SESSION)

    expect(first).toEqual({
      id: 'contract-central-1',
      commandId: 'command-create-1',
      version: '1',
      updatedAt: '2026-08-24T01:00:00.000Z',
      attachmentIds: [],
    })
    expect(duplicate).toEqual(first)
    expect(instance.rows()).toHaveLength(1)
    expect(instance.form('contract-central-1', SESSION)).toMatchObject({
      version: '1',
      draft: {
        id: 'contract-central-1',
        projectId: 'project-1',
        supplierId: 'supplier-1',
        lineItems: [{ id: 'line-central-1', materialName: '墙砖', qty: 10 }],
      },
    })
    expect(instance.facts().lineItems).toEqual([
      expect.objectContaining({
        id: 'line-central-1',
        contractId: 'contract-central-1',
        qty: 10,
        taxInclusiveUnitPrice: 25.5,
      }),
    ])
  })

  it('拒绝过期 baseVersion，不以最后写入覆盖最新合同', async () => {
    const instance = createMaterialContractCommandTestInstance({
      createId: () => 'contract-central-1',
      now: () => '2026-08-24T01:00:00.000Z',
      projects: [{ id: 'project-1', name: '中央项目' }],
      suppliers: [{ id: 'supplier-1', name: '中央分供方' }],
    })
    await instance.execute(request(), SESSION)
    await instance.execute(request({
      id: 'contract-central-1',
      commandId: 'command-update-1',
      baseVersion: '1',
      draft: { ...request().draft, id: 'contract-central-1', name: '最新合同名称' },
    }), SESSION)

    await expect(instance.execute(request({
      id: 'contract-central-1',
      commandId: 'command-stale-1',
      baseVersion: '1',
      draft: { ...request().draft, id: 'contract-central-1', name: '过期覆盖名称' },
    }), SESSION)).rejects.toMatchObject({
      problem: { code: 'conflict' },
    })
    expect(instance.form('contract-central-1', SESSION).draft.name).toBe('最新合同名称')
  })

  it('区分新建与编辑信封，拒绝客户端指定或错配正式合同 ID', () => {
    expect(() => parseMaterialContractCommandRequest(request({ id: 'client-id' }), { kind: 'create' }))
      .toThrowError(/不得指定合同 ID/)
    expect(() => parseMaterialContractCommandRequest(request(), { kind: 'update', routeId: 'contract-1' }))
      .toThrowError(/必须携带合同 ID/)
    expect(() => parseMaterialContractCommandRequest(request({ id: 'contract-2' }), { kind: 'update', routeId: 'contract-1' }))
      .toThrowError(/地址与请求主体不一致/)
  })

  it('严格拒绝空 ID、畸形明细、附件数组和未知字段', () => {
    expect(() => parseMaterialContractCommandRequest(request({ id: '' }), { kind: 'create' }))
      .toThrowError(/不得指定合同 ID/)
    expect(() => parseMaterialContractCommandRequest(request({
      draft: { ...request().draft, lineItems: {} as never },
    }), { kind: 'create' })).toThrowError(/采购明细无效/)
    expect(() => parseMaterialContractCommandRequest(request({
      attachments: { add: {} as never },
    }), { kind: 'create' })).toThrowError(/新增附件无效/)
    expect(() => parseMaterialContractCommandRequest({
      ...request(),
      draft: { ...request().draft, injected: true },
    }, { kind: 'create' })).toThrowError(/未知材料采购合同字段/)
  })

  it('草稿也拒绝非法引用与负数，且新行 ID 只能由服务端分配', async () => {
    const lineIds = ['server-line-1', 'server-line-2']
    const instance = createMaterialContractCommandTestInstance({
      createId: () => 'contract-central-1',
      createLineId: () => lineIds.shift()!,
      projects: [{ id: 'project-1', name: '中央项目' }],
      suppliers: [{ id: 'supplier-1', name: '中央分供方' }],
    })
    await expect(instance.execute(request({
      action: 'draft',
      draft: { ...request().draft, projectId: 'missing-project', amount: -1 },
    }), SESSION)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })

    await instance.execute(request({
      action: 'draft',
      draft: {
        ...request().draft,
        lineItems: [{ ...request().draft.lineItems![0]!, id: 'client-line-id' }],
      },
    }), SESSION)
    expect(instance.form('contract-central-1', SESSION).draft.lineItems?.[0]?.id).toBe('server-line-1')

    await instance.execute(request({
      id: 'contract-central-1',
      commandId: 'command-update-line',
      baseVersion: '1',
      action: 'draft',
      draft: {
        ...instance.form('contract-central-1', SESSION).draft,
        lineItems: [{ ...request().draft.lineItems![0]!, id: 'foreign-line-id' }],
      },
    }), SESSION)
    expect(instance.form('contract-central-1', SESSION).draft.lineItems?.[0]?.id).toBe('server-line-2')
  })

  it('受控迁入既有合同时保留稳定 ID，重复迁入幂等且不生成正式 seed', () => {
    const instance = createMaterialContractCommandTestInstance({
      projects: [{ id: 'project-1', name: '中央项目' }],
      suppliers: [{ id: 'supplier-1', name: '中央分供方' }],
    })
    expect(instance.rows()).toEqual([])
    const record = {
      id: 'contract-existing-1',
      draft: {
        ...request().draft,
        id: 'contract-existing-1',
        lineItems: [{ ...request().draft.lineItems![0]!, id: 'line-existing-1' }],
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    }
    expect(instance.importExisting([record])).toEqual(['contract-existing-1'])
    expect(instance.importExisting([record])).toEqual([])
    expect(instance.form('contract-existing-1', SESSION).draft.lineItems?.[0]?.id).toBe('line-existing-1')
  })
})
