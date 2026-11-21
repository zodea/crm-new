import { render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import SubcontractContractDetailScreen from '~/pages/contract/_components/SubcontractContractDetailScreen.vue'

const contractStoreMock = vi.hoisted(() => ({
  detailState: { kind: 'ready', data: { contract: { name: '中央分包合同', no: 'FB-327' } } } as any,
  loadDetail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('~/stores/subcontract-contract-read', () => ({ useSubcontractContractReadStore: () => contractStoreMock }))
vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ includeDemo: false }) }))

const route = reactive({ query: {} as Record<string, string>, fullPath: '/contract/subcontract-327?origin=real&contractKind=subcontract' })

vi.stubGlobal('useRoute', () => route)
vi.stubGlobal('useRouter', () => ({ replace: vi.fn() }))
vi.stubGlobal('useTabTitle', () => {})
vi.stubGlobal('useNuxtApp', () => ({ $repositories: { subcontractContractRead: { fileContent: vi.fn() } } }))

const shell = defineComponent({
  props: ['title', 'backTo', 'backLabel'],
  template: '<main><a :href="backTo">{{ backLabel }}</a><h1>{{ title }}</h1></main>',
})

function renderDetail(returnTo: string) {
  route.query = { returnTo }
  return render(SubcontractContractDetailScreen, {
    props: { contractId: 'subcontract-327', origin: 'real' },
    global: { components: { EntityDetailShell: shell } },
  })
}

describe('分包合同详情来源返回边界', () => {
  beforeEach(() => {
    contractStoreMock.loadDetail.mockClear()
  })

  it('只接受分包变洽签详情作为 owner-document 来源', () => {
    const valid = '/subcontract/change/sub-change-real-327?origin=real'
    const rendered = renderDetail(valid)
    expect(screen.getByRole('link', { name: '返回来源详情' }).getAttribute('href')).toBe(valid)
    rendered.unmount()

    renderDetail('/owner/change/owner-change-real-323?origin=real')
    expect(screen.getByRole('link', { name: '返回分包合同列表' }).getAttribute('href')).toBe('/contract/subcontract')
  })
})
