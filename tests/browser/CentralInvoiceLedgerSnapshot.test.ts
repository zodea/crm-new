import type { Component } from 'vue'
import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import * as XLSX from 'xlsx'
import CentralInvoiceLedgerScreen from '~/components/invoice/CentralInvoiceLedgerScreen.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

const fake = vi.hoisted(() => ({ exportFile: vi.fn(async (_value: unknown) => {}) }))
vi.mock('~/lib/db/client', () => ({ db: { select: async () => [], execute: async () => {} } }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {}, exportFile: fake.exportFile }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
afterEach(() => {
  fake.exportFile.mockClear()
})
const components: Record<string, Component> = { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle }

function invoice(id: string, number: string): CentralInvoiceRecord {
  return {
    id,
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: number, invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 0, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: 'manual',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'personal',
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

it('键盘筛选导出时保留正常重读，来源变化后聚焦提示并拒绝旧快照', async () => {
  let revision = 1
  let source = [invoice('match-1', 'MATCH-001'), invoice('other-1', 'OTHER-001')]
  const actor = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor', capabilities: ['finance-invoice:read', 'finance-invoice:write'] }
  const workspace = createCentralInvoiceWorkspace({
    identity: actor,
    context: async () => actor,
    client: { list: async ({ page, pageSize }: { page: number, pageSize: number }) => ({
      items: source.slice((page - 1) * pageSize, page * pageSize),
      pagination: { total: source.length },
      sourceVersion: `read-${revision}`,
      meta: { sources: [{ key: 'invoices', sourceVersion: `invoices:${revision}` }] },
    }) } as never,
    recognizeLocal: vi.fn() as never,
    storage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
  })
  await render(CentralInvoiceLedgerScreen, { props: { workspace, projects: [] }, global: { plugins: [createPinia()], components } })
  const search = page.getByLabelText('搜索发票')
  await search.fill('MATCH')
  await expect.element(page.getByRole('button', { name: 'MATCH-001' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'OTHER-001' })).not.toBeInTheDocument()
  ;(search.element() as HTMLElement).focus()
  await userEvent.tab()
  await expect.element(page.getByLabelText('开票开始日期')).toHaveFocus()
  const open = page.getByRole('button', { name: '导出 Excel' })
  ;(open.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('dialog')).toBeVisible()
  let preview = page.getByRole('region', { name: 'Excel 数据预览' })
  expect(preview.element().textContent).toContain('MATCH-001')
  expect(preview.element().textContent).not.toContain('OTHER-001')
  await workspace.load()
  await expect.element(page.getByRole('dialog')).toBeVisible()
  source = [...source, invoice('match-2', 'MATCH-002')]
  revision++
  const confirm = page.getByRole('button', { name: '确认导出' })
  ;(confirm.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  const alert = page.getByRole('alert')
  await expect.element(alert).toHaveTextContent('发票来源已变化，请重新读取并打开预览。')
  await expect.element(alert).toHaveFocus()
  expect(fake.exportFile).not.toHaveBeenCalled()
  ;(open.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('dialog')).toBeVisible()
  preview = page.getByRole('region', { name: 'Excel 数据预览' })
  expect(preview.element().textContent).toContain('MATCH-001')
  expect(preview.element().textContent).toContain('MATCH-002')
  expect(preview.element().textContent).not.toContain('OTHER-001')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  ;(confirm.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => fake.exportFile.mock.calls.length).toBe(1)
  const saved = fake.exportFile.mock.calls[0]![0] as { data: ArrayBuffer }
  const sheet = XLSX.read(saved.data, { type: 'array' }).Sheets['发票台账']!
  expect(sheet.B3?.v).toBe('MATCH-001')
  expect(sheet.B4?.v).toBe('MATCH-002')
})
