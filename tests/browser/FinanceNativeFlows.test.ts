import type { TransactionDb } from '~/lib/db/coordinator'
import type { BrowserSqliteDatabase } from '~/lib/db/sqljs'
import type { F3FormKind } from '~/lib/finance/forms'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import * as Vue from 'vue'
import VxeUI from 'vxe-pc-ui'
import VxeTable from 'vxe-table'
import FinanceFormFields from '~/components/finance/FinanceFormFields.vue'
import FinanceFormPage from '~/components/finance/FinanceFormPage.vue'
import FinancePaymentTypeStep from '~/components/finance/FinancePaymentTypeStep.vue'
import ConfirmDialog from '~/components/shared/ConfirmDialog.vue'
import FileRefAttachmentSection from '~/components/shared/FileRefAttachmentSection.vue'
import { Button } from '~/components/ui/button'
import * as dialogComponents from '~/components/ui/dialog'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'
import FormFooter from '~/components/ui/FormFooter.vue'
import KitButton from '~/components/ui/KitButton.vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import SelectFilter from '~/components/ui/SelectFilter.vue'
import TablePager from '~/components/ui/TablePager.vue'
import { useFinanceFormAttachments } from '~/composables/useFinanceFormAttachments'
import { confirm, useKitUIHostState } from '~/composables/useKitUI'
import { runMigrations } from '~/lib/db/migrations'
import { openBrowserSqlite } from '~/lib/db/sqljs'
import { getPaymentApplicationSummary, listFinanceFormAttachments, loadFinanceForm } from '~/lib/finance/forms'
import { F3_FORM_META, financeFormPath } from '~/lib/finance/page'
import { loadFileRefContent } from '~/lib/forms/file-refs'
import { useFinanceStore } from '~/stores/finance'
import { checkFinanceViewports } from './finance-viewports'
import 'vxe-pc-ui/lib/style.css'
import 'vxe-table/lib/style.css'
import '~/assets/css/vxe-theme.css'

// The actual domain and store use an isolated SQLite connection. This exercises
// the independent Native form path; it does not make demo or production writable.
const state = vi.hoisted(() => ({ sql: null as BrowserSqliteDatabase | null }))
function execute(sql: string, params: unknown[] = []) {
  state.sql!.run(sql, params)
  return Promise.resolve()
}
function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const statement = state.sql!.prepare(sql)
  try {
    if (params.length)
      statement.bind(params)
    const result: T[] = []
    while (statement.step())
      result.push(statement.getAsObject() as T)
    return Promise.resolve(result)
  }
  finally {
    statement.free()
  }
}
vi.mock('~/lib/db/connection', () => ({
  execute: (sql: string, params?: unknown[]) => execute(sql, params),
  select: <T>(sql: string, params?: unknown[]) => select<T>(sql, params),
  withTransaction: async <T>(work: (tx: TransactionDb) => Promise<T>) => {
    await execute('BEGIN IMMEDIATE')
    try {
      const result = await work({ execute, select })
      await execute('COMMIT')
      return result
    }
    catch (error) {
      await execute('ROLLBACK')
      throw error
    }
  },
}))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
// This suite intentionally selects the Native owner with an isolated SQL adapter.
vi.mock('~/lib/platform/runtime', () => ({ isDesktopRuntime: () => true }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))

