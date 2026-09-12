import type { DomainRepositories } from '~/plugins/repositories'
import { describe, expect, it, vi } from 'vitest'
import { createTabRestoreValidator } from '~/lib/tabs/restore-target'

const descriptor = { key: '/subcontract/quantity/project-1/unit-1', fullPath: '/subcontract/quantity/project-1/unit-1?origin=real', title: '旧户名', origin: 'real' as const, targetVersion: 1, sourceVersion: 'old', updatedAt: 1, closable: true }
function setup() {
  const current = { data: { projectId: 'project-1', unit: { id: 'unit-1', name: '101户' } }, dataOrigin: 'real', sourceVersion: 'current', capabilities: ['quantity:read'] }
  const completion = vi.fn().mockResolvedValue(current)
  const capabilities = ['quantity:read']
  const validate = createTabRestoreValidator({ repositories: { quantity: { completion } } as unknown as DomainRepositories, capabilities: () => capabilities, includeDemo: () => false })
  return { validate, completion, current, capabilities }
}

describe('中央工程量户详情只读恢复', () => {
  it('刷新按当前项目与户读取，保留当前标题和版本', async () => {
    const { validate, completion } = setup()
    await expect(validate(descriptor)).resolves.toMatchObject({ state: 'resolved', fullPath: descriptor.fullPath, title: '101户', sourceVersion: 'current' })
    expect(completion).toHaveBeenCalledWith({ projectId: 'project-1', unitId: 'unit-1', origin: 'real', includeDemo: false }, { signal: undefined })
  })

  it.each(['project', 'unit', 'origin', 'permission'])('拒绝当前%s事实与旧路径不符', async (kind) => {
    const { validate, current } = setup()
    if (kind === 'project')
      current.data.projectId = 'other'
    if (kind === 'unit')
      current.data.unit.id = 'other'
    if (kind === 'origin')
      current.dataOrigin = 'demo'
    if (kind === 'permission')
      current.capabilities = []
    await expect(validate(descriptor)).resolves.toMatchObject({ state: kind === 'permission' ? 'forbidden' : 'mismatch' })
  })

  it('开始无权时不发领域读取', async () => {
    const { validate, completion, capabilities } = setup()
    capabilities.splice(0)
    await expect(validate(descriptor)).resolves.toMatchObject({ state: 'forbidden' })
    expect(completion).not.toHaveBeenCalled()
  })

  it('列表与户详情刷新后仍保留矩阵班组、月份和楼栋范围', async () => {
    const { validate } = setup()
    const filters = 'origin=real&project=project-1&building=building-1&month=2026-08&view=crew&trade=masonry&assignee=crew%3Acrew-1'
    for (const path of ['/subcontract/quantity', descriptor.key]) {
      const fullPath = `${path}?${filters}`
      await expect(validate({ ...descriptor, key: path, fullPath })).resolves.toMatchObject({ state: 'resolved', fullPath })
    }
  })
  it('排程下钻到户详情冷读仍保留来源链，返回链接可以核对原工序', async () => {
    const { validate } = setup()
    const fullPath = `${descriptor.key}?origin=real&project=project-1&from=schedule&group=g&task=t&stage=s&item=i&buildings=b&month=2026-08&view=crew`
    await expect(validate({ ...descriptor, fullPath })).resolves.toMatchObject({ state: 'resolved', fullPath })
  })
})
