import type { DeliveryCommand, DeliveryContext } from '~/lib/delivery-record/contract'
import type { DeliveryRepository } from '~/lib/delivery-record/repository'
import { describe, expect, it, vi } from 'vitest'
import { watchEffect } from 'vue'
import { createDeliveryRecordState } from '~/lib/delivery-record/state'
import { createDeliveryCommandService } from '../../server/utils/delivery-command-service'

const session = { workspaceId: 'w', actorId: 'a', capabilities: ['delivery:read', 'delivery:write', 'project:list:read', 'supplier:list:read'] }
const input = { projectId: 'p', supplierId: 's', orderNo: 'D-1', deliveryDate: '2026-09-11', note: '', lines: [{ materialName: '材料', spec: '', unit: '吨', qty: 1, unitPrice: 2, amount: 2, note: '' }] }
function setup() {
  let next = 0
  const service = createDeliveryCommandService({ references: () => ({ projects: [{ id: 'p', name: '中央项目', dataOrigin: 'real' }], suppliers: [{ id: 's', name: '中央分供方', dataOrigin: 'real' }] }), createId: () => `state-${++next}` })
  const repository: DeliveryRepository = {
    context: vi.fn(async () => service.context(session)),
    list: vi.fn(async () => service.list(session)),
    detail: vi.fn(async id => service.detail(id, session)),
    history: vi.fn(async id => service.history(id, session)),
    execute: vi.fn(async body => service.execute(body, session)),
    fileContent: vi.fn(),
  }
  const state = createDeliveryRecordState(repository, () => 'real', () => `command-${++next}`)
  return { state, service, repository }
}

