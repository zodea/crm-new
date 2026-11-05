import type { OwnerDocumentListRecord } from '~/lib/owner-document/forms'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ownerCommercialDocumentProblem, OwnerCommercialDocumentRepositoryProblem } from '~/lib/owner-document/central-repository'
import { useOwnerDocumentStore } from '~/stores/owner-document'

const ownerDocumentStoreMocks = vi.hoisted(() => ({
  listResponses: [] as Array<() => Promise<OwnerDocumentListRecord[]>>,
  saveResult: { id: 'saved-1', logIds: [] as string[] },
}))

vi.mock('~/lib/owner-document/forms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/owner-document/forms')>()
  return {
    ...actual,
    listOwnerDocumentForms: vi.fn(async () => {
      const response = ownerDocumentStoreMocks.listResponses.shift()
      return response ? response() : []
    }),
    saveOwnerDocumentForm: vi.fn(async () => ownerDocumentStoreMocks.saveResult),
  }
})

function row(id: string): OwnerDocumentListRecord {
  return {
    id,
    no: id,
    name: id,
    projectId: null,
    projectName: '',
    contractId: null,
    contractName: '',
    supplierId: null,
    supplierName: '',
    crewId: null,
    crewName: '',
    type: '',
    period: '',
    amount: 0,
    secondaryAmount: 0,
    tertiaryAmount: 0,
    quantity: null,
    date: '',
    status: 'draft',
  }
}

describe('owner document store list state', () => {
  beforeEach(() => {
    ownerDocumentStoreMocks.listResponses = []
    ownerDocumentStoreMocks.saveResult = { id: 'saved-1', logIds: [] }
    setActivePinia(createPinia())
  })

  it('列表按类型隔离 loading/error，并只采纳同类型最新请求', async () => {
    let resolveFirst!: (rows: OwnerDocumentListRecord[]) => void
    const firstRows = new Promise<OwnerDocumentListRecord[]>((resolve) => {
      resolveFirst = resolve
    })
    ownerDocumentStoreMocks.listResponses.push(
      () => firstRows,
      async () => [row('new')],
    )
    const store = useOwnerDocumentStore()

    const firstLoad = store.loadKind('owner_change')
    expect(store.loading).toBe(false)
    expect(store.listLoadingFor('owner_change')).toBe(true)
    expect(store.listLoadingFor('owner_report')).toBe(false)

    await store.loadKind('owner_change')
    resolveFirst([row('old')])
    await firstLoad

    expect(store.listLoadingFor('owner_change')).toBe(false)
    expect(store.recordsFor('owner_change').map(item => item.id)).toEqual(['new'])
  })

  it('写入成功后的列表刷新失败不会误报保存失败', async () => {
    ownerDocumentStoreMocks.listResponses.push(async () => {
      throw new Error('模拟列表刷新失败')
    })
    const store = useOwnerDocumentStore()

    await expect(
      store.saveForm('acceptance', { name: '已保存' }, 'draft'),
    ).resolves.toEqual(ownerDocumentStoreMocks.saveResult)
    expect(store.listError('acceptance')).toBe('模拟列表刷新失败')
    expect(store.loading).toBe(false)
  })

  it.each(['forbidden', 'not-found', 'relationship-mismatch'] as const)('%s 后重试不能再次露出上次列表', async (code) => {
    const store = useOwnerDocumentStore()
    ownerDocumentStoreMocks.listResponses.push(async () => [row('restricted')])
    await store.loadKind('owner_change')
    ownerDocumentStoreMocks.listResponses.push(async () => {
      throw new OwnerCommercialDocumentRepositoryProblem(ownerCommercialDocumentProblem(code, '来源不可读取'))
    })
    await expect(store.loadKind('owner_change')).rejects.toThrow('来源不可读取')
    expect(store.recordsFor('owner_change')).toEqual([])
    expect(store.records.owner_change).toBeUndefined()

    let complete!: (rows: OwnerDocumentListRecord[]) => void
    ownerDocumentStoreMocks.listResponses.push(() => new Promise(resolve => complete = resolve))
    const retry = store.loadKind('owner_change')
    expect(store.listError('owner_change')).toBe('')
    expect(store.recordsFor('owner_change')).toEqual([])
    complete([])
    await retry
    expect(store.hasListSnapshot('owner_change')).toBe(true)
  })

  it('同视图普通错误保留快照，验收与保修切换清空且仅最新请求可发布', async () => {
    const store = useOwnerDocumentStore()
    const query = (variant: 'acceptance' | 'warranty') => ({ search: '', projectId: null, contractId: null, status: null, documentType: null, variant, page: 1, pageSize: 20 as const })
    ownerDocumentStoreMocks.listResponses.push(async () => [row('accepted')])
    await store.loadKind('acceptance', query('acceptance'))
    ownerDocumentStoreMocks.listResponses.push(async () => {
      throw new Error('暂时离线')
    })
    await expect(store.loadKind('acceptance', query('acceptance'))).rejects.toThrow('暂时离线')
    expect(store.recordsFor('acceptance').map(item => item.id)).toEqual(['accepted'])

    let failOld!: (cause: Error) => void
    ownerDocumentStoreMocks.listResponses.push(() => new Promise((_resolve, reject) => failOld = reject))
    const oldLoad = store.loadKind('acceptance', query('warranty'))
    // eslint-disable-next-line test/valid-expect -- 先绑定断言，触发异步完成后再等待，避免未处理拒绝。
    const oldResult = expect(oldLoad).rejects.toThrow('旧请求权限错误')
    expect(store.recordsFor('acceptance')).toEqual([])
    expect(store.hasListSnapshot('acceptance', 'warranty')).toBe(false)
    ownerDocumentStoreMocks.listResponses.push(async () => [])
    await store.loadKind('acceptance', query('acceptance'))
    failOld(new OwnerCommercialDocumentRepositoryProblem(ownerCommercialDocumentProblem('forbidden', '旧请求权限错误')))
    await oldResult
    expect(store.hasListSnapshot('acceptance', 'acceptance')).toBe(true)
    expect(store.hasListSnapshot('acceptance', 'warranty')).toBe(false)
    expect(store.listError('acceptance')).toBe('')
  })
})
