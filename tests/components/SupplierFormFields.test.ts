import type { SupplierFormDraft } from '~/lib/master-data/forms'
import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import SupplierFormFields from '~/components/master-data/SupplierFormFields.vue'

const runtime = vi.hoisted(() => ({ desktop: true }))

const recordTaxpayerVerification = vi.fn()
const formModal = vi.fn()
const success = vi.fn()
const warning = vi.fn()
const error = vi.fn()
const verifyCentral = vi.fn()

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
      onVerifyTaxpayer: verifyCentral,
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
    runtime.desktop = true
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

  it('浏览器只向整页父级发核验意图，不调用旧本地存储或全局表单弹窗', async () => {
    runtime.desktop = false
    renderFields()
    await fireEvent.click(screen.getByRole('button', { name: '记录人工核验' }))
    expect(verifyCentral).toHaveBeenCalledOnce()
    expect(recordTaxpayerVerification).not.toHaveBeenCalled()
    expect(formModal).not.toHaveBeenCalled()
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

  it('刷新载入保留状态与来源，时间和备注可按需查看', async () => {
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
    expect(screen.queryByText('2026-07-31 00:20:30')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '查看纳税人类型说明' }))
    expect(await screen.findByText('2026-07-31 00:20:30')).not.toBeNull()
    expect(screen.getByText('官网未查询到记录，等待补充资料')).not.toBeNull()
  })

  it('劳务承包范围独立于主营业务，允许多行编辑和清空', async () => {
    const draft = renderFields({ mainBusiness: '建筑材料', laborScope: '石材安装' })
    const scope = screen.getByLabelText('劳务承包范围') as HTMLTextAreaElement
    expect(scope.value).toBe('石材安装')
    expect(scope.required).toBe(false)
    await fireEvent.update(scope, '石材安装\n楼梯铺贴')
    expect(draft.laborScope).toBe('石材安装\n楼梯铺贴')
    expect(draft.mainBusiness).toBe('建筑材料')
    await fireEvent.update(scope, '')
    expect(draft.laborScope).toBe('')
    expect(draft.mainBusiness).toBe('建筑材料')
  })
})
