import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

const mock = vi.hoisted(() => ({ confirm: vi.fn() }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: mock.confirm, undoToast: () => {} }) }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

it.each(['project', 'permission', 'permission-restored', 'pending', 'cancel'] as const)('上传确认期间 %s 变化时不提交或分配新编号', async (changed) => {
  let answer!: (value: boolean) => void
  mock.confirm.mockReset().mockReturnValue(new Promise<boolean>((resolve) => {
    answer = resolve
  }))
  const file = new File(['%PDF-1.4'], '合成.pdf', { type: 'application/pdf' })
  let unresolved = false
  const workspace = {
    records: shallowRef([]),
    loading: shallowRef(false),
    readState: shallowRef('ready'),
    load: vi.fn(async () => {}),
    pendingAll: () => unresolved ? [{ targetId: null, action: 'upload', commandId: 'original-command' }] : [],
    upload: vi.fn(async () => { throw new Error('不应发出上传') }),
  }
  const content = defineComponent({
    emits: ['dirty', 'upload'],
    setup(_props, { emit }) {
      return () => h('div', [
        h('button', { onClick: () => emit('dirty', true) }, '修改草稿'),
        h('button', { onClick: () => emit('upload', [file], 'project-one') }, '上传合成文件'),
      ])
    },
  })
  const props = { workspace: workspace as never, projects: [{ id: 'project-one', label: '合成项目' }], suppliers: [], signatories: [] }
  const view = render(CentralInvoiceWorkspaceScreen, { props, global: { stubs: { CentralInvoiceWorkspaceView: content, NuxtLink: true } } })
  await fireEvent.click(await screen.findByRole('button', { name: '修改草稿' }))
  await fireEvent.click(screen.getByRole('button', { name: '上传合成文件' }))
  await fireEvent.click(screen.getByRole('button', { name: '上传合成文件' }))
  expect(mock.confirm).toHaveBeenCalledOnce()
  if (changed === 'project') {
    await view.rerender({ ...props, projects: [] })
  }
  else if (changed === 'permission') {
    workspace.readState.value = 'unavailable'
  }
  else if (changed === 'permission-restored') {
    workspace.readState.value = 'unavailable'
    workspace.readState.value = 'ready'
  }
  else if (changed === 'pending') {
    unresolved = true
  }
  answer(changed !== 'cancel')
  await flushPromises()
  expect(workspace.upload).not.toHaveBeenCalled()
  expect(workspace.pendingAll()).toEqual(changed === 'pending' ? [{ targetId: null, action: 'upload', commandId: 'original-command' }] : [])
})