describe('送货浏览器中央状态', () => {
  it('页面先观察权限再读取及归档前重读时，可写状态随当前来源恢复', async () => {
    const { state, repository } = setup()
    const observed: boolean[] = []
    const stop = watchEffect(() => {
      observed.push(state.canWrite.value)
    }, { flush: 'sync' })
    try {
      expect(observed.at(-1)).toBe(false)
      await state.load()
      expect(observed.at(-1)).toBe(true)
      await state.load()
      expect(observed.at(-1)).toBe(true)
      await state.add(input)
      expect(state.list.value).toHaveLength(1)
      vi.mocked(repository.context).mockRejectedValueOnce(new Error('权限已撤销'))
      await expect(state.load()).rejects.toThrow('权限已撤销')
      expect(observed.at(-1)).toBe(false)
    }
    finally { stop() }
  })
  it('显式历史缺原件仍重验记录，但不能借用当前原件', async () => {
    const { state, repository } = setup()
    const id = await state.add(input)
    const current = state.byId(id)!
    vi.mocked(repository.detail).mockResolvedValue({ ...current, assetId: 'new-asset', hasSourceFile: true })
    expect(await state.loadSourceFile(id, { assetId: null })).toBeNull()
    expect(repository.detail).toHaveBeenCalledWith(id, 'real', expect.anything())
    expect(repository.fileContent).not.toHaveBeenCalled()
  })

  it('原件正文在来源切换后迟到，不再作为可下载结果返回', async () => {
    const { repository } = setup()
    let origin: 'real' | 'demo' = 'real'
    const state = createDeliveryRecordState(repository, () => origin)
    const id = await state.add(input)
    vi.mocked(repository.detail).mockResolvedValue({ ...state.byId(id)!, assetId: 'asset' })
    let resolve!: (value: Awaited<ReturnType<DeliveryRepository['fileContent']>>) => void
    vi.mocked(repository.fileContent).mockImplementation(() => new Promise(done => resolve = done))
    const pending = state.loadSourceFile(id)
    await vi.waitFor(() => expect(repository.fileContent).toHaveBeenCalled())
    origin = 'demo'
    resolve({ assetId: 'asset', fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 1, sha256: '', bytes: new Uint8Array([1]) })
    await expect(pending.then(() => undefined)).rejects.toThrow('来源')
  })

  it('归档后列表、历史、修订与撤回使用同一中央身份', async () => {
    const { state, service } = setup()
    const id = await state.add(input)
    expect(state.byId(id)?.projectName).toBe('中央项目')
    const revision = await state.update(id, { ...input, note: '修订后' }, '对照原件', '1')
    expect((await state.history(id))).toHaveLength(2)
    expect(service.detail(id, session).note).toBe('修订后')
    expect(await state.undo(revision)).toBe(true)
    expect(state.byId(id)?.note).toBe('')
  })

  it('服务端已成功而响应丢失，重试同一输入复用命令，不重复建档', async () => {
    const { state, repository, service } = setup()
    let lost = true
    vi.mocked(repository.execute).mockImplementation(async (command) => {
      const result = service.execute(command, session)
      if (lost) {
        lost = false
        throw new Error('响应丢失')
      }
      return result
    })
    await expect(state.add(input)).rejects.toThrow('响应丢失')
    const id = await state.add(input)
    expect(service.list(session).records).toHaveLength(1)
    expect(state.byId(id)?.orderNo).toBe('D-1')
    const calls = vi.mocked(repository.execute).mock.calls
    expect((calls[0]![0] as DeliveryCommand).commandId).toBe(calls[1]![0].commandId)
  })

  it('明确版本冲突后，重新读取并确认相同目标草稿可以使用当前版本提交', async () => {
    const { state, repository, service } = setup()
    const id = await state.add(input)
    const other = createDeliveryRecordState(repository, () => 'real', () => 'other-command')
    await other.load()
    await other.update(id, { ...input, note: '其他经办先修订' }, '另一处核对', '1')
    await expect(state.update(id, { ...input, note: '我的目标草稿' }, '重新核对', '1')).rejects.toThrow('已更新')
    await state.load()
    expect(state.byId(id)?.version).toBe('2')
    await state.update(id, { ...input, note: '我的目标草稿' }, '重新核对', '2')
    expect(service.detail(id, session)).toMatchObject({ note: '我的目标草稿', version: '3' })
    expect(service.history(id, session)).toHaveLength(3)
    const calls = vi.mocked(repository.execute).mock.calls
    expect(calls.at(-1)![0].commandId).not.toBe(calls.at(-2)![0].commandId)
  })

  it('加载失败撤下旧列表和权限，保存不会使用旧会话回落本机', async () => {
    const { state, repository } = setup()
    await state.add(input)
    vi.mocked(repository.context).mockRejectedValue(new Error('读取无权'))
    await expect(state.load()).rejects.toThrow('无权')
    expect(state.list.value).toEqual([])
    expect(state.context.value).toBeNull()
    await expect(state.add({ ...input, orderNo: 'D-2' })).rejects.toThrow('无权')
    expect(repository.execute).toHaveBeenCalledTimes(1)
  })

  it('保存已落中央而回读失败后，重试仍使用原版本命令而不新增第二条修订', async () => {
    const { state, repository, service } = setup()
    const id = await state.add(input)
    vi.mocked(repository.list).mockRejectedValueOnce(new Error('回读失败'))
    await expect(state.update(id, { ...input, note: '修订' }, '核对')).rejects.toThrow('回读失败')
    await state.update(id, { ...input, note: '修订' }, '核对')
    expect(service.detail(id, session).version).toBe('2')
    expect(service.history(id, session)).toHaveLength(2)
  })

  it('同一来源并发加载只发布一次完整上下文，取消旧来源的迟到响应', async () => {
    const { repository } = setup()
    let origin: 'real' | 'demo' = 'real'
    let resolve!: (value: DeliveryContext) => void
    vi.mocked(repository.context).mockImplementationOnce(() => new Promise(done => resolve = done))
    const state = createDeliveryRecordState(repository, () => origin)
    const first = state.load()
    const second = state.load()
    origin = 'demo'
    vi.mocked(repository.context).mockResolvedValue({ ...session, projects: [], suppliers: [], capabilities: ['demo:read'] })
    vi.mocked(repository.list).mockResolvedValue({ records: [], sourceVersion: 'demo', capabilities: ['demo:read'] })
    await state.load()
    resolve({ ...session, projects: [{ id: 'p', name: '迟到正式项目', dataOrigin: 'real' }], suppliers: [] })
    await Promise.allSettled([first, second])
    expect(repository.context).toHaveBeenCalledTimes(2)
    expect(state.context.value?.projects).toEqual([])
    expect(state.canWrite.value).toBe(false)
  })

  it('文件读取期间改动来源或输入，不把新草稿混入旧保存意图', async () => {
    const { repository } = setup()
    let origin: 'real' | 'demo' = 'real'
    const state = createDeliveryRecordState(repository, () => origin)
    await state.load()
    let finish!: (value: ArrayBuffer) => void
    const file = new File(['%PDF-1.7\n%%EOF'], 'a.pdf', { type: 'application/pdf' })
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise(resolve => finish = resolve))
    const edited = structuredClone(input)
    const pending = state.add(edited, file)
    await vi.waitFor(() => expect(file.arrayBuffer).toHaveBeenCalled())
    edited.note = '保存发出后新输入'
    origin = 'demo'
    finish(new TextEncoder().encode('%PDF-1.7\n%%EOF').buffer)
    await expect(pending).rejects.toThrow('来源')
    expect(repository.execute).not.toHaveBeenCalled()
  })
})
