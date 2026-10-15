import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import { useDeliveryReferences } from '~/composables/useDeliveryReferences'

function setup() {
  const load = vi.fn().mockResolvedValue(undefined)
  const central = reactive({ origin: 'real', canWrite: true, load, context: { projects: [{ id: 'p', name: '中央项目', dataOrigin: 'real' }], suppliers: [{ id: 's', name: '中央分供方', dataOrigin: 'real', aliases: ['简称'] }] }, list: [{ projectId: 'p', rawSiteText: '北门', dataOrigin: 'real', currentValuesConfirmed: true, archived: true }] })
  const draft = { id: 's', name: '中央分供方', aliases: ['简称'], contactName: '既有经办' }
  const commands = { createSession: vi.fn(() => ({ baseVersion: 'v3' })), hydrate: vi.fn().mockResolvedValue({ draft }), saveForm: vi.fn().mockResolvedValue({ id: 's' }) }
  vi.stubGlobal('useDeliveryRecordStore', () => central)
  vi.stubGlobal('useSupplierCommandStore', () => commands)
  let api!: ReturnType<typeof useDeliveryReferences>
  const view = mount(defineComponent({ setup() {
    api = useDeliveryReferences()
    return () => h('div')
  } }))
  return { view, api, central, load, commands, draft }
}
afterEach(() => vi.unstubAllGlobals())

describe('送货处理区中央资料与独立别名保存', () => {
  it('归档前共享读取失败也暴露原地重试原因，重读成功后恢复可写', async () => {
    const { api, central, load, view } = setup()
    await flushPromises()
    Object.assign(central, { error: '归档前读取权限已变化', canWrite: false, context: null })
    expect(api.readError.value).toBe('归档前读取权限已变化')
    expect(api.canWrite.value).toBe(false)
    load.mockImplementationOnce(async () => {
      Object.assign(central, { error: '', canWrite: true })
    })
    await api.reload()
    expect(api.readError.value).toBe('')
    expect(api.canWrite.value).toBe(true)
    view.unmount()
  })
  it('只从当前中央资料和人工确认送货派生候选，读取失败立即撤下候选', async () => {
    const { api, load, view } = setup()
    await flushPromises()
    expect(api.projects.value).toEqual([{ id: 'p', name: '中央项目', dataOrigin: 'real' }])
    expect(api.projectCandidates.value).toEqual([{ id: 'p', name: '中央项目', aliases: ['北门'] }])
    expect(api.suppliers.value[0]?.aliases).toEqual(['简称'])
    load.mockRejectedValueOnce(new Error('当前中央权限已撤销'))
    await api.reload()
    expect(api.projects.value).toEqual([])
    expect(api.suppliers.value).toEqual([])
    expect(api.readError.value).toContain('当前中央权限已撤销')
    view.unmount()
  })

  it('独立记忆分供方别名使用当前稳定 ID 和新读取的版本草稿，保留其他资料', async () => {
    const { api, commands, draft, view } = setup()
    await flushPromises()
    await api.rememberSupplierAlias('s', '送货新抬头')
    const session = commands.createSession.mock.results[0]!.value
    expect(commands.hydrate).toHaveBeenCalledWith(session, 's')
    expect(commands.saveForm).toHaveBeenCalledWith(session, { ...draft, aliases: ['简称', '送货新抬头'] }, 'draft', {})
    view.unmount()
  })

  it('别名读取期间切换来源不再提交后续主数据写入', async () => {
    const { api, commands, central, draft, view } = setup()
    await flushPromises()
    let resolve!: (value: { draft: typeof draft }) => void
    commands.hydrate.mockImplementationOnce(() => new Promise((done) => {
      resolve = done
    }))
    const pending = api.rememberSupplierAlias('s', '送货新抬头')
    const rejected = expect(pending).rejects.toThrow('来源')
    central.origin = 'demo'
    await flushPromises()
    resolve({ draft })
    await rejected
    expect(commands.saveForm).not.toHaveBeenCalled()
    view.unmount()
  })
})
