import type { DomainRepositories } from '~/plugins/repositories'
import { describe, expect, it, vi } from 'vitest'
import { credentialProblem } from '~/lib/supplier/credential-contract'
import { createSupplierReturnTo } from '~/lib/supplier/return-context'
import { createTabRestoreValidator } from '~/lib/tabs/restore-target'
import { credentialSnapshot } from '../supplier/credential-ui-fixtures'

const descriptor = { key: '/base/supplier/credential/supplier-a', fullPath: '/base/supplier/credential/supplier-a?origin=real', title: '旧标题', origin: 'real' as const, targetVersion: 1, sourceVersion: '旧版本', updatedAt: 1, closable: true }
function setup(capabilities = ['supplier-credential:read'], includeDemo = false) {
  const read = vi.fn().mockResolvedValue(credentialSnapshot())
  const supplierGet = vi.fn()
  const validate = createTabRestoreValidator({ repositories: { supplierCredentials: { read }, supplierRead: { get: supplierGet } } as unknown as DomainRepositories, capabilities: () => capabilities, includeDemo: () => includeDemo })
  return { read, supplierGet, validate }
}

describe('中央证照独立页签恢复', () => {
  it('证照返回主档后冷刷新仍保留同身份的列表筛选位置', async () => {
    const { validate, supplierGet } = setup(['supplier:list:read'])
    supplierGet.mockResolvedValue({ supplier: { id: 'supplier-a', name: '分供方' }, dataOrigin: 'real', capabilities: ['supplier:list:read'], sourceVersion: 's1' })
    const returnTo = createSupplierReturnTo('real:supplier-a', { search: '中央链路', category: [], credentialStatus: [], page: 1, pageSize: 20, sort: 'updated-desc' })
    const fullPath = `/base/supplier/supplier-a?origin=real&returnTo=${encodeURIComponent(returnTo)}`
    await expect(validate({ ...descriptor, key: '/base/supplier/supplier-a', fullPath })).resolves.toMatchObject({ state: 'resolved', fullPath })
  })

  it('冷刷新读取专用中央证照，停留原页并刷新真实标题和版本', async () => {
    const { read, supplierGet, validate } = setup()
    await expect(validate(descriptor)).resolves.toMatchObject({ state: 'resolved', fullPath: descriptor.fullPath, title: '合成分供方 A · 证照附件', sourceVersion: 'credential-v1' })
    expect(read).toHaveBeenCalledWith('supplier-a', 'real', { signal: undefined })
    expect(supplierGet).not.toHaveBeenCalled()
  })

  it('当前权限和服务端专用权限都复验，主档可读不等于证照可读', async () => {
    const local = setup(['supplier:list:read'])
    await expect(local.validate(descriptor)).resolves.toMatchObject({ state: 'forbidden' })
    expect(local.read).not.toHaveBeenCalled()
    const server = setup()
    server.read.mockResolvedValue(credentialSnapshot({ capabilities: ['supplier:list:read'] }))
    await expect(server.validate(descriptor)).resolves.toMatchObject({ state: 'forbidden' })
    expect(server.supplierGet).not.toHaveBeenCalled()
  })

  it.each([
    { reason: '其他分供方', patch: { supplierId: 'supplier-b' } },
    { reason: '演示来源', patch: { dataOrigin: 'demo' as const } },
  ])('专用读面返回$reason时拒绝恢复', async ({ patch }) => {
    const { read, validate } = setup()
    read.mockResolvedValue(credentialSnapshot(patch))
    await expect(validate(descriptor)).resolves.toMatchObject({ state: 'mismatch' })
  })

  it('专用读面删除与错误分别保留，不借主档兜底', async () => {
    const { read, supplierGet, validate } = setup()
    read.mockRejectedValueOnce(credentialProblem('not-found', '分供方已删除'))
    await expect(validate(descriptor)).resolves.toMatchObject({ state: 'not-found' })
    read.mockRejectedValueOnce(credentialProblem('unavailable', '原件服务不可用'))
    await expect(validate(descriptor)).resolves.toMatchObject({ state: 'error' })
    expect(supplierGet).not.toHaveBeenCalled()
  })

  it('授权演示来源才恢复演示只读页', async () => {
    const demo = { ...descriptor, origin: 'demo' as const, fullPath: '/base/supplier/credential/supplier-a?origin=demo' }
    const blocked = setup()
    await expect(blocked.validate(demo)).resolves.toMatchObject({ state: 'forbidden' })
    expect(blocked.read).not.toHaveBeenCalled()
    const allowed = setup(['supplier-credential:read', 'demo:read'], true)
    allowed.read.mockResolvedValue(credentialSnapshot({ dataOrigin: 'demo', capabilities: ['supplier-credential:read', 'demo:read'] }))
    await expect(allowed.validate(demo)).resolves.toMatchObject({ state: 'resolved', fullPath: demo.fullPath })
    expect(allowed.read).toHaveBeenCalledWith('supplier-a', 'demo', { signal: undefined })
  })

  const list = createSupplierReturnTo('real:supplier-a', { search: '合成', category: [], credentialStatus: [], page: 2, pageSize: 20, sort: 'updated-desc' })
  const detail = `/base/supplier/supplier-a?origin=real&returnTo=${encodeURIComponent(list)}`

  it.each([
    { page: '分供方列表', returnTo: list },
    { page: '同一分供方详情', returnTo: detail },
  ])('返回$page时保留原位置', async ({ returnTo }) => {
    const { validate } = setup()
    const result = await validate({ ...descriptor, fullPath: `${descriptor.fullPath}&returnTo=${encodeURIComponent(returnTo)}` })
    expect(result.state).toBe('resolved')
    if (result.state === 'resolved')
      expect(new URL(result.fullPath, 'https://example.test').searchParams.get('returnTo')).toBe(returnTo)
  })

  it.each([
    { reason: '其他分供方详情', returnTo: '/base/supplier/supplier-b?origin=real' },
    { reason: '演示来源详情', returnTo: '/base/supplier/supplier-a?origin=demo' },
    { reason: '演示来源列表', returnTo: createSupplierReturnTo('demo:supplier-a', { search: '', category: [], credentialStatus: [], page: 1, pageSize: 20, sort: 'updated-desc' }) },
    { reason: '其他分供方列表', returnTo: createSupplierReturnTo('real:supplier-b', { search: '', category: [], credentialStatus: [], page: 1, pageSize: 20, sort: 'updated-desc' }) },
    { reason: '外部网站', returnTo: 'https://external.example/credentials' },
  ])('去除指向$reason的返回地址', async ({ returnTo }) => {
    const { validate } = setup()
    const result = await validate({ ...descriptor, fullPath: `${descriptor.fullPath}&returnTo=${encodeURIComponent(returnTo)}` })
    expect(result).toMatchObject({ state: 'resolved', fullPath: descriptor.fullPath })
  })

  it('恢复中取消后迟到专用读面不能重新打开页签', async () => {
    const { read, validate } = setup()
    let finish!: (value: unknown) => void
    read.mockImplementation(() => new Promise((resolve) => {
      finish = resolve
    }))
    const controller = new AbortController()
    const pending = validate(descriptor, controller.signal)
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    controller.abort()
    finish(credentialSnapshot())
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
