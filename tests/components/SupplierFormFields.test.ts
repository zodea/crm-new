import type { SupplierFormDraft } from '~/lib/master-data/forms'
import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import SupplierFormFields from '~/components/master-data/SupplierFormFields.vue'

const recordTaxpayerVerification = vi.fn()
const formModal = vi.fn()
const success = vi.fn()
const warning = vi.fn()
const error = vi.fn()

vi.stubGlobal('useSupplierDetailStore', () => ({
  recordTaxpayerVerification,
}))
vi.stubGlobal('useKitUI', () => ({
  error,
  formModal,
  success,
  warning,
}))

function renderFields(overrides: Partial<SupplierFormDraft> = {}) {
  const draft = reactive<SupplierFormDraft>({
    id: 'supplier-1',
    name: '测试分供方',
    aliases: [],
    taxNo: '91440000123456789X',
    supplierCategory: '材料供应商',
    address: '广州市测试区一号',
    invoiceAddress: '',
    taxpayerType: '未核验',
    contact: '测试联系人',
    ...overrides,
  })
  render(SupplierFormFields, {
    props: {
      modelValue: draft,
      fieldErrors: {},
    },
    global: {
      components: {
        SectionHeader: defineComponent({
          props: ['title'],
          template: '<h2>{{ title }}</h2>',
        }),
      },
    },
  })
  return draft
}

describe('分供方表单资料辅助动作', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recordTaxpayerVerification.mockImplementation(async (input: {
      status: string
      taxpayerType: string
      source: string
      note: string
    }) => ({
      status: input.status,
      taxpayerType: input.taxpayerType,
      source: input.source,
      verifiedAt: '2026-07-30T16:20:30.000Z',
      note: input.note,
    }))
  })

  it('一次性复制注册地址，复制后开票资料地址仍可独立编辑', async () => {
    const draft = renderFields()

    await fireEvent.click(screen.getByRole('button', { name: '同注册地址' }))
    const invoiceAddress = screen.getByLabelText('开票资料地址（选填）') as HTMLInputElement
    expect(invoiceAddress.value).toBe('广州市测试区一号')

    await fireEvent.update(invoiceAddress, '广州市独立开票地址')
    expect(draft.invoiceAddress).toBe('广州市独立开票地址')
    expect(draft.address).toBe('广州市测试区一号')
  })

  it('官网未查到时保存为未核验，不自动认定小规模纳税人', async () => {
    formModal.mockResolvedValueOnce({
      status: '官网未查到，保持未核验',
      taxpayerType: '小规模纳税人',
      note: '未查询到记录',
    })
    const draft = renderFields({ taxpayerType: '小规模纳税人' })

    await fireEvent.click(screen.getByRole('button', { name: '记录人工核验' }))

    expect(recordTaxpayerVerification).toHaveBeenCalledWith({
      supplierId: 'supplier-1',
      status: 'not_found',
      taxpayerType: '未核验',
      source: 'https://etax.guangdong.chinatax.gov.cn:8443/xxbg/view/zhsffw/#/query/ybnsrzgcx',
      note: '未查询到记录',
    })
    expect(draft.taxpayerType).toBe('未核验')
    expect(draft.taxpayerVerificationStatus).toBe('not_found')
    expect(draft.taxpayerVerificationSource).toBe(
      'https://etax.guangdong.chinatax.gov.cn:8443/xxbg/view/zhsffw/#/query/ybnsrzgcx',
    )
    expect(draft.taxpayerVerifiedAt).toBe('2026-07-30T16:20:30.000Z')
    expect(draft.taxpayerVerificationNote).toBe('未查询到记录')
    expect(await screen.findByText('官网未查到，保持未核验')).not.toBeNull()
    expect(screen.getByText('来源：广东省电子税务局')).not.toBeNull()
    expect(screen.getByText('备注：未查询到记录')).not.toBeNull()
  })

  it('其他官方资料人工确认不会伪记为广东税务官网来源', async () => {
    formModal.mockResolvedValueOnce({
      status: '其他官方资料人工确认',
      taxpayerType: '小规模纳税人',
      note: '依据主管税务机关盖章资料',
    })
    renderFields()

    await fireEvent.click(screen.getByRole('button', { name: '记录人工核验' }))

    expect(recordTaxpayerVerification).toHaveBeenCalledWith(expect.objectContaining({
      status: 'manually_confirmed',
      taxpayerType: '小规模纳税人',
      source: '其他官方资料',
    }))
  })

  it('刷新载入后仍展示核验状态、来源、时间与备注', () => {
    renderFields({
      taxpayerVerificationStatus: 'not_found',
      taxpayerVerificationSource:
        'https://etax.guangdong.chinatax.gov.cn:8443/xxbg/view/zhsffw/#/query/ybnsrzgcx',
      taxpayerVerifiedAt: '2026-07-30T16:20:30.000Z',
      taxpayerVerificationNote: '官网未查询到记录，等待补充资料',
    })

    const trace = screen.getByRole('status', { name: '纳税人核验留痕' })
    expect(trace.textContent).toContain('官网未查到，保持未核验')
    expect(trace.textContent).toContain('来源：广东省电子税务局')
    expect(trace.textContent).toContain('核验时间：2026-07-31 00:20:30')
    expect(trace.textContent).toContain('备注：官网未查询到记录，等待补充资料')
  })
})
