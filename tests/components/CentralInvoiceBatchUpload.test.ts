import { fireEvent, render, screen, within } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

function setupBatch(options: { failUpload?: boolean, failRecognition?: boolean, pendingRecognition?: boolean, storageBroken?: boolean, loseSourceAfterUpload?: boolean, waitForUpload?: Promise<void>, waitForRecognition?: Promise<void> } = {}) {
  const files = ['one.pdf', 'two.pdf', 'three.pdf'].map(name => new File(['%PDF-1.4'], name, { type: 'application/pdf' }))
  let unresolved: { targetId: string | null, action: string, commandId: string } | null = null
  let storageBroken = false
  const workspace = {
    records: shallowRef([]),
    loading: shallowRef(false),
    readState: shallowRef('ready'),
    load: vi.fn(async () => {}),
    pendingAll: () => {
      if (storageBroken)
        throw new Error('浏览器存储不可用')
      return unresolved ? [unresolved] : []
    },
    pending: (id: string | null) => {
      if (storageBroken)
        throw new Error('浏览器存储不可用')
      return unresolved?.targetId === id ? unresolved : null
    },
    upload: vi.fn(async (file: File) => {
      if (file.name === 'one.pdf' && options.waitForUpload)
        await options.waitForUpload
      if (file.name === 'two.pdf' && options.failUpload) {
        unresolved = { targetId: null, action: 'upload', commandId: 'original-upload' }
        throw new Error('two.pdf 合成响应丢失')
      }
      if (options.loseSourceAfterUpload)
        workspace.readState.value = 'unavailable'
      return { id: file.name, version: '1', original: null }
    }),
    recognizeWithCandidate: vi.fn(async (invoice: { id: string }) => {
      if (invoice.id === 'one.pdf' && options.waitForRecognition)
        await options.waitForRecognition
      if (options.failRecognition && invoice.id === 'one.pdf') {
        if (options.pendingRecognition)
          unresolved = { targetId: invoice.id, action: 'recognize', commandId: 'original-recognition' }
        if (options.storageBroken)
          storageBroken = true
        throw new Error('合成识别结果不可用')
      }
      return { record: invoice, candidate: {} }
    }),
  }
  const content = defineComponent({
    emits: ['upload'],
    setup(_props, { emit }) {
      return () => h('button', { onClick: () => emit('upload', files, 'project-one') }, '上传合成批次')
    },
  })
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: workspace as never, projects: [{ id: 'project-one', label: '合成项目' }], suppliers: [], signatories: [] }, global: { stubs: { CentralInvoiceWorkspaceView: content, NuxtLink: true } } })
  return { workspace, files }
}

it('第二张提交结果未知时保留第一张事实，并明确后续未处理且不重复提交', async () => {
  const { workspace } = setupBatch({ failUpload: true })
  await flushPromises()
  await fireEvent.click(await screen.findByRole('button', { name: '上传合成批次' }))
  await flushPromises()
  expect(workspace.upload.mock.calls.map(([file]) => file.name)).toEqual(['one.pdf', 'two.pdf'])
  const rows = within(screen.getByRole('region', { name: '本次上传结果' })).getAllByRole('listitem')
  expect(rows.map(row => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('one.pdf：识别已回读'), expect.stringContaining('two.pdf：结果未能确认'), expect.stringContaining('three.pdf：未处理')]))
  expect(workspace.pendingAll()).toEqual([{ targetId: null, action: 'upload', commandId: 'original-upload' }])
  expect(screen.getByRole('button', { name: '核对上次提交' })).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '上传合成批次' }))
  await flushPromises()
  expect(workspace.upload).toHaveBeenCalledTimes(2)
  workspace.readState.value = 'unavailable'
  await nextTick()
  expect(screen.queryByRole('region', { name: '本次上传结果' })).toBeNull()
  expect(screen.queryByText(/one\.pdf|two\.pdf|three\.pdf/)).toBeNull()
  workspace.readState.value = 'ready'
  await nextTick()
  expect(screen.queryByRole('region', { name: '本次上传结果' })).toBeNull()
})

it('全部上传和识别回读后逐项显示结果', async () => {
  const { workspace } = setupBatch()
  await flushPromises()
  await fireEvent.click(await screen.findByRole('button', { name: '上传合成批次' }))
  await flushPromises()
  expect(workspace.upload).toHaveBeenCalledTimes(3)
  const rows = within(screen.getByRole('region', { name: '本次上传结果' })).getAllByRole('listitem')
  expect(rows.map(row => row.textContent?.trim())).toEqual(['one.pdf：识别已回读', 'two.pdf：识别已回读', 'three.pdf：识别已回读'])
})

