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
import { createDefaultInvoiceXlsxStyleConfig, MONEY_FORMAT } from '~/lib/invoice/excel'

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
    database.execute.mockReset()
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
    await fireEvent.update(screen.getByRole('textbox', { name: '文本格式' }), '@ "文本"')
    await fireEvent.click(screen.getByRole('button', { name: '保存为台账默认样式' }))

    await waitFor(() => expect(database.execute).toHaveBeenCalledTimes(1))
    const saved = JSON.parse(String(database.execute.mock.calls[0]?.[1]?.[0]))
    expect(saved.freezeRows).toBe(5)
    expect(saved.textFormat).toBe('@ "文本"')
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

  it.each([MONEY_FORMAT, '#,##0.000'])('默认与旧自定义金额格式 %s 在控件中显示当前值且导出不变', async (moneyFormat) => {
    database.select.mockResolvedValue([{
      settings_json: JSON.stringify({ ...createDefaultInvoiceXlsxStyleConfig(), freezeRows: 7, moneyFormat }),
    }])
    const view = renderPreview()
    await waitFor(() => expect((screen.getByRole('spinbutton', { name: '冻结行数' }) as HTMLInputElement).value).toBe('7'))
    const select = screen.getByRole('combobox', { name: '金额格式' }) as HTMLSelectElement
    expect(select.value).toBe(moneyFormat)
    expect(select.selectedOptions[0]?.textContent?.trim()).toBe(moneyFormat === MONEY_FORMAT ? '1234.56（负数红色括号）' : '自定义（#,##0.000）')
    await fireEvent.click(screen.getByRole('button', { name: '确认导出' }))
    expect(view.emitted('confirm')[0]?.[0]).toMatchObject({ moneyFormat })
  })

  it('表头和数据四向边框分别预览并交给实际导出，票据类型与金额列对齐', async () => {
    const view = renderPreview()
    await waitFor(() => expect(screen.getByRole('button', { name: '确认导出' }).hasAttribute('disabled')).toBe(false))
    await fireEvent.update(screen.getByRole('combobox', { name: '表头上边框线型' }), 'medium')
    await fireEvent.update(screen.getByRole('textbox', { name: '表头上边框颜色' }), '#123456')
    await fireEvent.update(screen.getByRole('combobox', { name: '数据行左边框线型' }), 'dotted')
    await fireEvent.update(screen.getByRole('textbox', { name: '数据行左边框颜色' }), 'FFABCDEF')
    const table = screen.getByTestId('invoice-export-preview-table')
    const header = table.querySelector('thead th') as HTMLElement
    const cells = table.querySelectorAll('tbody tr:first-child td')
    expect(header.style.borderTop).toBe('2px solid rgb(18, 52, 86)')
    expect((cells[0] as HTMLElement).style.borderLeft).toBe('1px dotted rgb(171, 205, 239)')
    expect(cells[4]?.textContent).toContain('增值税普通发票')
    expect(cells[5]?.textContent).toContain('113.00')
    await fireEvent.click(screen.getByRole('button', { name: '确认导出' }))
    expect(view.emitted('confirm')[0]?.[0]).toMatchObject({
      headerBorder: { top: { style: 'medium', color: 'FF123456' } },
      dataBorder: { left: { style: 'dotted', color: 'FFABCDEF' } },
      border: { top: { style: 'thin' }, left: { style: 'thin' } },
    })
  })

  it('保存后编辑撤下已保存提示，取消和恢复默认只改变草稿，保存失败可原值重试', async () => {
    const view = renderPreview()
    const headerColor = () => screen.getByRole('textbox', { name: '表头上边框颜色' }) as HTMLInputElement
    await waitFor(() => expect(screen.getByRole('button', { name: '确认导出' }).hasAttribute('disabled')).toBe(false))
    await fireEvent.update(headerColor(), 'FF123456')
    await fireEvent.click(screen.getByRole('button', { name: '保存为台账默认样式' }))
    await screen.findByText('已保存')
    await fireEvent.update(headerColor(), 'FF654321')
    expect(screen.queryByText('已保存')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(view.emitted('update:open').at(-1)).toEqual([false])
    await view.rerender({ open: false })
    await view.rerender({ open: true })
    await waitFor(() => expect(headerColor().value).toBe('FF123456'))
    await fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(headerColor().value).toBe('FF000000')
    expect(database.execute).toHaveBeenCalledTimes(1)
    await view.rerender({ open: false })
    await view.rerender({ open: true })
    await waitFor(() => expect(headerColor().value).toBe('FF123456'))

    database.execute.mockRejectedValueOnce(new Error('isolated storage failure'))
    await fireEvent.update(headerColor(), 'FFABCDEF')
    await fireEvent.click(screen.getByRole('button', { name: '保存为台账默认样式' }))
    expect((await screen.findByRole('alert')).textContent).toContain('默认样式保存失败')
    expect(headerColor().value).toBe('FFABCDEF')
    await fireEvent.click(screen.getByRole('button', { name: '保存为台账默认样式' }))
    await screen.findByText('已保存')
    expect(JSON.parse(String(database.execute.mock.calls.at(-1)?.[1]?.[0])).headerBorder.top.color).toBe('FFABCDEF')
  })

  it('未填完整的颜色提示具体原因，保留输入且不保存或导出', async () => {
    const view = renderPreview()
    await waitFor(() => expect(screen.getByRole('button', { name: '确认导出' }).hasAttribute('disabled')).toBe(false))
    const color = screen.getByRole('textbox', { name: '数据行右边框颜色' }) as HTMLInputElement
    await fireEvent.update(color, '#')
    await fireEvent.click(screen.getByRole('button', { name: '确认导出' }))
    expect(view.emitted('confirm')).toBeUndefined()
    expect(screen.getByRole('alert').textContent).toContain('边框颜色')
    await fireEvent.click(screen.getByRole('button', { name: '保存为台账默认样式' }))
    expect(database.execute).not.toHaveBeenCalled()
    expect(color.value).toBe('#')
    await fireEvent.update(color, '#112233')
    await fireEvent.click(screen.getByRole('button', { name: '确认导出' }))
    expect(view.emitted('confirm')[0]?.[0]).toMatchObject({ dataBorder: { right: { color: 'FF112233' } } })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
