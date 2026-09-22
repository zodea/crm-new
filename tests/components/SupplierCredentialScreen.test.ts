import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupplierCredentialScreen from '~/components/supplier/SupplierCredentialScreen.vue'

const localLoad = vi.hoisted(() => vi.fn())
const readStore = vi.hoisted(() => ({
  detailState: { kind: 'ready', data: { supplier: { id: 'supplier-a', name: '合成分供方 A' } } },
  loadDetail: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
vi.mock('~/stores/supplier-read', () => ({ useSupplierReadStore: () => readStore }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('中央分供方证照入口', () => {
  it('浏览器正式来源进入独立中央证照界面，不读取本地证照库', async () => {
    vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
    vi.stubGlobal('useSupplierStore', () => ({ load: localLoad }))
    vi.stubGlobal('useSupplierDetailStore', () => ({ load: localLoad }))
    vi.stubGlobal('useTabTitle', vi.fn())
    render(SupplierCredentialScreen, {
      props: { supplierId: 'supplier-a', origin: 'real' },
      global: { stubs: {
        EntityDetailShell: { template: '<main><slot /></main>' },
        StatePanel: { props: ['title'], template: '<p>{{ title }}</p>' },
        SupplierCredentialCentralPanel: { template: '<button>上传原件</button>' },
      } },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '上传原件' })).toBeTruthy())
    expect(localLoad).not.toHaveBeenCalled()
    expect(screen.queryByText('中央证照专用存储尚未接入')).toBeNull()
  })
})