it('识别未完成且没有待核对命令时保留原件并继续处理后续文件', async () => {
  const { workspace } = setupBatch({ failRecognition: true })
  await flushPromises()
  await fireEvent.click(await screen.findByRole('button', { name: '上传合成批次' }))
  await flushPromises()
  expect(workspace.upload).toHaveBeenCalledTimes(3)
  const rows = within(screen.getByRole('region', { name: '本次上传结果' })).getAllByRole('listitem')
  expect(rows[0]?.textContent).toContain('one.pdf：原件已回读，识别未完成')
  expect(rows[1]?.textContent).toContain('two.pdf：识别已回读')
})

it('失权后恢复时，旧上传迟到不能恢复文件名或继续处理', async () => {
  let finishUpload!: () => void
  const waitForUpload = new Promise<void>((resolve) => {
    finishUpload = resolve
  })
  const { workspace } = setupBatch({ waitForUpload })
  await flushPromises()
  await fireEvent.click(await screen.findByRole('button', { name: '上传合成批次' }))
  await flushPromises()
  workspace.readState.value = 'unavailable'
  await nextTick()
  workspace.readState.value = 'ready'
  await nextTick()
  finishUpload()
  await flushPromises()
  expect(workspace.upload).toHaveBeenCalledOnce()
  expect(workspace.recognizeWithCandidate).not.toHaveBeenCalled()
  expect(screen.queryByRole('region', { name: '本次上传结果' })).toBeNull()
  expect(screen.queryByText(/one\.pdf|two\.pdf|three\.pdf/)).toBeNull()
})

it('识别期间失权后恢复，迟到的识别结果不会恢复清单或处理后续文件', async () => {
  let finishRecognition!: () => void
  const waitForRecognition = new Promise<void>((resolve) => {
    finishRecognition = resolve
  })
  const { workspace } = setupBatch({ waitForRecognition })
  await flushPromises()
  await fireEvent.click(await screen.findByRole('button', { name: '上传合成批次' }))
  await flushPromises()
  expect(workspace.recognizeWithCandidate).toHaveBeenCalledOnce()
  expect(screen.getByRole('region', { name: '本次上传结果' }).textContent).toContain('one.pdf：原件已回读，正在识别或核对结果')
  workspace.readState.value = 'unavailable'
  await nextTick()
  workspace.readState.value = 'ready'
  await nextTick()
  finishRecognition()
  await flushPromises()
  expect(workspace.upload).toHaveBeenCalledOnce()
  expect(screen.queryByRole('region', { name: '本次上传结果' })).toBeNull()
  expect(screen.queryByText(/one\.pdf|two\.pdf|three\.pdf/)).toBeNull()
})

it('原件已回读但识别提交未确认时保留原编号并停止后续文件', async () => {
  const { workspace } = setupBatch({ failRecognition: true, pendingRecognition: true })
  await flushPromises()
  await fireEvent.click(await screen.findByRole('button', { name: '上传合成批次' }))
  await flushPromises()
  expect(workspace.upload).toHaveBeenCalledOnce()
  const rows = within(screen.getByRole('region', { name: '本次上传结果' })).getAllByRole('listitem')
  expect(rows[0]?.textContent).toContain('one.pdf：原件已回读，识别未确认')
  expect(rows[1]?.textContent).toContain('two.pdf：未处理')
  expect(rows[2]?.textContent).toContain('three.pdf：未处理')
  expect(workspace.pendingAll()).toEqual([{ targetId: 'one.pdf', action: 'recognize', commandId: 'original-recognition' }])
})

it.each(['storageBroken', 'loseSourceAfterUpload'] as const)('%s 时立即清除文件名并停止后续上传', async (condition) => {
  const { workspace } = setupBatch(condition === 'storageBroken' ? { failRecognition: true, storageBroken: true } : { loseSourceAfterUpload: true })
  await flushPromises()
  await fireEvent.click(await screen.findByRole('button', { name: '上传合成批次' }))
  await flushPromises()
  expect(workspace.upload).toHaveBeenCalledOnce()
  expect(screen.queryByRole('region', { name: '本次上传结果' })).toBeNull()
  expect(screen.queryByText(/one\.pdf|two\.pdf|three\.pdf/)).toBeNull()
})
