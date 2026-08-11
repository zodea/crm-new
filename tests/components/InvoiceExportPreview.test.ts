import type { Component } from 'vue'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InvoiceExportPreview from '~/components/invoice/InvoiceExportPreview.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import { createDefaultInvoiceXlsxStyleConfig } from '~/lib/invoice/excel'

const database = vi.hoisted(() => ({
  execute: vi.fn(async () => {}),
  select: vi.fn(async <T>() => [] as T[]),
}))

vi.mock('~/lib/db/client', () => ({ db: database }))

const globalComponents: Record<string, Component> = {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
}

function renderPreview() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return render(InvoiceExportPreview, {
    props: {
      'open': true,
      'rows': [{
        invoiceDate: '2026-08-11',
        invoiceNumber: 'INV-001',
        seller: '瑞航供应商',
        invoiceType: '增值税普通发票',
        totalAmount: 113,
        projectName: '个人开支',
        source: '扫描',
        remark: '',
      }],
      'totalAmount': 113,
      'fileName': '发票台账.xlsx',
      'saving': false,
      'onUpdate:open': vi.fn(),
    },
    global: {
      plugins: [pinia],
      components: globalComponents,
    },
  })
}

describe('发票导出预览样式草稿', () => {
  beforeEach(() => {
    localStorage.clear()
    database.execute.mockClear()
    database.select.mockReset()
    database.select.mockResolvedValue([{
      settings_json: JSON.stringify({
        ...createDefaultInvoiceXlsxStyleConfig(),
        freezeRows: 7,
      }),
    }])
    setActivePinia(createPinia())
  })

  it('从 invoice store 载入 SQLite 默认值，并经 action 保存编辑草稿', async () => {
    renderPreview()

    const freezeRows = await screen.findByRole('spinbutton', { name: '冻结行数' })
    await waitFor(() => expect((freezeRows as HTMLInputElement).value).toBe('7'))

    await fireEvent.update(freezeRows, '5')
    await fireEvent.click(screen.getByRole('button', { name: '保存为台账默认样式' }))

    await waitFor(() => expect(database.execute).toHaveBeenCalledTimes(1))
    const saved = JSON.parse(String(database.execute.mock.calls[0]?.[1]?.[0]))
    expect(saved.freezeRows).toBe(5)
    expect((await screen.findByRole('status')).textContent).toContain('已保存')
    expect(localStorage.length).toBe(0)
  })

  it('默认样式异步读取期间禁用草稿编辑，完成后再采用持久化值', async () => {
    let resolveLoad!: (rows: { settings_json: string }[]) => void
    const pendingLoad = new Promise<{ settings_json: string }[]>((resolve) => {
      resolveLoad = resolve
    })
    database.select.mockImplementationOnce(async <T>() => await pendingLoad as unknown as T[])

    renderPreview()

    const freezeRows = await screen.findByRole('spinbutton', { name: '冻结行数' })
    expect(freezeRows.closest('fieldset')?.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '确认导出' }).hasAttribute('disabled')).toBe(true)

    resolveLoad([{
      settings_json: JSON.stringify({
        ...createDefaultInvoiceXlsxStyleConfig(),
        freezeRows: 9,
      }),
    }])

    await waitFor(() => {
      expect(freezeRows.closest('fieldset')?.hasAttribute('disabled')).toBe(false)
      expect((freezeRows as HTMLInputElement).value).toBe('9')
    })
  })
})