beforeEach(async () => {
  state.sql = await openBrowserSqlite()
  await runMigrations({ execute, select })
  await execute(`INSERT INTO workers(id,name) VALUES('worker-native','同一个工人')`)
  await execute(`INSERT INTO suppliers(id,name,approval_status) VALUES('supplier-native','个人临时金分供方','approved')`)
  for (const name of ['computed', 'ref', 'shallowRef', 'toRef', 'watch', 'nextTick', 'onMounted', 'onActivated', 'onDeactivated', 'onBeforeUnmount', 'useTemplateRef'] as const)
    vi.stubGlobal(name, Vue[name])
  vi.stubGlobal('useFinanceFormAttachments', useFinanceFormAttachments)
})
afterEach(() => {
  state.sql?.close()
  state.sql = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function mountForm(initialKind: F3FormKind) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useFinanceStore()
  const kind = Vue.shallowRef(initialKind)
  const route = Vue.reactive({ fullPath: financeFormPath(initialKind), params: {} as Record<string, string>, query: {} })
  const feedback = { confirm, success: vi.fn(), warning: vi.fn(), error: vi.fn() }
  const navigate = vi.fn(async (path: string) => {
    route.fullPath = path
    const id = path.split('/').at(-1)!
    route.params = id === 'new' ? {} : { id }
    await Vue.nextTick()
  })
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useFinanceStore', () => store)
  vi.stubGlobal('useTabsStore', () => ({ close: vi.fn() }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useKitUI', () => feedback)
  vi.stubGlobal('navigateTo', navigate)
  const host = useKitUIHostState()
  await render(Vue.defineComponent({ setup: () => () => Vue.h('main', { style: { minWidth: '0', maxWidth: '100%', padding: '12px' } }, [
    Vue.h(FinanceFormPage, { kind: kind.value, key: `${kind.value}:${route.fullPath}` }),
    Vue.h(ConfirmDialog, { ...(host.confirmOpts.value ?? { message: '' }), open: !!host.confirmState.value, onConfirm: () => host.resolveConfirm(true), onCancel: () => host.resolveConfirm(false) }),
  ]) }), { global: { plugins: [pinia, VxeUI, VxeTable], components: { ...dialogComponents, Button, EntityFormShell, FinanceFormFields, FileRefAttachmentSection, FormFooter, KitButton, LookupSelect, SectionHeader, SelectFilter, TablePager, FinancePaymentTypeStep } } })
  return {
    route,
    feedback,
    store,
    navigate,
    async change(nextKind: F3FormKind) {
      kind.value = nextKind
      route.fullPath = financeFormPath(nextKind)
      route.params = {}
      await Vue.nextTick()
    },
  }
}

function field(testId: string) {
  return page.elementLocator(document.body).locator(`[data-testid="${testId}"]`)
}
function attach(name: string) {
  const input = document.querySelector<HTMLInputElement>('[data-testid="finance-attachment-input"]')!
  const transfer = new DataTransfer()
  transfer.items.add(new File([new TextEncoder().encode('reimbursement-e2e').buffer], name, { type: 'application/pdf' }))
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
async function choose(label: string, keyword: string, name: string | RegExp) {
  const input = page.getByPlaceholder(label)
  await input.click()
  await input.fill(keyword)
  await page.getByRole('option', { name, exact: true }).click()
}
async function keepOpen() {
  const checkbox = page.getByRole('checkbox', { name: '【保存】后关闭' })
  await expect.element(checkbox).toBeVisible()
  if ((checkbox.element() as HTMLInputElement).checked)
    await checkbox.click()
}
async function coldRead<K extends F3FormKind>(kind: K, id: string) {
  const bytes = state.sql!.export()
  state.sql!.close()
  state.sql = await openBrowserSqlite(bytes)
  return loadFinanceForm(kind, id)
}

describe('承接 finance-forms Native 写保护：真实 SFC、SQLite、store、原件和人工确认', () => {
  for (const input of [
    { kind: 'invoice_application', field: 'finance-name', column: 'name', table: 'invoice_applications' },
    { kind: 'current', field: 'finance-no', column: 'no', table: 'current_transactions' },
    { kind: 'payment_record', field: 'finance-name', column: 'payee_name', table: 'payment_records' },
    { kind: 'reimbursement', field: 'finance-no', column: 'no', table: 'expense_reimbursements' },
    { kind: 'payment_application', field: 'finance-name', column: 'name', table: 'payment_applications' },
  ] as const) {
    it(`${input.kind}：独立保存不完整草稿并从 SQLite 同 ID 回显及冷读`, async () => {
      const view = await mountForm(input.kind)
      if (input.kind === 'payment_application')
        await page.getByRole('button', { name: '有合同-材料', exact: true }).click()
      await expect.element(page.getByRole('heading', { name: `新建 · ${F3_FORM_META[input.kind].label}`, exact: true })).toBeVisible()
      for (const name of ['取消', '保存草稿', '保存并新建', '保存并提交', '保存'])
        await expect.element(page.getByRole('button', { name, exact: true })).toBeVisible()
      const value = `F3-草稿-${input.kind}`
      await field(input.field).fill(value)
      await page.getByRole('button', { name: '保存草稿', exact: true }).click()
      await expect.poll(() => view.route.params.id).toBeTruthy()
      await expect.element(field(input.field)).toHaveValue(value)
      await expect.element(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled()
      const [row] = await select<Record<string, unknown>>(`SELECT * FROM ${input.table} WHERE id=?`, [view.route.params.id])
      expect(row![input.column]).toBe(value)
      expect(row!.project_id).toBeNull()
      const restored = await coldRead(input.kind, view.route.params.id!)
      expect(restored?.id).toBe(view.route.params.id)
      expect(view.feedback.error).not.toHaveBeenCalled()
      await checkFinanceViewports(() => {
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
      })
    })
  }

  for (const input of [
    { label: '报销甲', item: '办公耗材', amount: '35.5', total: '35.50', fileName: 'reimbursement-a.pdf' },
    { label: '报销乙', item: '项目资料印刷', amount: '113.25', total: '113.25', fileName: 'reimbursement-b.pdf' },
  ]) {
    it(`公司费用空项目提交、真实金额原件及附件删除恢复：${input.label}`, async () => {
      const view = await mountForm('reimbursement')
      await choose('从全局工人清单选择', '同一个', '同一个工人')
      await field('reimbursement-item-0').fill(input.item)
      await field('reimbursement-amount-0').fill(input.amount)
      await expect.element(page.getByText(`合计 ¥ ${input.total}`, { exact: true })).toBeVisible()
      attach(input.fileName)
      await expect.element(page.getByRole('textbox', { name: '附件分类' })).toBeVisible()
      await keepOpen()
      await page.getByRole('button', { name: '保存并提交', exact: true }).click()
      await expect.poll(() => view.route.params.id).toBeTruthy()
      await expect.element(page.getByText('采用时姓名：同一个工人', { exact: true })).toBeVisible()
      await expect.element(page.getByText(input.fileName, { exact: true })).toBeVisible()
      await expect.element(page.getByText(`合计 ¥ ${input.total}`, { exact: true })).toBeVisible()
      const id = view.route.params.id!
      const [original] = await listFinanceFormAttachments('reimbursement', id, true)
      expect(Array.from((await loadFileRefContent(original!))!.bytes)).toEqual(Array.from(new TextEncoder().encode('reimbursement-e2e')))
      const attachments = page.elementLocator(document.body).locator('#section-attachments')
      await attachments.getByRole('button', { name: '删除', exact: true }).click()
      await keepOpen()
      await page.getByRole('button', { name: '保存并提交', exact: true }).click()
      await expect.element(page.getByText('已删除', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '恢复', exact: true }).click()
      await keepOpen()
      await page.getByRole('button', { name: '保存并提交', exact: true }).click()
      await expect.element(page.getByText('已删除', { exact: true })).not.toBeInTheDocument()
      await expect.element(page.getByText(input.fileName, { exact: true })).toBeVisible()
      const restored = await coldRead('reimbursement', id)
      expect(restored).toMatchObject({ id, projectId: null, applicantWorkerId: 'worker-native', applicantNameSnapshot: '同一个工人', totalAmount: Number(input.amount), status: 'submitted' })
      expect(restored!.lines).toHaveLength(1)
      expect(restored!.lines![0]).toMatchObject({ expenseItem: input.item, amount: Number(input.amount) })
      expect(Array.from((await loadFileRefContent(original!))!.bytes)).toEqual(Array.from(new TextEncoder().encode('reimbursement-e2e')))
      expect(view.feedback.error).not.toHaveBeenCalled()
    })
  }

  for (const input of [
    { label: '整数支付', amount: '88', date: '2026-07-25' },
    { label: '含分支付', amount: '113.25', date: '2024-02-29' },
  ]) {
    it(`${input.label}：公司付款无虚拟项目、真实申请分摊、人工确认和撤回`, async () => {
      const view = await mountForm('payment_application')
      await page.getByRole('button', { name: '公司付款', exact: true }).click()
      await choose('检索分供方', '临时金', '个人临时金分供方')
      const name = `E2E公司付款-${input.label}`
      await field('finance-name').fill(name)
      await field('finance-amount').fill(input.amount)
      await field('finance-date').fill(input.date)
      await page.getByRole('textbox', { name: '申请人 *', exact: true }).fill('财务')
      await page.getByRole('combobox', { name: '回票类型', exact: true }).click()
      await page.getByRole('option', { name: '无需发票', exact: true }).click()
      await keepOpen()
      await page.getByRole('button', { name: '保存并提交', exact: true }).click()
      await expect.poll(() => view.route.params.id).toBeTruthy()
      const applicationId = view.route.params.id!
      expect(await loadFinanceForm('payment_application', applicationId)).toMatchObject({ projectId: null, supplierId: 'supplier-native', name, applyAmount: Number(input.amount) })
      await view.change('payment_record')
      await choose('检索分供方', '临时金', '个人临时金分供方')
      await field('finance-name').fill(`E2E收款方-${input.label}`)
      await field('finance-date').fill(input.date)
      await field('finance-amount').fill(input.amount)
      await page.getByRole('textbox', { name: '付款凭证号 *', exact: true }).fill(`V-E2E-${input.label}`)
      await field('payment-bank-serial').fill(`BANK-E2E-${input.label}`)
      await field('add-grid-line').click()
      await choose('选择付款申请', name, new RegExp(name))
      await page.getByRole('spinbutton', { name: '本次支付分摊金额', exact: true }).fill(input.amount)
      await field('payment-confirmed-by').fill('E2E 财务')
      await keepOpen()
      await field('confirm-payment').click()
      await expect.element(page.getByRole('dialog', { name: '人工确认支付' })).toBeVisible()
      await page.getByRole('button', { name: '确认支付', exact: true }).click()
      await expect.poll(() => view.route.params.id).toBeTruthy()
      await expect.element(page.getByText('已人工确认', { exact: true })).toBeVisible()
      const paymentId = view.route.params.id!
      const confirmed = await coldRead('payment_record', paymentId)
      expect(confirmed).toMatchObject({ id: paymentId, projectId: null, supplierId: 'supplier-native', amount: Number(input.amount), paymentDate: input.date, voucherNo: `V-E2E-${input.label}`, bankSerialNo: `BANK-E2E-${input.label}`, confirmationStatus: 'confirmed', confirmedBy: 'E2E 财务' })
      expect(confirmed!.applicationAllocations).toEqual([expect.objectContaining({ paymentApplicationId: applicationId, allocatedAmount: Number(input.amount) })])
      expect((await getPaymentApplicationSummary(applicationId)).paidAmount).toBe(Number(input.amount))
      await field('unconfirm-payment').click()
      await page.getByRole('button', { name: '撤回确认', exact: true }).click()
      await expect.element(page.elementLocator(document.body).locator('span.chip').getByText('待核对', { exact: true })).toBeVisible()
      expect((await getPaymentApplicationSummary(applicationId)).paidAmount).toBe(0)
      expect(await coldRead('payment_record', paymentId)).toMatchObject({ id: paymentId, projectId: null, confirmationStatus: 'needs_review', amount: Number(input.amount) })
      expect(await select('SELECT id FROM payment_records')).toEqual([{ id: paymentId }])
      expect(view.feedback.error).not.toHaveBeenCalled()
    })
  }
})
