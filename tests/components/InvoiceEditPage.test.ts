import { fireEvent, render } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import InvoiceRecognitionChanges from '~/components/invoice/InvoiceRecognitionChanges.vue'
import InvoiceRecognitionFieldMark from '~/components/invoice/InvoiceRecognitionFieldMark.vue'
import InvoiceRegionViewer from '~/components/invoice/InvoiceRegionViewer.vue'
import InvoiceEditPage from '~/pages/finance/invoice/[id].vue'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))

beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, onMounted, ref, shallowRef, watch }))
    vi.stubGlobal(name, value)
})
afterEach(() => vi.unstubAllGlobals())

function mountEditPage(recognized: Record<string, unknown>, ocrStatus = 'done', file?: File) {
  const invoice = ref({ id: 'i1', invoiceNumber: 'OLD', invoiceDate: '2026-09-05', seller: '供应商', buyer: '', buyerTaxNo: '', sellerTaxNo: '', invoiceType: '', taxRate: '', projectName: '', remark: '', totalAmount: 113, taxAmount: 13, ownerKind: 'personal', accountStatus: 'none', ocrStatus, reviewStatus: 'reviewed', dupStatus: 'normal', items: [] })
  const result = { ...invoice.value, ...recognized }
  let finish!: (success: boolean) => void
  const progress = ref<Record<string, number>>({})
  const kit = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), confirm: vi.fn().mockResolvedValue(true), undoToast: vi.fn() }
  const guards: Array<() => boolean | Promise<boolean>> = []
  const run = async () => {
    progress.value.i1 = 0
    const success = await new Promise<boolean>((resolve) => {
      finish = resolve
    })
    delete progress.value.i1
    return success
  }
  const store = {
    list: [invoice.value],
    byId: () => invoice.value,
    get recognitionProgress() { return progress.value },
    recognitionError: () => '识别失败',
    startRecognition: vi.fn(async () => {
      const success = await run()
      if (success)
        invoice.value = { ...invoice.value, ...recognized, ocrStatus: 'done' }
      return success
    }),
    recognizeDraft: vi.fn(async () => (await run()) ? result : null),
    saveRecognitionDraft: vi.fn().mockResolvedValue('log'),
    update: vi.fn().mockResolvedValue('saved'),
    recognitionFile: vi.fn(() => file),
  }
  vi.stubGlobal('useRoute', () => ({ fullPath: '/finance/invoice/i1', params: { id: 'i1' } }))
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
  vi.stubGlobal('useInvoiceStore', () => store)
  vi.stubGlobal('useProjectStore', () => ({ list: [] }))
  vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: (_key: string, guard: () => boolean | Promise<boolean>) => {
    guards.push(guard)
    return () => {}
  } }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useKitUI', () => kit)
  const view = render(InvoiceEditPage, { global: { components: { InvoiceRecognitionChanges, InvoiceRecognitionFieldMark, InvoiceRegionViewer }, stubs: ['InvoicePreviewSvg', 'NuxtLink'] } })
  const recognize = async (success: boolean) => {
    await fireEvent.click(view.getByRole('button', { name: '重新识别' }))
    finish(success)
    await flushPromises()
  }
  const save = async () => {
    await fireEvent.click(view.getByRole('button', { name: '保存', exact: true }))
    await flushPromises()
  }
  return { view, store, kit, recognize, save, guards }
}

