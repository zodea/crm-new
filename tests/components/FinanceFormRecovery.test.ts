import type { FileRefRecord } from '~/lib/forms/file-refs'
import { webcrypto } from 'node:crypto'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import FinanceFormPage from '~/components/finance/FinanceFormPage.vue'
import FileRefAttachmentSection from '~/components/shared/FileRefAttachmentSection.vue'
import FormFooter from '~/components/ui/FormFooter.vue'
import KitButton from '~/components/ui/KitButton.vue'
import { useFinanceFormAttachments } from '~/composables/useFinanceFormAttachments'
import { f3FormDefaults } from '~/lib/finance/page'

const readers = vi.hoisted(() => ({ form: vi.fn(), files: vi.fn(), content: vi.fn() }))
vi.mock('~/lib/finance/forms', () => ({ loadFinanceForm: readers.form, listFinanceFormAttachments: readers.files }))
vi.mock('~/lib/forms/file-refs', async original => ({ ...await original<object>(), loadFileRefContent: readers.content }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))
const route = Vue.reactive({ params: {} as Record<string, string>, query: {}, fullPath: '/finance/reimbursement/new' })
const feedback = { confirm: vi.fn(async () => true), success: vi.fn(), warning: vi.fn(), error: vi.fn() }
const store = { isCentral: () => false, formAttachments: readers.files, originalContent: (_kind: string, file: FileRefRecord) => readers.content(file), saveForm: vi.fn(), loadOne: vi.fn(), unconfirmPayment: vi.fn(), searchProjects: vi.fn(), searchCustomers: vi.fn(), searchSuppliers: vi.fn(), loadCustomerSnapshot: vi.fn() }
const record = (id = 'expense-a', note = '先发') => ({ ...f3FormDefaults('reimbursement'), id, applicant: '原申请人', note })
const file = (id = 'file-a'): FileRefRecord => ({ id, ownerType: 'expense_reimbursement', ownerId: 'expense-a', fileName: '先发.txt', filePath: '', fileSize: 3, mimeType: 'text/plain', category: '业务附件', uploader: '', uploadedAt: '', deletedAt: null })
const shell = Vue.defineComponent({ template: '<main><slot name="actions"/><slot/></main>' })
const fields = Vue.defineComponent({ props: ['draft'], emits: ['patch'], template: '<label>申请人<input aria-label="申请人" :value="draft.applicant" @input="$emit(\'patch\', { applicant: $event.target.value })"></label>' })
function open() {
  return render(FinanceFormPage, {
    props: { kind: 'reimbursement' },
    global: {
      components: { EntityFormShell: shell, FileRefAttachmentSection, FormFooter, KitButton },
      stubs: { FinanceFormFields: fields, SectionHeader: true },
    },
  })
}
function attachment(name: string, body: string) {
  const value = new File([body], name, { type: 'text/plain' })
  Object.defineProperty(value, 'arrayBuffer', { value: async () => Uint8Array.from(body, char => char.charCodeAt(0)).buffer })
  return value
}
async function selectFile(name: string, body: string) {
  await fireEvent.change(screen.getByTestId('finance-attachment-input'), { target: { files: [attachment(name, body)] } })
  await flushPromises()
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  route.params = {}
  route.fullPath = '/finance/reimbursement/new'
  for (const name of ['computed', 'ref', 'shallowRef', 'toRef', 'watch', 'nextTick', 'onMounted', 'onActivated', 'onDeactivated', 'onBeforeUnmount'] as const) vi.stubGlobal(name, Vue[name])
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useFinanceStore', () => store)
  vi.stubGlobal('useFinanceFormAttachments', useFinanceFormAttachments)
  vi.stubGlobal('useTabsStore', () => ({ close: vi.fn() }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useKitUI', () => feedback)
  vi.stubGlobal('navigateTo', vi.fn(async () => undefined))
  readers.form.mockReset().mockImplementation(async (kind, id) => record(id))
  readers.files.mockReset().mockResolvedValue([])
  readers.content.mockReset().mockResolvedValue({ bytes: new Uint8Array([97, 98, 99]), mimeType: 'text/plain' })
  store.loadOne.mockReset().mockImplementation(async (kind, id) => record(id))
  store.saveForm.mockReset()
})

describe('f3 表单原件及已保存恢复', () => {
  it('已保存回读失败禁重复写，只读恢复保留后来字段和新增附件，同一目标可继续保存', async () => {
    let finish!: (value: unknown) => void
    store.saveForm.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    open()
    await flushPromises()
    await fireEvent.update(screen.getByRole('textbox', { name: '申请人' }), '原申请人')
    await selectFile('先发.txt', 'abc')
    await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await fireEvent.update(screen.getByRole('textbox', { name: '申请人' }), '后来申请人')
    await selectFile('后来.txt', 'later')
    finish({ id: 'expense-a', logId: 'log-a', attachmentIds: ['file-a'], readbackConfirmed: false, readbackProblem: '回读中断' })
    await flushPromises()
    expect(screen.getByRole('region', { name: '财务记录已保存待刷新' }).textContent).toContain('本次已保存')
    expect(screen.getByRole('button', { name: '保存草稿' }).hasAttribute('disabled')).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(store.saveForm).toHaveBeenCalledTimes(1)
    expect(feedback.error).not.toHaveBeenCalled()
    readers.files.mockResolvedValue([file()])
    await fireEvent.click(screen.getByRole('button', { name: '只重试读取' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: '财务记录已保存待刷新' })).toBeNull())
    expect(store.loadOne).toHaveBeenCalledWith('reimbursement', 'expense-a')
    expect(store.saveForm).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('textbox', { name: '申请人' }) as HTMLInputElement).value).toBe('后来申请人')
    expect(screen.getAllByRole('textbox', { name: '附件分类' })).toHaveLength(1)
    expect(screen.getByText('后来.txt')).toBeTruthy()
    expect(navigateTo).not.toHaveBeenCalled()
    store.saveForm.mockResolvedValueOnce({ id: 'expense-a', logId: null, attachmentIds: [], readbackConfirmed: false, readbackProblem: '待读' })
    await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(store.saveForm.mock.calls[1]![1]).toMatchObject({ id: 'expense-a', applicant: '后来申请人' })
    expect(store.saveForm.mock.calls[1]![3].add.map((item: { fileName: string }) => item.fileName)).toEqual(['后来.txt'])
  })

  it('原件摘要不一致仍保留已保存事实和发送稿，修复读取后只读核验，不重发', async () => {
    store.saveForm.mockResolvedValue({ id: 'expense-a', logId: null, attachmentIds: ['file-a'], readbackConfirmed: true, readbackProblem: null })
    open()
    await flushPromises()
    await selectFile('先发.txt', 'abc')
    readers.files.mockResolvedValue([file()])
    readers.content.mockResolvedValueOnce({ bytes: new Uint8Array([120, 120, 120]), mimeType: 'text/plain' })
    await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(screen.getByRole('region', { name: '财务记录已保存待刷新' }).textContent).toContain('摘要'))
    expect(screen.getByRole('textbox', { name: '附件分类' })).toBeTruthy()
    expect(navigateTo).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: '只重试读取' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: '财务记录已保存待刷新' })).toBeNull())
    expect(store.saveForm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox', { name: '附件分类' })).toBeNull()
  })

  it('切换记录后迟到下载不触发文件、提示或旧焦点；旧 metadata-only 明确未知', async () => {
    route.params = { id: 'expense-a' }
    readers.files.mockResolvedValue([file()])
    const create = vi.fn(() => 'blob:test')
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    open()
    await flushPromises()
    readers.content.mockResolvedValueOnce(null)
    await fireEvent.click(screen.getByRole('button', { name: '下载原件 先发.txt' }))
    await flushPromises()
    expect(feedback.warning).toHaveBeenCalledWith(expect.stringContaining('正文未知'))
    let finish!: (value: unknown) => void
    readers.content.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    await fireEvent.click(screen.getByRole('button', { name: '下载原件 先发.txt' }))
    readers.files.mockResolvedValue([])
    route.params = { id: 'expense-b' }
    await flushPromises()
    finish({ bytes: new Uint8Array([1]), mimeType: 'text/plain' })
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
    expect(feedback.error).not.toHaveBeenCalled()
  })
})
