import type { PaymentApplicationDetail } from '~/lib/finance/payment-detail'
import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import PaymentApplicationInsightPanel from '~/components/finance/PaymentApplicationInsightPanel.vue'

describe('付款申请洞察说明', () => {
  it('保留业务风险与状态，口径说明按需展开且独立于标题', async () => {
    render(PaymentApplicationInsightPanel, {
      props: {
        detail: {
          supplierId: null,
          insight: { checks: [{ key: 'over-limit', level: 'danger', title: '申请金额超限', summary: '本次申请超过可付余额', detail: '请先核对付款申请与合同金额。' }] },
        } as unknown as PaymentApplicationDetail,
        statusText: '待审核',
        statusClass: 'text-warn',
      },
    })
    expect(screen.getByRole('heading', { name: '智能业务洞察', exact: true })).not.toBeNull()
    expect(screen.getByText('待审核')).not.toBeNull()
    expect(screen.getByText('本次申请超过可付余额')).not.toBeNull()
    expect(screen.queryByText(/根据当前付款申请及关联单据/)).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '查看业务洞察说明' }))
    expect(screen.getByText('根据当前付款申请及关联单据计算金额与风险提示。')).not.toBeNull()
    expect(screen.queryByText(/前端|补造/)).toBeNull()
  })
})