describe('发票编辑页重新识别（草稿）', () => {
  // 用户 2026-10-13 确认：重识别结果先作草稿，数据库保持识别前的值，保存须二次确认并列出变动。
  it('识别成功只填进表单不写库；保存先二次确认列出变动，取消不写库且草稿与高亮保留', async () => {
    const { view, store, kit, recognize, save } = mountEditPage({ invoiceNumber: 'NEW', totalAmount: 226, taxAmount: 26 })
    await recognize(true)
    expect(view.getByLabelText('单据编号')).toHaveProperty('value', 'NEW')
    expect(store.update).not.toHaveBeenCalled()
    expect(store.saveRecognitionDraft).not.toHaveBeenCalled()

    kit.confirm.mockResolvedValueOnce(false)
    await save()
    expect(kit.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '保存重新识别结果',
      message: expect.stringContaining('· 单据编号：OLD → NEW'),
    }))
    expect(kit.confirm.mock.calls[0]![0].message).toContain('· 价税合计：113 → 226')
    expect(store.saveRecognitionDraft).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
    expect(view.getByLabelText('单据编号')).toHaveProperty('value', 'NEW')
    expect(view.getAllByTestId('invoice-recognition-field-mark')).toHaveLength(3)

    await save()
    expect(store.saveRecognitionDraft).toHaveBeenCalledWith('i1', expect.objectContaining({ invoiceNumber: 'NEW' }), expect.objectContaining({ invoiceNumber: 'NEW', totalAmount: 226, amount: 200 }))
    expect(store.update).not.toHaveBeenCalled()
    expect(kit.success).toHaveBeenLastCalledWith('已保存重新识别结果')
  })

  it('识别失败时保留当前输入、不产生草稿，保存按普通修改直接提交', async () => {
    const { view, store, kit, recognize, save } = mountEditPage({ invoiceNumber: 'NEW' })
    await recognize(false)
    expect(view.getByLabelText('单据编号')).toHaveProperty('value', 'OLD')
    expect(view.queryByTestId('invoice-recognition-changes')).toBeNull()
    expect(kit.error).toHaveBeenCalledWith('识别失败')
    await save()
    expect(kit.confirm).not.toHaveBeenCalled()
    expect(store.update).toHaveBeenCalledWith('i1', expect.objectContaining({ invoiceNumber: 'OLD', totalAmount: 113 }))
  })

  it('变动字段输入框带角标与读屏原值；识别后再手改的字段改标“已人工修改”', async () => {
    const { view, recognize } = mountEditPage({ seller: '识别供应商', totalAmount: 226 })
    await fireEvent.update(view.getByDisplayValue('供应商'), '人工更正供应商')
    await recognize(true)

    const changes = view.getByTestId('invoice-recognition-changes')
    expect(changes.textContent).toContain('重新识别结果未保存：2 项与识别前不同')
    expect(changes.textContent).toContain('供应商：人工更正供应商 → 识别供应商')
    expect(changes.textContent).toContain('价税合计：113 → 226')
    const seller = view.getByLabelText('供应商')
    const mark = document.getElementById(seller.getAttribute('aria-describedby')!)
    expect(mark?.textContent).toContain('识别变动')
    expect(mark?.textContent).toContain('识别前：人工更正供应商')
    expect(seller.className).toContain('border-warn!')
    expect(view.getByLabelText('单据编号').getAttribute('aria-describedby')).toBeNull()

    await fireEvent.update(seller, '再次人工')
    expect(document.getElementById(seller.getAttribute('aria-describedby')!)?.textContent).toContain('已人工修改')
    expect(changes.textContent).toContain('供应商：人工更正供应商 → 再次人工')
  })

  it('放弃识别结果恢复识别前的表单（含未保存的手工修改），之后保存不再确认', async () => {
    const { view, store, kit, recognize, save } = mountEditPage({ seller: '识别供应商' })
    await fireEvent.update(view.getByDisplayValue('供应商'), '人工更正供应商')
    await recognize(true)
    await fireEvent.click(view.getByRole('button', { name: '放弃识别结果' }))
    expect(view.getByLabelText('供应商')).toHaveProperty('value', '人工更正供应商')
    expect(view.queryByTestId('invoice-recognition-changes')).toBeNull()
    expect(view.queryAllByTestId('invoice-recognition-field-mark')).toHaveLength(0)
    await save()
    expect(kit.confirm).not.toHaveBeenCalled()
    expect(store.update).toHaveBeenCalledWith('i1', expect.objectContaining({ seller: '人工更正供应商' }))
  })

  it('未保存的识别草稿走离开保护：关页签/离开须确认放弃，取消则留下', async () => {
    const { kit, recognize, guards } = mountEditPage({ seller: '识别供应商' })
    expect(await guards[0]!()).toBe(true)
    await recognize(true)
    kit.confirm.mockResolvedValueOnce(false)
    expect(await guards[0]!()).toBe(false)
    expect(kit.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: '放弃识别结果' }))
  })

  it('识别结果与当前值一致时也作草稿，提示一致且保存仍须确认', async () => {
    const { view, kit, store, recognize, save } = mountEditPage({})
    await recognize(true)
    expect(view.getByTestId('invoice-recognition-changes').textContent).toContain('票面字段与识别前一致')
    expect(kit.success).toHaveBeenCalledWith('识别完成，字段与识别前一致，保存后回到待校对')
    await save()
    expect(kit.confirm.mock.calls[0]![0].message).toContain('与识别前的票面字段一致')
    expect(store.saveRecognitionDraft).toHaveBeenCalled()
  })

  it('未识别过的票首次识别仍直接写入并刷新表单', async () => {
    const { view, store, recognize } = mountEditPage({ invoiceNumber: 'NEW' }, 'failed')
    await recognize(true)
    expect(store.startRecognition).toHaveBeenCalled()
    expect(store.recognizeDraft).not.toHaveBeenCalled()
    expect(view.getByLabelText('单据编号')).toHaveProperty('value', 'NEW')
    expect(view.queryByTestId('invoice-recognition-changes')).toBeNull()
  })

  describe('原图比对（识别区域只在草稿内存中）', () => {
    const regions = {
      invoiceNumber: { pageIndex: 0, blockLabel: 'text', box: { x: 0.5, y: 0.1, width: 0.4, height: 0.1 } },
      totalAmount: { pageIndex: 0, blockLabel: 'text', box: { x: 0.05, y: 0.8, width: 0.9, height: 0.1 } },
    }
    const file = new File([new Uint8Array([1])], 'audit.png', { type: 'image/png' })
    beforeEach(() => {
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:audit'), revokeObjectURL: vi.fn() })
    })

    it('原文件在会话中时左栏改为原图：变动字段框出并带字段名，定位不到的说明“原图未定位”，读屏同步说明', async () => {
      const { view, recognize } = mountEditPage({ invoiceNumber: 'NEW', totalAmount: 226, taxAmount: 26, fieldRegions: regions }, 'done', file)
      expect(view.queryByTestId('invoice-region-viewer')).toBeNull()
      await recognize(true)
      const boxes = view.getAllByTestId('invoice-region-box')
      expect(boxes.map(box => box.textContent?.trim())).toEqual(['单据编号', '价税合计'])
      expect(boxes[0]!.style.left).toBe('50%')
      expect(boxes[0]!.style.top).toBe('10%')
      expect(view.getByTestId('invoice-region-legend').textContent).toContain('原图未定位：税额')
      const number = view.getByLabelText('单据编号')
      expect(document.getElementById(number.getAttribute('aria-describedby')!)?.textContent).toContain('原图已框出')
      const tax = view.getByLabelText('税额')
      expect(document.getElementById(tax.getAttribute('aria-describedby')!)?.textContent).toContain('原图未定位')
      expect(view.getAllByTestId('invoice-recognition-change-item').map(item => item.textContent)).toEqual([
        expect.not.stringContaining('原图未定位'),
        expect.not.stringContaining('原图未定位'),
        expect.stringContaining('原图未定位'),
      ])
    })

    it('聚焦字段强调对应框并保持，悬停变动条目临时覆盖；旋转后框随之换算', async () => {
      const { view, recognize } = mountEditPage({ invoiceNumber: 'NEW', totalAmount: 226, fieldRegions: regions }, 'done', file)
      await recognize(true)
      const active = () => view.getAllByTestId('invoice-region-box').filter(box => box.dataset.active === 'true').map(box => box.dataset.fields)
      expect(active()).toEqual([])
      await fireEvent.focus(view.getByLabelText('单据编号'))
      expect(active()).toEqual(['invoiceNumber'])
      const totalItem = view.getAllByTestId('invoice-recognition-change-item').find(item => item.textContent?.includes('价税合计'))!
      await fireEvent.mouseEnter(totalItem)
      expect(active()).toEqual(['totalAmount'])
      await fireEvent.mouseLeave(totalItem)
      expect(active()).toEqual(['invoiceNumber'])

      await fireEvent.click(view.getByRole('button', { name: '原图向右旋转' }))
      const numberBox = view.getAllByTestId('invoice-region-box').find(box => box.dataset.fields === 'invoiceNumber')!
      expect(numberBox.style.left).toBe('80%')
      expect(numberBox.style.top).toBe('50%')
    })

    it('原文件不在会话中或放弃草稿后回到示意图，不显示框', async () => {
      const withoutFile = mountEditPage({ invoiceNumber: 'NEW', fieldRegions: regions })
      await withoutFile.recognize(true)
      expect(withoutFile.view.queryByTestId('invoice-region-viewer')).toBeNull()
      withoutFile.view.unmount()

      const { view, recognize } = mountEditPage({ invoiceNumber: 'NEW', fieldRegions: regions }, 'done', file)
      await recognize(true)
      expect(view.getByTestId('invoice-region-viewer')).toBeTruthy()
      await fireEvent.click(view.getByRole('button', { name: '放弃识别结果' }))
      expect(view.queryByTestId('invoice-region-viewer')).toBeNull()
    })
  })
})
