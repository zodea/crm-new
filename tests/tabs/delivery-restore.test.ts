import type { DomainRepositories } from '~/plugins/repositories'
import { describe, expect, it, vi } from 'vitest'
import { deliveryProblem } from '~/lib/delivery-record/contract'
import { createTabRestoreValidator } from '~/lib/tabs/restore-target'

const descriptor = { key: '/material/delivery/archive/delivery-1', fullPath: '/material/delivery/archive/delivery-1?origin=real', title: '旧名称', origin: 'real' as const, targetVersion: 1, sourceVersion: '1', updatedAt: 1, closable: true }
const capabilities = ['delivery:read', 'project:list:read', 'supplier:list:read', 'demo:read']
function setup(currentCapabilities = capabilities, includeDemo = true) {
  const current = { id: 'delivery-1', orderNo: 'DL-441-current', dataOrigin: 'real', version: '3', deletedAt: null }
  const context = vi.fn().mockResolvedValue({ capabilities })
  const detail = vi.fn().mockResolvedValue(current)
  const validate = createTabRestoreValidator({
    repositories: { deliveries: { context, detail } } as unknown as DomainRepositories,
    capabilities: () => currentCapabilities,
    includeDemo: () => includeDemo,
  })
  return { validate, context, detail, current }
}

describe('送货详情页签按中央当前记录恢复', () => {
  it('刷新重新读取当前单号和修订版本，经唯一目标登记恢复相同逻辑单', async () => {
    const { validate, context, detail } = setup()
    await expect(validate(descriptor)).resolves.toMatchObject({ state: 'resolved', fullPath: descriptor.fullPath, title: 'DL-441-current', sourceVersion: '3' })
    expect(context).toHaveBeenCalledWith('real', { signal: undefined })
    expect(detail).toHaveBeenCalledWith('delivery-1', 'real', { signal: undefined })
  })

  it('会话撤权时列表及详情都不恢复，服务端重读撤权同样停止加载记录', async () => {
    const forbidden = setup([])
    await expect(forbidden.validate(descriptor)).resolves.toMatchObject({ state: 'forbidden' })
    await expect(forbidden.validate({ ...descriptor, fullPath: '/material/delivery/archive?origin=real' })).resolves.toMatchObject({ state: 'forbidden' })
    expect(forbidden.context).not.toHaveBeenCalled()
    const changed = setup()
    changed.context.mockResolvedValue({ capabilities: [] })
    await expect(changed.validate(descriptor)).resolves.toMatchObject({ state: 'forbidden' })
    expect(changed.detail).not.toHaveBeenCalled()
  })

  it.each([
    { data: { id: 'same-name-other-id' }, state: 'mismatch' },
    { data: { dataOrigin: 'demo' }, state: 'mismatch' },
    { data: { deletedAt: '2026-09-11T00:00:00Z' }, state: 'not-found' },
  ])('拒绝当前记录身份、来源或删除状态不符：$state $data', async ({ data, state }) => {
    const { validate, detail, current } = setup()
    detail.mockResolvedValue({ ...current, ...data })
    await expect(validate(descriptor)).resolves.toMatchObject({ state })
  })

  it.each(['forbidden', 'not-found', 'relationship-mismatch'] as const)('服务端当前祖先校验拒绝 %s 时不拿旧标题或同名本地目标兜底', async (code) => {
    const { validate, detail } = setup()
    detail.mockRejectedValue(deliveryProblem(code, '当前读取被拒绝'))
    const result = await validate(descriptor)
    expect(result).toMatchObject({ state: code === 'relationship-mismatch' ? 'mismatch' : code })
    expect(JSON.stringify(result)).not.toContain('旧名称')
  })

  it('取消详情读取后，即使接口迟到返回也不产生可应用的恢复结果', async () => {
    const { validate, detail, current } = setup()
    let complete!: (value: typeof current) => void
    detail.mockImplementation(() => new Promise((resolve) => {
      complete = resolve
    }))
    const controller = new AbortController()
    const pending = validate(descriptor, controller.signal)
    await vi.waitFor(() => expect(detail).toHaveBeenCalledOnce())
    controller.abort()
    complete(current)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('未开启演示时不恢复演示详情，已开启时严格保留演示来源', async () => {
    const demo = { ...descriptor, fullPath: descriptor.fullPath.replace('real', 'demo'), origin: 'demo' as const }
    const disabled = setup(capabilities, false)
    await expect(disabled.validate(demo)).resolves.toMatchObject({ state: 'forbidden' })
    expect(disabled.context).not.toHaveBeenCalled()
    const enabled = setup()
    enabled.detail.mockResolvedValue({ ...enabled.current, dataOrigin: 'demo' })
    await expect(enabled.validate(demo)).resolves.toMatchObject({ state: 'resolved', fullPath: demo.fullPath })
    expect(enabled.detail).toHaveBeenCalledWith('delivery-1', 'demo', { signal: undefined })
  })
})
