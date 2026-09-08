import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConstructionContractReadStore } from '~/stores/construction-contract-read'
import { useMaterialContractReadStore } from '~/stores/material-contract-read'
import { useSubcontractContractReadStore } from '~/stores/subcontract-contract-read'

const query = { includeDemo: true, origin: null, search: '', projectId: null, supplierId: null, customerId: null, status: null, subKind: null, page: 1, pageSize: 10 } as const

describe('合同列表刷新快照边界', () => {
  beforeEach(() => setActivePinia(createPinia()))

  for (const [name, useStore] of [
    ['materialContractRead', useMaterialContractReadStore],
    ['constructionContractRead', useConstructionContractReadStore],
    ['subcontractContractRead', useSubcontractContractReadStore],
  ] as const) {
    it(`${name}同来源筛选保留表格，换来源清空，并忽略较早请求`, async () => {
      const page = { items: [], empty: null, sourceVersion: 'initial' }
      let finishFilter!: (value: typeof page) => void
      let finishSwitch!: (value: typeof page) => void
      const list = vi.fn()
        .mockResolvedValueOnce(page)
        .mockImplementationOnce(() => new Promise(resolve => finishFilter = resolve))
        .mockImplementationOnce(() => new Promise(resolve => finishSwitch = resolve))
      vi.stubGlobal('useNuxtApp', () => ({ $repositories: { [name]: { list } } }))
      const store = useStore()
      await store.loadList(query)
      const filtering = store.loadList({ ...query, status: ['草稿', '履约中'] })
      expect(store.listState).toMatchObject({ kind: 'loading', previous: page })
      const switching = store.loadList({ ...query, includeDemo: false, origin: 'real' })
      expect(store.listState).toEqual({ kind: 'loading', previous: null })
      finishSwitch({ ...page, sourceVersion: 'real' })
      await switching
      finishFilter({ ...page, sourceVersion: 'stale' })
      await filtering
      expect(store.listState).toMatchObject({ kind: 'ready', data: { sourceVersion: 'real' } })
    })
  }
})
