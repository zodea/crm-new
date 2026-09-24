import type { DomainRepositories } from '~/plugins/repositories'
import { describe, expect, it, vi } from 'vitest'
import { processLibraryProblem } from '~/lib/schedule/process-library-contract'
import { createTabRestoreValidator, inspectRestorableTabPath } from '~/lib/tabs/restore-target'

const descriptor = { key: '/schedule/process-library/lib', fullPath: '/schedule/process-library/lib?origin=real', title: '旧标题', origin: 'real' as const, targetVersion: 1, sourceVersion: '1', updatedAt: 1, closable: true }
function setup(capabilities = ['process-library:read']) {
  const list = vi.fn().mockResolvedValue({ capabilities })
  const detail = vi.fn().mockResolvedValue({ id: 'lib', name: '不可变旧版', version: 3, sourceVersion: '3', dataOrigin: 'real' })
  const validate = createTabRestoreValidator({ repositories: { processLibraries: { list, detail } } as unknown as DomainRepositories, capabilities: () => capabilities, includeDemo: () => false })
  return { list, detail, validate }
}

describe('中央工序库只读详情恢复', () => {
  it('冷刷新重新检查权限和稳定身份，写表单不能恢复', async () => {
    const { validate, list, detail } = setup()
    await expect(validate(descriptor)).resolves.toMatchObject({ state: 'resolved', fullPath: descriptor.fullPath, title: '不可变旧版 v3', sourceVersion: '3' })
    expect(list).toHaveBeenCalledWith('real', { signal: undefined })
    expect(detail).toHaveBeenCalledWith('lib', 'real', { signal: undefined })
    expect(inspectRestorableTabPath('/schedule/process-library/form?source=lib&origin=real')).toBeNull()
  })
  it('列表与详情撤权均拒绝，旧版已删除也不恢复旧标题', async () => {
    const blocked = setup([])
    await expect(blocked.validate(descriptor)).resolves.toMatchObject({ state: 'forbidden' })
    await expect(blocked.validate({ ...descriptor, fullPath: '/schedule/process-library?origin=real' })).resolves.toMatchObject({ state: 'forbidden' })
    const server = setup()
    server.detail.mockRejectedValue(processLibraryProblem('not-found', '已删除'))
    await expect(server.validate(descriptor)).resolves.toMatchObject({ state: 'not-found' })
  })
  it('取消后的迟到返回不能恢复页签', async () => {
    const { validate, detail } = setup()
    let release!: (value: unknown) => void
    detail.mockImplementation(() => new Promise(resolve => release = resolve))
    const controller = new AbortController()
    const pending = validate(descriptor, controller.signal)
    await vi.waitFor(() => expect(detail).toHaveBeenCalledOnce())
    controller.abort()
    release({ id: 'lib', name: '旧版', version: 3, sourceVersion: '3', dataOrigin: 'real' })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
