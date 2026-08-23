import { describe, expect, it } from 'vitest'
import {
  CREW_WRITE_CAPABILITY,
  WORKER_WRITE_CAPABILITY,
} from '~/lib/crew-worker/command-contract'
import { formDefaults } from '~/lib/master-data/page'
import { createCrewWorkerCommandTestInstance } from '../../server/utils/crew-worker-command-test-instance'
import { createCrewWorkerReadTestInstance } from '../../server/utils/crew-worker-read-test-instance'

const session = {
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  capabilities: [CREW_WRITE_CAPABILITY, WORKER_WRITE_CAPABILITY],
}

describe('班组—工人中央 command 测试实例', () => {
  it('由服务器分配稳定 ID，幂等创建，并用 baseVersion 保护显式编辑', async () => {
    let sequence = 0
    const instance = createCrewWorkerCommandTestInstance({
      createId: kind => `${kind}-${++sequence}`,
      now: () => '2026-08-23T00:00:00.000Z',
    })
    const crewDraft = {
      ...formDefaults('crew'),
      name: '中央泥水班组',
      trade: '泥工',
      contactName: '陈师傅',
      contactPhone: '13812345678',
    }
    const crewRequest = {
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: CREW_WRITE_CAPABILITY,
      commandId: 'command-create-crew',
      baseVersion: null,
      action: 'save' as const,
      draft: crewDraft,
      attachments: {},
    }

    const createdCrew = await instance.executeCrew(crewRequest, session)
    expect(createdCrew).toMatchObject({ id: 'crew-1', version: '1' })
    await expect(instance.executeCrew(crewRequest, session)).resolves.toEqual(createdCrew)
    expect(instance.crewRows()).toHaveLength(1)

    const workerDraft = {
      ...formDefaults('worker'),
      name: '张三',
      phone: '13912345678',
      trade: '泥工',
      bankName: '某银行',
      bankAccount: '6222021234567890',
      crewId: createdCrew.id,
    }
    const createdWorker = await instance.executeWorker({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: WORKER_WRITE_CAPABILITY,
      commandId: 'command-create-worker',
      baseVersion: null,
      action: 'save',
      draft: workerDraft,
      attachments: {},
    }, session)
    expect(createdWorker).toMatchObject({ id: 'worker-2', version: '1' })
    expect(instance.workerRows()[0]).toMatchObject({ id: 'worker-2', crewId: 'crew-1' })

    await expect(instance.executeCrew({
      ...crewRequest,
      id: createdCrew.id,
      commandId: 'command-stale-edit',
      baseVersion: '0',
      draft: { ...crewDraft, id: createdCrew.id, name: '不应覆盖' },
    }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(instance.crewRows()[0]?.name).toBe('中央泥水班组')
  })
})

describe('班组—工人中央 read 测试实例', () => {
  it('通过同一中央接缝返回演示关系，并区分空、禁止与来源错配', async () => {
    const instance = createCrewWorkerReadTestInstance(
      () => ['crew:list:read', 'worker:list:read', 'demo:read'],
      () => [],
      () => [],
      () => 'formal-v0',
    )

    const crews = await instance.listCrews({ includeDemo: 'true' })
    expect(crews.items.some(item => item.crew.id === 'crew_demo_001')).toBe(true)
    const worker = await instance.workerDetail('wkr_demo_001', { origin: 'demo', includeDemo: 'true' })
    expect(worker.assignments[0]).toMatchObject({ unit: { entity: 'quantity-unit' } })
    expect(worker.wageStatements[0]).toMatchObject({ statement: { entity: 'wage-statement' } })
    expect(worker.penalties[0]).toMatchObject({ penalty: { entity: 'subcontract-document' } })
    await expect(instance.relationFactIdentity('wage', 'wage-demo-1', { origin: 'demo', includeDemo: 'true' }))
      .resolves
      .toMatchObject({
        projectId: 'proj_demo_001',
        owners: [{ kind: 'crew', id: 'crew_demo_001' }, { kind: 'worker', id: 'wkr_demo_001' }],
      })
    await expect(instance.relationFactIdentity('assignment', 'qty_u_1_02_01', { origin: 'demo', includeDemo: 'true' }))
      .resolves
      .toMatchObject({
        projectId: 'proj_demo_001',
        owners: [{ kind: 'crew', id: 'crew_demo_001' }, { kind: 'worker', id: 'wkr_demo_001' }],
      })
    await expect(instance.relationFactIdentity('wage', 'not-there', { origin: 'demo', includeDemo: 'true' }))
      .rejects
      .toMatchObject({ problem: { code: 'not-found' } })

    await expect(instance.workerDetail('wkr_demo_001', { origin: 'real', includeDemo: 'true' }))
      .rejects
      .toMatchObject({ problem: { code: 'relationship-mismatch' } })
    instance.reset('empty')
    await expect(instance.listWorkers({})).resolves.toMatchObject({ items: [], empty: { reason: 'no-records' } })
    instance.reset('forbidden')
    await expect(instance.listCrews({})).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })
})
