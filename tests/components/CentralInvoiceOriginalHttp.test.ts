import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import Candidate from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import { syntheticOriginalFixture } from '../helpers/central-invoice-original-fixture'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const view = defineComponent({
  props: { originalFile: Object, originalLoading: Boolean },
  setup: props => () => h('p', { 'data-testid': 'verified-original' }, props.originalLoading ? '读取中' : (props.originalFile as File | null)?.name ?? '无原件'),
})

it.each(['good', 'digest', 'length', 'forbidden', 'revoked', 'changed'] as const)('预选原件经过真实 workspace 和 HTTP 校验：%s', async (mode) => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('File', NodeFile)
  const fixture = await syntheticOriginalFixture(mode)
  const verify = fixture.workspace.verifiedOriginal
  fixture.workspace.verifiedOriginal = async (...args) => {
    try {
      return await verify(...args)
    }
    finally { fixture.events.push('done') }
  }
  render(Candidate, { props: { workspace: fixture.workspace as never, projects: [], suppliers: [], signatories: [], initialSelectedId: fixture.record.id }, global: { stubs: { CentralInvoiceWorkspaceView: view, NuxtLink: true } } })
  await waitFor(() => expect(fixture.events).toContain('done'))
  if (mode === 'good') {
    await waitFor(() => expect(screen.getByTestId('verified-original').textContent).toBe('合成.png'))
    expect(fixture.events).toEqual(['authorize', 'detail', 'binary', 'detail', 'authorize', 'authorize', 'done'])
    expect(fixture.real.readState.value).toBe('ready')
  }
  else {
    expect(screen.queryByText('合成.png')).toBeNull()
    expect(fixture.events).toContain('binary')
    if (mode === 'forbidden' || mode === 'revoked')
      expect(fixture.real.readState.value).toBe('unavailable')
    if (mode === 'changed')
      expect(fixture.events.filter(item => item === 'detail')).toHaveLength(2)
  }
})
