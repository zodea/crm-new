import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import DeliveryQueuePanel from '~/components/delivery/DeliveryQueuePanel.vue'

describe('delivery queue panel', () => {
  it('归档后显示待打印操作，且不再暴露普通移出队列动作', async () => {
    const { emitted } = render(DeliveryQueuePanel, {
      props: {
        files: [{
          id: 'print:delivery-1',
          name: '已归档待打印.pdf',
          kind: 'pdf',
          size: 0,
          supplierText: '',
          docs: [],
          ocrStatus: 'done',
          ocrError: '',
          rawText: '',
          engine: '',
          model: '',
          preprocessed: false,
          printBatchId: 'delivery-1',
          archivedRecordIds: ['delivery-1'],
          printDisposition: 'pending',
        }],
        selectedId: 'print:delivery-1',
        progress: {},
      },
    })

    expect(screen.getByText('已归档 · 待打印')).not.toBeNull()
    expect(screen.getByText(/打印成功或明确排除前保留在此/)).not.toBeNull()
    expect(screen.queryByTitle('移出队列')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '打开打印' }))
    await fireEvent.click(screen.getByRole('button', { name: '登记已打印' }))
    await fireEvent.click(screen.getByRole('button', { name: '排除打印' }))
    expect(emitted().openPrint).toEqual([['print:delivery-1']])
    expect(emitted().confirmPrint).toEqual([['print:delivery-1']])
    expect(emitted().excludePrint).toEqual([['print:delivery-1']])
  })
})
