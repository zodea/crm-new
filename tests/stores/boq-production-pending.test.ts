// @vitest-environment jsdom
import type { ProductionBoqRead } from '../../app/lib/boq/production-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useProductionBoqStore } from '../../app/stores/boq-production'

const identity = { workspaceId: 'boq-workspace', actorId: 'boq-owner', capabilities: ['boq:read', 'boq:write'] }
const directory = () => ({ ...identity, sourceVersion: 'directory-source', contracts: [{ id: 'contract-one', projectId: 'project-one', projectName: '实际项目1', no: 'MAIN-1', name: '实际主合同1', status: '履约中', lineCount: 0 }, { id: 'contract-two', projectId: 'project-two', projectName: '实际项目2', no: 'MAIN-2', name: '实际主合同2', status: '履约中', lineCount: 0 }] })
const read = (projectId = 'project-one', contractId = 'contract-one'): ProductionBoqRead => ({ ...identity, projectId, contractId, origin: 'real', sourceVersion: 'actual-owned-source', contractVersion: 'actual-main', files: [], lines: [], prices: [], changes: [], monthlySourceState: 'unavailable' })
const targetRead = (): ProductionBoqRead => ({ ...read(), lines: [{ id: 'boq-line-one', projectId: 'project-one', contractId: 'contract-one', contractName: '实际主合同1', contractNo: 'MAIN-1', itemName: '实际零量', unit: '㎡', qty: 0, unitPrice: 17, approvedDeltaQty: 0, effectiveUnitPrice: 17, fileId: 'boq-file-one', changeId: null, itemId: null, section: '', trade: '', room: '', spec: '', multiplier: null, taxRate: null, ownerSupplied: false, recognizedQty: 0, recognizedUnitPrice: 17, traceKey: '实际原清单·2', sourceSheet: '实际原清单', sourceRow: 2, confirmedOriginal: true, version: 'saved-actual-line' }] })
const fetcher = vi.fn()
beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  vi.stubGlobal('$fetch', fetcher)
  fetcher.mockImplementation(async (url, options) => url === '/api/read/boq/catalog' ? directory() : url === '/api/read/boq/workspace' ? read(options.query.projectId, options.query.contractId) : Promise.reject(new Error('unexpected endpoint')))
})
afterEach(() => vi.unstubAllGlobals())
it('保存成功但读回失败仍保最小原号；cold store仅resolve原号后同源完整读取才清除', async () => {
  const store = useProductionBoqStore()
  await store.loadWorkspace('project-one', 'contract-one')
  let command: Record<string, any> | undefined
  let readFailed = false
  fetcher.mockImplementation(async (url, options) => {
    if (url === '/api/read/boq/catalog')
      return directory()
    if (url === '/api/commands/boq') {
      command = options.body
      readFailed = true
      return { ...identity, commandId: command!.commandId, projectId: 'project-one', contractId: 'contract-one', id: 'boq-line-one', action: 'patch-line', sourceVersion: 'saved' }
    }
    if (url === '/api/read/boq/workspace') {
      if (readFailed)
        throw new Error('saved but readonly read lost')
      return read()
    }
  })
  await expect(store.execute({ kind: 'patch-line', lineId: 'boq-line-one', version: 'line-actual', patch: { qty: 0 } })).rejects.toThrow('saved but readonly')
  const encoded = sessionStorage.getItem(sessionStorage.key(0)!)!
  expect(Object.keys(JSON.parse(encoded)).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'scopeId', 'targetId', 'workspaceId'])
  expect(encoded).not.toMatch(/"(?:qty|patch|sourceVersion|result)"\s*:/)
  readFailed = false
  setActivePinia(createPinia())
  const cold = useProductionBoqStore()
  await cold.loadWorkspace('project-one', 'contract-one')
  expect(cold.pending).toHaveLength(1)
  expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(encoded)
  let targetAvailable = false
  fetcher.mockImplementation(async (url) => {
    if (url === '/api/read/boq/catalog')
      return directory()
    if (url === '/api/read/boq/workspace')
      return targetAvailable ? targetRead() : read()
    if (url === '/api/commands/boq/resolve')
      return { outcome: 'applied', result: { ...identity, commandId: command!.commandId, projectId: 'project-one', contractId: 'contract-one', id: 'boq-line-one', action: 'patch-line', sourceVersion: 'saved' } }
    throw new Error('recovery must not resend the original write')
  })
  await expect(cold.recover(cold.pending[0]!)).rejects.toThrow('实际目标尚未完整读回')
  expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(encoded)
  expect(cold.savedCommands).toEqual([command!.commandId])
  targetAvailable = true
  await cold.recover(cold.pending[0]!)
  expect(cold.pending).toEqual([])
  expect(sessionStorage.length).toBe(0)
})

it('同编号同scope但错误action或line目标的假回执不能成为已保存结果', async () => {
  const store = useProductionBoqStore()
  await store.loadWorkspace('project-one', 'contract-one')
  fetcher.mockImplementation(async (url, options) => {
    if (url === '/api/commands/boq')
      return { ...identity, commandId: options.body.commandId, projectId: 'project-one', contractId: 'contract-one', id: 'another-line', action: 'patch-line', sourceVersion: 'fake' }
    throw new Error('unexpected recovery write')
  })
  await expect(store.execute({ kind: 'patch-line', lineId: 'boq-line-one', version: 'line-actual', patch: { qty: 0 } })).rejects.toThrow('实际目标与原提交不同')
  expect(store.savedCommands).toEqual([])
  expect(store.pending).toHaveLength(1)
  fetcher.mockImplementation(async (url) => {
    if (url === '/api/read/boq/catalog')
      return directory()
    if (url === '/api/commands/boq/resolve')
      return { outcome: 'applied', result: { ...identity, commandId: store.pending[0]!.commandId, projectId: 'project-one', contractId: 'contract-one', id: 'boq-line-one', action: 'delete-line', sourceVersion: 'fake' } }
    throw new Error('incorrect result must not read or resend write')
  })
  await expect(store.recover(store.pending[0]!)).rejects.toThrow('动作或实际目标')
  expect(store.pending).toHaveLength(1)
})
it('迟到原号恢复不能把另一当前project/Main页面切回原页', async () => {
  const store = useProductionBoqStore()
  await store.loadWorkspace('project-one', 'contract-one')
  fetcher.mockImplementation(async (url, options) => {
    if (url === '/api/read/boq/catalog')
      return directory()
    if (url === '/api/read/boq/workspace')
      return read(options.query.projectId, options.query.contractId)
    throw new Error('lost response')
  })
  await expect(store.execute({ kind: 'patch-line', lineId: 'boq-line-one', version: 'line-actual', patch: { qty: 0 } })).rejects.toThrow('lost response')
  const descriptor = store.pending[0]!
  let resolved: (value: unknown) => void = () => {}
  fetcher.mockImplementation(async (url, options) => {
    if (url === '/api/read/boq/catalog')
      return directory()
    if (url === '/api/read/boq/workspace')
      return read(options.query.projectId, options.query.contractId)
    if (url === '/api/commands/boq/resolve')
      return new Promise((resolve) => { resolved = resolve })
    throw new Error('unexpected endpoint')
  })
  const recovering = store.recover(descriptor)
  await vi.waitFor(() => expect(fetcher.mock.calls.some(call => call[0] === '/api/commands/boq/resolve')).toBe(true))
  await store.loadWorkspace('project-two', 'contract-two')
  resolved({ outcome: 'not-applied', commandId: descriptor.commandId })
  await recovering
  expect(store.workspace?.projectId).toBe('project-two')
  expect(store.workspace?.contractId).toBe('contract-two')
})
