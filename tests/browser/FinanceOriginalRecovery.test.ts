import type { FileRefRecord } from '~/lib/forms/file-refs'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import * as Vue from 'vue'
import FinanceFormPage from '~/components/finance/FinanceFormPage.vue'
import FinancePaymentTypeStep from '~/components/finance/FinancePaymentTypeStep.vue'
import FileRefAttachmentSection from '~/components/shared/FileRefAttachmentSection.vue'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'
import FormFooter from '~/components/ui/FormFooter.vue'
import KitButton from '~/components/ui/KitButton.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { useFinanceFormAttachments } from '~/composables/useFinanceFormAttachments'
import { f3FormDefaults } from '~/lib/finance/page'

const read = vi.hoisted(() => ({ form: vi.fn(), files: vi.fn(), content: vi.fn() }))
vi.mock('~/lib/finance/forms', () => ({ loadFinanceForm: read.form, listFinanceFormAttachments: read.files }))
vi.mock('~/lib/forms/file-refs', async original => ({ ...await original<object>(), loadFileRefContent: read.content }))
vi.mock('~/lib/db/connection', () => ({ select: vi.fn(), execute: vi.fn(), withTransaction: vi.fn() }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('真实文件准备、已保存只读恢复、后来附件与下载焦点在五档视口可用，只有纵向页面滚动', async () => {
  setActivePinia(createPinia())
  const original = new Uint8Array([0, 128, 255, 13, 10])
  const draft = { ...f3FormDefaults('reimbursement'), id: 'expense', note: '先发' }
  const file: FileRefRecord = { id: 'original', ownerType: 'expense_reimbursement', ownerId: 'expense', fileName: '合成原件与票据的长文件名.bin', filePath: '', fileSize: 5, mimeType: 'application/octet-stream', category: '业务附件', uploader: '', uploadedAt: '', deletedAt: null }
  const save = vi.fn(async () => ({ id: 'expense', logId: null, attachmentIds: ['original'], readbackConfirmed: false, readbackProblem: '合成回读暂时不可用' }))
  const load = vi.fn(async () => draft)
  const feedback = { confirm: vi.fn(async () => true), success: vi.fn(), warning: vi.fn(), error: vi.fn() }
  const navigate = vi.fn()
  for (const name of ['computed', 'ref', 'shallowRef', 'toRef', 'watch', 'nextTick', 'onMounted', 'onActivated', 'onDeactivated', 'onBeforeUnmount'] as const) vi.stubGlobal(name, Vue[name])
  vi.stubGlobal('useFinanceFormAttachments', useFinanceFormAttachments)
  vi.stubGlobal('useRoute', () => ({ fullPath: '/finance/reimbursement/new', params: {}, query: {} }))
  vi.stubGlobal('useFinanceStore', () => ({ isCentral: () => false, formAttachments: read.files, originalContent: (_kind: string, file: FileRefRecord) => read.content(file), saveForm: save, loadOne: load }))
  vi.stubGlobal('useTabsStore', () => ({ close: vi.fn() }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useKitUI', () => feedback)
  vi.stubGlobal('navigateTo', navigate)
  read.files.mockResolvedValue([file])
  read.content.mockResolvedValue({ bytes: original, mimeType: 'application/octet-stream' })
  const fields = Vue.defineComponent({ props: ['draft'], emits: ['patch'], template: '<section id="section-basic" class="panel p-4" style="min-height:800px"><label>备注草稿<input class="field-input w-full" aria-label="备注草稿" :value="draft.note" @input="$emit(\'patch\', { note: $event.target.value })"></label></section>' })
  await render(Vue.defineComponent({ setup: () => () => Vue.h('main', { style: { minWidth: '0', maxWidth: '100%', padding: '12px' } }, [Vue.h(FinanceFormPage, { kind: 'reimbursement' })]) }), { global: { components: { EntityFormShell, FinanceFormFields: fields, FileRefAttachmentSection, FormFooter, KitButton, SectionHeader, FinancePaymentTypeStep } } })
  await page.getByRole('textbox', { name: '备注草稿' }).fill('先发')
  const choose = (name: string, bytes: Uint8Array) => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="finance-attachment-input"]')!
    const transfer = new DataTransfer()
    transfer.items.add(new File([Uint8Array.from(bytes).buffer], name))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  choose(file.fileName, original)
  await expect.element(page.getByRole('textbox', { name: '附件分类' })).toHaveValue('业务附件')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect.element(page.getByRole('region', { name: '财务记录已保存待刷新' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: '保存草稿' })).toBeDisabled()
  expect(save.mock.calls[0]![3].add[0]).toMatchObject({ fileName: file.fileName, fileSize: 5, payloadBase64: 'AID/DQo=' })
  choose('后来增加的凭据.bin', new Uint8Array([3]))
  await expect.element(page.getByText('后来增加的凭据.bin')).toBeVisible()
  await page.getByRole('button', { name: '只重试读取' }).click()
  await expect.element(page.getByRole('region', { name: '财务记录已保存待刷新' })).not.toBeInTheDocument()
  expect(save).toHaveBeenCalledTimes(1)
  expect(load).toHaveBeenCalledWith('reimbursement', 'expense')
  await expect.element(page.getByText('后来增加的凭据.bin')).toBeVisible()
  expect(navigate).not.toHaveBeenCalled()
  const blobs: Blob[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob)
    return 'blob:synthetic-read-proof'
  })
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const download = page.getByRole('button', { name: `下载原件 ${file.fileName}` })
  await download.click()
  await expect.poll(() => blobs.length).toBe(1)
  expect(Array.from(new Uint8Array(await blobs[0]!.arrayBuffer()))).toEqual([0, 128, 255, 13, 10])
  expect(click).toHaveBeenCalledTimes(1)
  expect(revoke).toHaveBeenCalledWith('blob:synthetic-read-proof')
  await expect.element(download).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(page.getByRole('button', { name: '删除', exact: true })).toHaveFocus()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
  expect(document.documentElement.scrollHeight).toBeGreaterThan(document.documentElement.clientHeight)
  expect(feedback.error).not.toHaveBeenCalled()
})
