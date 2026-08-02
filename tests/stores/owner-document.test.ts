import type { OwnerDocumentListRecord } from '~/lib/owner-document/forms'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})
